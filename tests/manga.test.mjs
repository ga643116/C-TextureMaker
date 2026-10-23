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
const raster=(svg,scale=1)=>PNG.sync.read(new Resvg(svg,{...(scale===1?{}:{fitTo:{mode:'zoom',value:scale}}),font:{loadSystemFonts:false}}).render().asPng());
const pixel=(png,x,y)=>[...png.data.slice((y*png.width+x)*4,(y*png.width+x)*4+4)];
function strokeProfile(png,cx,cy,nx,ny,scale,radius=3){
 const length=Math.hypot(nx,ny),step=1/(scale*2),count=Math.ceil(radius/step),values=[];
 for(let i=-count;i<=count;i++){
  const distance=i*step,x=cx+nx/length*distance,y=cy+ny/length*distance;
  const gx=x*scale-.5,gy=y*scale-.5,x0=Math.max(0,Math.min(png.width-1,Math.floor(gx))),y0=Math.max(0,Math.min(png.height-1,Math.floor(gy))),x1=Math.min(png.width-1,x0+1),y1=Math.min(png.height-1,y0+1),fx=Math.max(0,Math.min(1,gx-x0)),fy=Math.max(0,Math.min(1,gy-y0));
  const red=(xx,yy)=>png.data[(yy*png.width+xx)*4],top=red(x0,y0)*(1-fx)+red(x1,y0)*fx,bottom=red(x0,y1)*(1-fx)+red(x1,y1)*fx;
  values.push({distance,red:top*(1-fy)+bottom*fy});
 }
 return {values,step};
}
function measureProfile({values,step}){
 let coverage=0,moment=0;
 for(let i=0;i<values.length-1;i++){
  const a=1-values[i].red/255,b=1-values[i+1].red/255;
  coverage+=(a+b)*step/2;moment+=(values[i].distance*a+values[i+1].distance*b)*step/2;
 }
 const runs=[];let start=-1;
 for(let i=0;i<=values.length;i++){
  const dark=i<values.length&&values[i].red<128;
  if(dark&&start<0)start=i;
  if(!dark&&start>=0){runs.push({center:(values[start].distance+values[i-1].distance)/2,width:(i-start)*step});start=-1;}
 }
 return {coverage,centroid:coverage?moment/coverage:Infinity,runs};
}
function pixelAtSourceCenter(png,x,y,scale){return pixel(png,Math.round(scale*(x+.5)-.5),Math.round(scale*(y+.5)-.5));}
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


test('line art follows dark strokes with continuous one-pixel geometry at different angles',()=>{
 const scale=5;
 for(const slope of [0,.2,.65,1]){
  const {doc,effect}=setup((x,y)=>{
   const px=x+.5,py=y+.5,distance=Math.abs(py-(slope*(px-64.5)+64.5))/Math.hypot(1,slope);
   const value=Math.round(245-125*Math.exp(-distance*distance/(2*.75*.75)));
   return [value,value,value,255];
  },128,128);
  Object.assign(effect.params,{blackLevel:0,whiteLevel:55,lineArt:true,lineStrength:65,lineWidth:1});
  const png=raster(renderSVG(doc),scale),widths=[];
  for(let x=20;x<108;x++){
   const centerX=x+.5,centerY=slope*(centerX-64.5)+64.5;
   const measured=measureProfile(strokeProfile(png,centerX,centerY,-slope,1,scale,4));
   assert.equal(measured.runs.length,1,`slope ${slope}: exactly one connected ink band at x=${x}`);
   assert.ok(Math.abs(measured.centroid)<.25,`slope ${slope}: ink center follows pixel-center geometry at x=${x}`);
   assert.ok(measured.coverage>.7&&measured.coverage<1.3,`slope ${slope}: rasterized stroke remains one source pixel wide at x=${x} (${measured.coverage})`);
   widths.push(measured.coverage);
  }
  assert.ok(Math.max(...widths)-Math.min(...widths)<.3,`slope ${slope}: stroke thickness stays stable along its length`);
 }
});

test('curved line art stays connected at its pixel-center radius while weak noise is suppressed',()=>{
 const scale=5,{doc,effect}=setup((x,y)=>{
  const distance=Math.abs(Math.hypot(x+.5-64.5,y+.5-64.5)-36);
  const value=Math.round(245-125*Math.exp(-distance*distance/(2*.75*.75)));
  return [value,value,value,255];
 },128,128);
 Object.assign(effect.params,{blackLevel:0,whiteLevel:55,lineArt:true,lineStrength:65,lineWidth:1});
 const png=raster(renderSVG(doc),scale),widths=[];
 for(let degrees=0;degrees<360;degrees+=5){
  const angle=degrees*Math.PI/180,nx=Math.cos(angle),ny=Math.sin(angle),x=64.5+36*nx,y=64.5+36*ny;
  const measured=measureProfile(strokeProfile(png,x,y,nx,ny,scale,2.5));
  assert.equal(measured.runs.length,1,`curve has one connected stroke at ${degrees} degrees`);
  assert.ok(Math.abs(measured.centroid)<.3,`curve stays on the radius-36 pixel-center path at ${degrees} degrees`);
  assert.ok(measured.coverage>.65&&measured.coverage<1.35,`curve thickness stays near one pixel at ${degrees} degrees (${measured.coverage})`);
  widths.push(measured.coverage);
 }
 assert.ok(Math.max(...widths)-Math.min(...widths)<.4,'curved stroke thickness stays stable around the loop');
 doc.layers[0]=source('image',128,128,(x,y)=>{const value=230+(x*17+y*31)%5;return [value,value,value,255];});
 assert.equal(ink(raster(renderSVG(doc))),0,'low-amplitude noise does not become scattered ink');
});

test('thin separated lines and small eye contours survive while broad gray and black fills stay complete',()=>{
 const scale=5,eyes=[[60.5,42.5],[72.5,42.5]],rx=3.5,ry=2.5;
 const {doc,effect}=setup((x,y)=>{
  if(x>=90&&x<122&&y>=12&&y<84)return [128,128,128,255];
  if(x>=126&&x<158&&y>=12&&y<84)return [24,24,24,255];
  if(x>=10&&x<43&&(y===20||y===24))return [28,28,28,255];
  const px=x+.5,py=y+.5;
  for(const [cx,cy] of eyes){
   const ellipse=Math.hypot((px-cx)/rx,(py-cy)/ry);
   if(Math.abs(ellipse-1)*Math.min(rx,ry)<=.5)return [30,30,30,255];
  }
  return [235,235,235,255];
 },160,128);
 assert.equal(effect.params.blackLevel,65,'the separation check uses the default black threshold');
 Object.assign(effect.params,{lineArt:true,lineStrength:65,lineWidth:1});
 const png=raster(renderSVG(doc),scale);
 const pair=measureProfile(strokeProfile(png,28.5,22.5,0,1,scale,5));
 assert.equal(pair.runs.length,2,'two dark lines four pixels apart remain separate');
 assert.ok(Math.abs(pair.runs[0].center+2)<.25&&Math.abs(pair.runs[1].center-2)<.25,'separated line centers stay at y=20.5 and y=24.5');
 assert.ok(pair.runs.every(run=>run.width>.65&&run.width<1.4),'each separated line remains a single thin stroke');
 effect.params.lineWidth=.25;
 const quarter=raster(renderSVG(doc),scale);
 for(const y of [20.5,24.5]){
  const coverage=measureProfile(strokeProfile(quarter,28.5,y,0,1,scale,1.5)).coverage;
  assert.ok(Math.abs(coverage-.25)<.12,'dark source strokes also thin to 0.25 instead of retaining a thick tonal fill');
 }
 for(const [cx,cy] of eyes){
  for(let degrees=0;degrees<360;degrees+=15){
   const angle=degrees*Math.PI/180,px=cx+rx*Math.cos(angle),py=cy+ry*Math.sin(angle),nx=Math.cos(angle)/rx,ny=Math.sin(angle)/ry;
   const contour=measureProfile(strokeProfile(png,px,py,nx,ny,scale,2));
   assert.equal(contour.runs.length,1,`eye outline is continuous at ${degrees} degrees around (${cx}, ${cy})`);
   assert.ok(Math.abs(contour.centroid)<.45,`eye outline stays on its small closed contour at ${degrees} degrees around (${cx}, ${cy})`);
   assert.ok(contour.coverage>.55&&contour.coverage<1.45,'eye outline retains a thin measured raster width');
  }
 }
 for(let y=38;y<58;y++)for(let x=96;x<116;x++)assert.deepEqual(pixelAtSourceCenter(png,x,y,scale),[136,136,136,255],'broad gray fill remains intact');
 for(let y=38;y<58;y++)for(let x=132;x<152;x++)assert.deepEqual(pixelAtSourceCenter(png,x,y,scale),[0,0,0,255],'broad black fill remains intact');
});

test('line-width settings change measured high-resolution raster coverage at 0.25, 1 and 3 pixels',()=>{
 const scale=5,measured=[];
 for(const lineWidth of [.25,1,3]){
  const {doc,effect}=setup((x,y)=>{
   const distance=Math.abs(y+.5-64.5),value=Math.round(245-125*Math.exp(-distance*distance/(2*.75*.75)));
   return [value,value,value,255];
  },128,128);
  Object.assign(effect.params,{blackLevel:0,whiteLevel:55,lineArt:true,lineStrength:65,lineWidth});
  const png=raster(renderSVG(doc),scale),coverage=measureProfile(strokeProfile(png,64.5,64.5,0,1,scale,4)).coverage;
  assert.ok(Math.abs(coverage-lineWidth)<.12,`line width ${lineWidth} has measured coverage ${coverage}`);
  measured.push(coverage);
 }
 assert.ok(measured[1]-measured[0]>.5,'0.25 and 1 pixel widths have measurably different raster coverage');
 assert.ok(measured[2]-measured[1]>1.3,'1 and 3 pixel widths have measurably different raster coverage');
});

test('density 2048 survives serialization and produces finite screened fill even for a tiny source',()=>{
 const {doc,effect}=setup(()=>[128,128,128,255],128,128);
 doc.layers[0]=source('image',1,1,()=>[128,128,128,255]);
 Object.assign(effect.params,{screentone:true,toneDensity:2048});
 const restored=normalizeDocument(JSON.parse(JSON.stringify(doc)));
 assert.equal(restored.layers[1].params.toneDensity,2048);
 const svg=renderSVG(restored),pattern=svg.match(/<pattern id="manga-manga-screen"[^>]+/)[0];
 for(const name of ['width','height']){
  const value=Number(pattern.match(new RegExp(name+'="([^\"]+)"'))[1]);
  assert.ok(value>0&&Math.abs(value-1/2048)<1e-10,`${name} does not round to zero at high density`);
 }
 assert.doesNotMatch(svg,/NaN|Infinity/);
 const center=pixel(raster(svg),64,64);
 assert.equal(center[3],255);assert.ok(center[0]<=136,'high-density screening retains gray fill instead of disappearing');
});
