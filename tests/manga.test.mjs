/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Resvg} from '@resvg/resvg-js';
import {createMangaEngine} from '../app/manga.mjs';
import {createDocument,createImageMaskLayer,createLayer,createGroup,renderSVG,normalizeDocument,switchLayerPattern,resolveColorSources,imageMaskGeometry,createCompositeColorSampler} from '../app/engine.mjs';
import {encodeColorMap,createImageColorSampler} from '../app/image-color.mjs';

function source(id,width,height,paint){
 const png=new PNG({width,height});
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)png.data.set(paint(x,y),(y*width+x)*4);
 return createImageMaskLayer({id,name:id,image:'data:image/png;base64,'+PNG.sync.write(png).toString('base64'),imageWidth:width,imageHeight:height,mode:'color',colorMap:encodeColorMap({width,height,data:new Uint8ClampedArray(png.data)})});
}
function setup(paint,width=180,height=128){
 const doc=createDocument(),image=source('image',width,height,paint),effect=createLayer('manga','manga');
 doc.width=width;doc.height=height;effect.imageSource='below';effect.params.lineArt=false;effect.params.screentone=false;doc.layers=[image,effect];return {doc,image,effect};
}
const raster=svg=>PNG.sync.read(new Resvg(svg,{font:{loadSystemFonts:false}}).render().asPng());
const pixel=(png,x,y)=>[...png.data.slice((y*png.width+x)*4,(y*png.width+x)*4+4)];
function ink(png,x0=0,x1=png.width){let count=0;for(let y=2;y<png.height-2;y++)for(let x=x0;x<x1;x++){const i=(y*png.width+x)*4;if(png.data[i+3]>128&&png.data[i]<64)count++;}return count;}

test('manga separates light colors, midtones and shadows with no original color leakage',()=>{
 const {doc,effect}=setup(x=>x<60?[247,220,231,255]:x<120?[161,116,130,255]:[30,25,45,255]);
 const png=raster(renderSVG(doc));
 assert.deepEqual(pixel(png,30,60),[255,255,255,255]);
 assert.deepEqual(pixel(png,90,60),[136,136,136,255]);
 assert.deepEqual(pixel(png,150,60),[0,0,0,255]);
 effect.params.whiteLevel=100;
 assert.deepEqual(pixel(raster(renderSVG(doc)),90,60),[255,255,255,255]);
 effect.params.blackLevel=150;effect.params.whiteLevel=200;
 assert.deepEqual(pixel(raster(renderSVG(doc)),90,60),[0,0,0,255]);
 effect.params.whiteLevel=255;
 doc.layers[0]=source('image',180,120,()=>[255,255,255,255]);
 assert.deepEqual(pixel(raster(renderSVG(doc)),90,60),[255,255,255,255]);
});

test('screentones retain gray fill between black dots; size, density and every shape affect output',()=>{
 const {doc,effect}=setup(x=>x<60?[235,235,235,255]:x<120?[128,128,128,255]:[20,20,20,255]);
 Object.assign(effect.params,{screentone:true,toneDensity:15,toneSize:50});
 const svg=renderSVG(doc),png=raster(svg);
 assert.equal(ink(png,4,54),0,'white is not screened');
 assert.equal(ink(png,126,176),50*(png.height-4),'shadows remain solid');
 const baseInk=ink(png,66,114);
 assert.ok(baseInk>100&&baseInk<48*(png.height-4)/2,'gray carries black dots without becoming a solid black region');
 effect.params.toneSize=80;assert.ok(ink(raster(renderSVG(doc)),66,114)>baseInk*1.5);
 effect.params.toneSize=50;effect.params.toneDensity=25;
 assert.notDeepEqual(raster(renderSVG(doc)).data,png.data);
 const shapes=new Set();
 effect.params.toneDensity=15;
 for(const shape of ['circle','square','diamond','line']){
  effect.params.toneShape=shape;const screened=raster(renderSVG(doc));
  assert.deepEqual(pixel(screened,72,60),[136,136,136,255],`${shape}: space between dots retains gray fill`);
  assert.deepEqual(pixel(screened,78,66),[0,0,0,255],`${shape}: the screen remains black`);
  assert.deepEqual(pixel(screened,24,60),[255,255,255,255],`${shape}: light areas stay white`);
  assert.deepEqual(pixel(screened,150,60),[0,0,0,255],`${shape}: shadows stay black`);
  shapes.add(PNG.sync.write(screened).toString('base64'));
 }
 assert.equal(shapes.size,4);
 assert.ok(svg.length<12000,'screen uses a reusable SVG pattern, not thousands of nodes');
});

test('line extraction finds contours between equally light colors and responds to strength and width',()=>{
 const {doc,effect}=setup((x,y)=>x<90?[255,210,200,255]:[165,242,200,255]);
 assert.equal(ink(raster(renderSVG(doc))),0,'both flat colors fall in the white region');
 effect.params.lineArt=true;effect.params.lineStrength=80;
 const lines=raster(renderSVG(doc)),thin=ink(lines);assert.ok(thin>50,'color boundary produces ink');
 effect.params.lineWidth=3;assert.ok(ink(raster(renderSVG(doc)))>thin);
 effect.params.lineWidth=1;effect.params.lineStrength=0;assert.ok(ink(raster(renderSVG(doc)))<thin,'low sensitivity suppresses weak edges');
 effect.params.lineArt=false;assert.equal(ink(raster(renderSVG(doc))),0);
});

test('transparent holes and partial alpha survive manga conversion and source transforms',()=>{
 const {doc,image,effect}=setup((x,y)=>x<40?[8,40,220,0]:x<80?[220,230,200,128]:[128,128,128,255]);
 let png=raster(renderSVG(doc));
 assert.equal(pixel(png,20,60)[3],0);assert.ok(Math.abs(pixel(png,60,60)[3]-128)<=1);assert.equal(pixel(png,140,60)[3],255);
 image.offsetX=40;
 png=raster(renderSVG(doc));assert.equal(pixel(png,60,60)[3],0);assert.ok(Math.abs(pixel(png,100,60)[3]-128)<=1);
 image.flipX=true;
 png=raster(renderSVG(doc));assert.equal(pixel(png,60,60)[3],255);
 image.rotation=90;
 assert.notDeepEqual(raster(renderSVG(doc)).data,png.data);
 effect.params.lineArt=true;effect.params.screentone=true;
 assert.doesNotMatch(renderSVG(doc),/NaN|Infinity/);
});

test('manga uses group and shared sources, can layer effects, and handles hidden or absent sources',()=>{
 const {doc,image,effect}=setup(()=>[128,128,128,255]);
 const group=createGroup('group','Sources');image.parentId=group.id;doc.layers=[group,image,effect];
 assert.deepEqual(pixel(raster(renderSVG(doc)),90,60),[136,136,136,255]);
 const dots=createLayer('dots','dots');dots.imageSource='below';doc.layers.push(dots);
 assert.deepEqual(resolveColorSources(doc,effect).map(x=>x.id),['image']);
 assert.deepEqual(resolveColorSources(doc,dots).map(x=>x.id),['image']);
 assert.match(renderSVG(doc),/data-manga="true"/);
 image.visible=false;assert.doesNotMatch(renderSVG(doc),/data-manga="true"/);
 image.visible=true;effect.imageSource='none';assert.doesNotMatch(renderSVG(doc),/data-manga="true"/);
 doc.layers=[effect];assert.doesNotMatch(renderSVG(doc),/data-manga="true"/);
});

test('manga parameters persist on pattern switches, project reload, and ordered threshold normalization',()=>{
 const {doc,effect}=setup(()=>[128,128,128,255]);
 Object.assign(effect.params,{blackLevel:80,whiteLevel:170,lineStrength:77,toneShape:'diamond',toneSize:72,toneDensity:24});
 const before=renderSVG(doc),params={...effect.params};
 switchLayerPattern(effect,'dots');switchLayerPattern(effect,'manga');assert.deepEqual(effect.params,params);
 assert.equal(renderSVG(normalizeDocument(JSON.parse(JSON.stringify(doc)))),before);
 effect.params.blackLevel=190;effect.params.whiteLevel=100;
 const normalized=normalizeDocument(doc).layers.at(-1).params;assert.equal(normalized.whiteLevel,191);
});

test('screen and line toggles reuse sampled analysis; source edits invalidate it',()=>{
 const {doc,image,effect}=setup(()=>[128,128,128,255]);let samples=0;
 const counted=create=>(...args)=>{const sample=create(...args);return (x,y)=>{samples++;return sample(x,y);};};
 const engine=createMangaEngine({resolveColorSources,imageMaskGeometry,createCompositeColorSampler:counted(createCompositeColorSampler),createImageColorSampler:counted(createImageColorSampler)});
 engine.render(doc,effect,'source');const first=samples;
 assert.ok(first>0);
 for(let i=0;i<12;i++){effect.params.toneDensity=30+i;effect.params.toneShape=i%2?'circle':'line';effect.params.lineArt=Boolean(i%2);engine.render(doc,effect,'source');}
 assert.equal(samples,first);
 effect.params.blackLevel=80;effect.params.whiteLevel=190;engine.render(doc,effect,'source');assert.equal(samples,first);
 image.offsetX=10;image.rotation=23;image.flipX=true;engine.render(doc,effect,'source');assert.equal(samples,first,'moving a single source reuses local image analysis');
 image.colorMap=source('replacement',180,128,()=>[50,100,150,255]).colorMap;engine.render(doc,effect,'source');assert.ok(samples>first);
});


test('multiple sources are composited in layer order and resampled after relative moves',()=>{
 const {doc,image,effect}=setup(()=>[128,128,128,255]);
 const top=source('top',180,128,x=>x<90?[245,225,215,255]:[255,50,50,0]);
 effect.imageSource='all';doc.layers=[image,top,effect];
 let png=raster(renderSVG(doc));assert.deepEqual(pixel(png,40,64),[255,255,255,255]);assert.deepEqual(pixel(png,140,64),[136,136,136,255]);
 top.offsetX=50;png=raster(renderSVG(doc));assert.deepEqual(pixel(png,40,64),[136,136,136,255]);assert.deepEqual(pixel(png,100,64),[255,255,255,255]);
 doc.layers=[top,image,effect];png=raster(renderSVG(doc));assert.deepEqual(pixel(png,100,64),[136,136,136,255]);
});


test('uniform source colors fill image corners even at a one-pixel source resolution',()=>{
 const {doc,effect}=setup(()=>[0,0,0,255],128,128);
 doc.layers[0]=source('image',1,1,()=>[0,0,0,255]);
 const png=raster(renderSVG(doc));
 for(const [x,y] of [[0,0],[127,0],[0,127],[127,127]])assert.deepEqual(pixel(png,x,y),[0,0,0,255]);
});
