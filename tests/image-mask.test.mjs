/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { PATTERNS, createDocument, createImageMaskLayer, createLayer, imageMaskGeometry, isImageMaskLayer, normalizeDocument, renderSVG } from '../app/engine.mjs';

const imageUrl = pixels => {
  const png = new PNG({ width:pixels.length, height:pixels[0].length });
  for (let x=0;x<pixels.length;x++) for (let y=0;y<pixels[x].length;y++) png.data.set(pixels[x][y],(y*png.width+x)*4);
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};
const columns = colors => imageUrl(colors.map(color => Array.from({length:4},() => color)));
const broadColumns = colors => imageUrl(Array.from({length:colors.length*8},(_,x)=>Array.from({length:32},()=>colors[Math.floor(x/8)])));
const raster = (doc, options) => PNG.sync.read(new Resvg(renderSVG(doc,options)).render().asPng());
const alpha = (png,x,y) => png.data[(y*png.width+x)*4+3];
const pixel = (png,x,y) => [...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];
const solidLayer = id => {
  const layer=createLayer('barcode',id);
  Object.assign(layer.params,{width:1024,height:1,variation:0,noise:0});
  return layer;
};
const maskLayer = (image, overrides={}) => createImageMaskLayer({id:'image-mask',image,imageWidth:4,imageHeight:4,...overrides});
const broadMaskLayer = (image, overrides={}) => maskLayer(image,{imageWidth:32,imageHeight:32,...overrides});

test('image mask factory exposes the fixed schema and contain/cover geometry',()=>{
  const image=columns([[0,0,0,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]]);
  const mask=maskLayer(image,{imageWidth:4,imageHeight:2});
  assert.equal(isImageMaskLayer(mask),true);
  assert.equal(isImageMaskLayer(createLayer('dots')),false);
  assert.deepEqual(Object.keys(mask),['mode','colorMap','id','type','name','visible','image','imageWidth','imageHeight','threshold','invert','fit','scale','rotation','offsetX','offsetY','flipX','flipY']);
  assert.deepEqual({name:mask.name,visible:mask.visible,threshold:mask.threshold,invert:mask.invert,fit:mask.fit,scale:mask.scale,rotation:mask.rotation,offsetX:mask.offsetX,offsetY:mask.offsetY,flipX:mask.flipX,flipY:mask.flipY},{name:'Image layer',visible:true,threshold:128,invert:false,fit:'contain',scale:1,rotation:0,offsetX:0,offsetY:0,flipX:false,flipY:false});
  assert.deepEqual(imageMaskGeometry(mask,{width:128,height:128}),{width:128,height:64,cx:64,cy:64,transform:'translate(64 64) rotate(0) scale(1 1)'});
  mask.fit='cover';
  assert.deepEqual(imageMaskGeometry(mask,{width:128,height:128}),{width:256,height:128,cx:64,cy:64,transform:'translate(64 64) rotate(0) scale(1 1)'});
  Object.assign(mask,{scale:2,rotation:15,offsetX:12,offsetY:-8,flipX:true,flipY:true});
  assert.deepEqual(imageMaskGeometry(mask,{width:128,height:128}),{width:512,height:256,cx:76,cy:56,transform:'translate(76 56) rotate(15) scale(-1 -1)'});
});

test('image mask data URLs, names, dimensions and settings are strictly validated',()=>{
  const png=columns([[0,0,0,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]]),base=maskLayer(png),doc=createDocument();
  doc.layers=[solidLayer('solid'),base];
  assert.doesNotThrow(()=>normalizeDocument(doc));
  assert.throws(()=>createImageMaskLayer({id:'bad',image:'https://example.test/image.png',imageWidth:1,imageHeight:1}),/data URL/);
  assert.throws(()=>createImageMaskLayer({id:'bad',image:'data:image/gif;base64,AAAA',imageWidth:1,imageHeight:1}),/data URL/);
  assert.throws(()=>createImageMaskLayer({id:'bad',image:'data:image/png;base64,AAAA',imageWidth:1,imageHeight:1}),/PNG/);
  for(const fragment of ['<svg><script>alert(1)</script></svg>','<svg><image href="https://example.test/x.png"/></svg>','<!DOCTYPE svg><svg/>']){
    const svg=`data:image/svg+xml;base64,${Buffer.from(fragment).toString('base64')}`;
    assert.throws(()=>createImageMaskLayer({id:'bad',image:svg,imageWidth:1,imageHeight:1}),/Unsafe SVG/);
  }
  const safeSvg=`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="black"/></svg>').toString('base64')}`;
  assert.doesNotThrow(()=>createImageMaskLayer({id:'safe',image:safeSvg,imageWidth:1,imageHeight:1}));
  assert.throws(()=>normalizeDocument({...doc,layers:[solidLayer('solid'),{...base,extra:true}]}),/Unknown image mask field/);
  for(const [field,value] of [['threshold',256],['threshold',-1],['threshold',1.5],['scale',0.04],['scale',8.01],['rotation',181],['offsetX',32769],['imageWidth',8193],['imageHeight',0],['fit','stretch'],['invert',0],['flipY',0],['name','  '],['name','bad\u0000name']]){
    const errorField=field==='imageWidth'?'width':field==='imageHeight'?'height':field.startsWith('flip')?'flip':field;
    assert.throws(()=>normalizeDocument({...doc,layers:[solidLayer('solid'),{...base,[field]:value}]}),new RegExp(errorField));
  }
  const oversized={...base,image:'data:image/png;base64,'+'A'.repeat(22400000)};
  assert.throws(()=>normalizeDocument({...doc,layers:[solidLayer('solid'),oversized]}),/Invalid image mask/);
  assert.throws(()=>normalizeDocument({...doc,layers:[base]}),/at least one pattern/);
});

test('version 1 pattern documents round-trip unchanged beside strict image mask layers',()=>{
  const old=createDocument(),before=JSON.parse(JSON.stringify(old));
  assert.deepEqual(normalizeDocument(old),before);
  const image=columns([[0,0,0,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]]),doc=createDocument();
  doc.layers.push(maskLayer(image));
  const normalized=normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(normalized,normalizeDocument(doc));
  assert.equal(normalized.version,1);
});

test('Rec.709 luminance threshold keeps dark pixels and preserves source alpha, including when inverted',()=>{
  const image=broadColumns([[0,0,0,0],[0,0,0,255],[255,255,255,128],[255,255,255,0]]),doc=createDocument();
  doc.width=doc.height=128;doc.layers=[solidLayer('solid'),broadMaskLayer(image)];
  let rendered=raster(doc);
  assert.deepEqual([alpha(rendered,16,64),alpha(rendered,48,64),alpha(rendered,80,64),alpha(rendered,112,64)],[0,255,0,0]);
  doc.layers[1].invert=true;rendered=raster(doc);
  assert.deepEqual([alpha(rendered,16,64),alpha(rendered,48,64),alpha(rendered,80,64),alpha(rendered,112,64)],[0,0,128,0]);
  const boundary=broadColumns([[128,128,128,255],[129,129,129,255],[0,0,0,255],[0,0,0,255]]);doc.layers[1]=broadMaskLayer(boundary);rendered=raster(doc);
  assert.deepEqual([alpha(rendered,16,64),alpha(rendered,48,64)],[255,0],'the threshold includes the exact gray value');
});

// Resvg can panic on clipped, off-canvas geometry under a global image mask.
// editor.browser.cjs checks all patterns and repeated tiles using Chromium pixels.
test('one canvas-space image mask wraps all sixteen pattern types without drawing its source image',()=>{
  const white=broadColumns([[255,255,255,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]]),doc=createDocument();
  doc.width=doc.height=128;for(let start=0;start<PATTERNS.length;start+=15){doc.layers=PATTERNS.slice(start,start+15).map((pattern,index)=>createLayer(pattern.id,`pattern-${index}`));
  const baseline=renderSVG(doc),masked=renderSVG({...doc,layers:[...doc.layers,broadMaskLayer(white)]});
  const body=svg=>svg.slice(svg.indexOf('</defs>')+'</defs>'.length,svg.lastIndexOf('</svg>'));
  const baselineTile=/^<g clip-path="url\(#tile-base\)" transform="translate\(0 0\)">([\s\S]*)<\/g>$/.exec(body(baseline));
  assert.ok(baselineTile,'the baseline contains its single tile wrapper');
  assert.equal(body(masked),`<g clip-path="url(#tile-base)" transform="translate(0 0)"><g mask="url(#all-image-masks)">${baselineTile[1]}</g></g>`,'all existing pattern markup is nested under the global mask');
  assert.equal(masked.split(white).length-1,1,'each mask source is embedded once');
  const invisible=normalizeDocument({...doc,layers:[...doc.layers,broadMaskLayer(white)]});invisible.layers.at(-1).visible=false;
  assert.equal(renderSVG(invisible),baseline,'visibility excludes the mask effect');
  }
});

test('multiple masks intersect, their order is independent, and the document background stays outside the mask',()=>{
  const left=broadColumns([[0,0,0,255],[0,0,0,255],[255,255,255,255],[255,255,255,255]]),right=broadColumns([[255,255,255,255],[255,255,255,255],[0,0,0,255],[0,0,0,255]]),art=solidLayer('solid'),a=broadMaskLayer(left),b=broadMaskLayer(right);b.id='second-mask';
  const doc=createDocument();doc.width=doc.height=128;doc.layers=[art,a,b];
  const transparent=raster(doc);
  for(let i=3;i<transparent.data.length;i+=4)assert.equal(transparent.data[i],0,'disjoint selected regions have an empty intersection');
  doc.transparent=false;doc.background='#123456';
  const background=raster(doc);
  assert.deepEqual(pixel(background,16,64),[0x12,0x34,0x56,255]);
  assert.deepEqual(pixel(background,112,64),[0x12,0x34,0x56,255]);
  const orderOne=renderSVG({...doc,layers:[art,a,b]}),orderTwo=renderSVG({...doc,layers:[a,b,art]});
  assert.deepEqual(raster({...doc,layers:[art,a,b]}).data,raster({...doc,layers:[a,b,art]}).data);
  assert.equal(orderOne.includes('all-image-masks'),true);assert.equal(orderTwo.includes('all-image-masks'),true);
});

test('pattern transforms and density do not move the canvas-space image mask',()=>{
  const split=broadColumns([[0,0,0,255],[0,0,0,255],[255,255,255,255],[255,255,255,255]]),doc=createDocument();
  doc.width=doc.height=128;const art=solidLayer('solid');art.rotation=90;art.offsetX=16;doc.layers=[art,broadMaskLayer(split)];
  let rendered=raster(doc);
  assert.deepEqual([alpha(rendered,32,32),alpha(rendered,32,96),alpha(rendered,96,32),alpha(rendered,96,96)],[255,255,0,0]);
  art.params.count=8;rendered=raster(doc);
  assert.deepEqual([alpha(rendered,32,32),alpha(rendered,32,96),alpha(rendered,96,32),alpha(rendered,96,96)],[255,255,0,0]);
});

test('mask scale, offset, flips and rotation alter only the image mask geometry',()=>{
  const left=broadColumns([[0,0,0,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]]),doc=createDocument();
  doc.width=doc.height=128;doc.layers=[solidLayer('solid'),broadMaskLayer(left)];
  const sample=(x,y)=>alpha(raster(doc),x,y);
  assert.deepEqual([sample(16,64),sample(48,64),sample(112,64)],[255,0,0]);
  doc.layers[1].scale=0.5;
  assert.deepEqual([sample(16,64),sample(40,64)],[0,255]);
  doc.layers[1].scale=1;doc.layers[1].offsetX=20;
  assert.deepEqual([sample(16,64),sample(40,64)],[0,255]);
  doc.layers[1].offsetX=0;doc.layers[1].flipX=true;
  assert.deepEqual([sample(16,64),sample(112,64)],[0,255]);
  doc.layers[1].flipX=false;doc.layers[1].rotation=90;
  assert.deepEqual([sample(64,16),sample(64,112)],[255,0]);
  doc.layers[1].rotation=0;doc.layers[1].image=imageUrl(Array.from({length:4},()=>[[0,0,0,255],[0,0,0,255],[255,255,255,255],[255,255,255,255]]));doc.layers[1].flipY=true;
  assert.deepEqual([sample(64,16),sample(64,112)],[0,255]);
});

test('repeat3 reapplies the same image mask to each tile and keeps preview cell metadata',()=>{
  const split=broadColumns([[0,0,0,255],[0,0,0,255],[255,255,255,255],[255,255,255,255]]),doc=createDocument();
  doc.width=doc.height=128;doc.seamless=true;const art=createLayer('polygons','mesh');art.params.shape='hexagon';art.params.filled=true;art.params.cellSize=48;doc.layers=[art,broadMaskLayer(split)];
  const sheet=renderSVG(doc,{repeat:3}),tileTranslations=[...sheet.matchAll(/<g clip-path="url\(#tile-base\)" transform="translate\(([^ ]+) ([^)]+)\)">/g)].map(match=>`${match[1]} ${match[2]}`);
  assert.deepEqual(tileTranslations,['0 0','128 0','256 0','0 128','128 128','256 128','0 256','128 256','256 256']);
  assert.equal(sheet.split('<g mask="url(#all-image-masks)">').length-1,9,'every clipped tile reuses the document-space mask');
  assert.equal(sheet.split(split).length-1,1,'repeat keeps one embedded copy per mask');
  const preview=renderSVG(doc,{preview:true,repeat:3});
  assert.match(preview,/data-cell="[^"]+" data-layer="mesh"/,'mask wrapping preserves editable preview cells');
  assert.equal(preview.split(split).length-1,1,'repeat and preview keep one embedded copy per mask');
});
