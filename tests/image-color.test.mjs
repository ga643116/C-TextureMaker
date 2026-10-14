/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { normalizeColorMap, encodeColorMap, createImageColorSampler } from '../app/image-color.mjs';
import { createDocument, createLayer, createImageMaskLayer, imageMaskGeometry, normalizeDocument, renderSVG, PATTERNS } from '../app/engine.mjs';
const pixels=new Uint8ClampedArray([255,0,0,255,0,0,255,255,255,0,0,255,0,0,255,0]);
const colorMap=encodeColorMap({width:2,height:2,data:pixels});
const png=new PNG({width:2,height:2});png.data.set(pixels);
const image='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
const imageLayer=()=>createImageMaskLayer({id:'colors',image,imageWidth:2,imageHeight:2,mode:'color',colorMap});

test('embedded image colors validate dimensions and bytes, and old mask layers remain masks',()=>{
 assert.deepEqual(normalizeColorMap(colorMap),colorMap);
 for(const bad of [{...colorMap,extra:1},{...colorMap,width:257},{...colorMap,width:0},{...colorMap,height:1.5},{...colorMap,rgba:'!'.repeat(colorMap.rgba.length)},{...colorMap,rgba:'AAAA'}])assert.throws(()=>normalizeColorMap(bad),/color map/);
 const doc=createDocument(),legacy=imageLayer();delete legacy.mode;delete legacy.colorMap;doc.layers.push(legacy);
 const loaded=normalizeDocument(JSON.parse(JSON.stringify(doc)));assert.equal(loaded.layers[1].mode,'mask');assert.equal(loaded.layers[1].colorMap,null);
 const layer=imageLayer();doc.layers[1]=layer;
 assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))).layers[1],layer);
 for(const override of [{mode:'invalid'},{colorMap:null}])assert.throws(()=>normalizeDocument({...doc,layers:[doc.layers[0],{...layer,...override}]}),/image mode|color map/);
});

test('image color sampling follows canvas-space scale, position, rotation and flips',()=>{
 const doc={width:128,height:128},layer=imageLayer();
 const sample=()=>createImageColorSampler(layer,imageMaskGeometry(layer,doc));
 assert.deepEqual(sample()(32,32),[255,0,0,255]);assert.deepEqual(sample()(96,32),[0,0,255,255]);
 assert.deepEqual(sample()(96,96),[0,0,0,0]);assert.deepEqual(sample()(-1,64),[0,0,0,0]);
 layer.flipX=true;assert.deepEqual(sample()(32,32),[0,0,255,255]);layer.flipX=false;
 layer.flipY=true;assert.deepEqual(sample()(96,32),[0,0,0,0]);layer.flipY=false;
 layer.rotation=90;assert.deepEqual(sample()(96,32),[255,0,0,255]);
 layer.rotation=0;layer.scale=.5;layer.offsetX=12;layer.offsetY=-4;
 assert.deepEqual(sample()(60,44),[255,0,0,255]);assert.deepEqual(sample()(20,20),[0,0,0,0]);
});

test('sampling blends alpha without bringing hidden colors into translucent edges',()=>{
 const data=new Uint8ClampedArray([255,0,0,255,0,0,255,0]),layer=imageLayer();layer.colorMap=encodeColorMap({width:2,height:1,data});
 const sample=createImageColorSampler(layer,imageMaskGeometry(layer,{width:128,height:128}));
 assert.deepEqual(sample(64,64),[255,0,0,128]);
});

test('color layers project through pattern geometry and leave cell edit targets in preview',()=>{
 const doc=createDocument();doc.width=doc.height=128;doc.layers=[createLayer('dots','dots'),imageLayer()];doc.layers[0].params.spacing=32;
 const svg=renderSVG(doc),preview=renderSVG(doc,{preview:true});
 assert.match(svg,/id="image-color-shape-dots"/);assert.doesNotMatch(svg,/all-image-masks/);
 assert.match(preview,/<g opacity="0">/);assert.match(preview,/data-cell=/);
 const defs=preview.slice(0,preview.lastIndexOf('</defs>'));assert.doesNotMatch(defs,/data-cell=/,'mask geometry must not duplicate editor targets');
 assert.equal(svg.split(image).length-1,1,'original source image is embedded once');
 const mask=createImageMaskLayer({id:'mask',image,imageWidth:2,imageHeight:2});doc.layers.push(mask);
 assert.match(renderSVG(doc),/all-image-masks/,'mask and color modes can coexist');
 const top=imageLayer();top.id='top-colors';top.flipX=true;doc.layers.push(top);
 assert.match(renderSVG(doc),/scale\(-1 1\)/,'topmost visible color source supplies its transform');
 top.visible=false;assert.doesNotMatch(renderSVG(doc),/scale\(-1 1\)/);
});

test('all pattern families accept persisted color layers and SVG repeated views',()=>{
 for(const pattern of PATTERNS){
  const doc=createDocument();doc.width=doc.height=128;doc.layers=[createLayer(pattern.id,'art'),imageLayer()];
  for(const repeat of [1,3]){const svg=renderSVG(doc,{repeat});assert.ok(svg.endsWith('</svg>'));assert.doesNotMatch(svg,/NaN|Infinity/);}
 }
});


test('photo-colored Low Poly exports only vector facets, without an unused source image',()=>{
 const doc=createDocument();doc.width=doc.height=128;doc.layers=[createLayer('lowpoly','facets'),imageLayer()];
 const svg=renderSVG(doc);assert.match(svg,/<polygon /);assert.doesNotMatch(svg,/<image|data:image/);
});
