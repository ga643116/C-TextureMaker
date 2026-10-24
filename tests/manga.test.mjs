/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Resvg} from '@resvg/resvg-js';
import {createMangaEngine} from '../app/manga.mjs';
import {createLineArtEngine} from '../app/line-art.mjs';
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
function ink(png,x0=0,x1=png.width){let count=0;for(let y=2;y<png.height-2;y++)for(let x=x0;x<x1;x++){const i=(y*png.width+x)*4;if(png.data[i+3]>128&&png.data[i]<64)count++;}return count;}
function lineArtEngine(){return createLineArtEngine({resolveColorSources,imageMaskGeometry,createCompositeColorSampler,createImageColorSampler});}
function lineMask(engine,doc,layer){
 const width=doc.width,height=doc.height,fragment=engine.render(doc,layer),svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+fragment+'</svg>';
 let coverage=0,pixels=0;
 const png=raster(svg);
 for(let i=3;i<png.data.length;i+=4){coverage+=png.data[i]/255;if(png.data[i]>0)pixels++;}
 return {svg,png,coverage,pixels};
}
function maskHasInk(mask,x0,x1,y0,y1,threshold=8){
 const {png}=mask;
 for(let y=Math.max(0,y0);y<Math.min(png.height,y1);y++)for(let x=Math.max(0,x0);x<Math.min(png.width,x1);x++)if(png.data[(y*png.width+x)*4+3]>threshold)return true;
 return false;
}

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

test('line extraction reveals a weak luminance edge as detail increases and warm output is stable',()=>{
 const {doc,effect}=setup(x=>x<32?[220,220,220,255]:[255,255,255,255],64,64),engine=lineArtEngine();
 effect.params.lineArt=true;effect.params.lineDetail=49;
 const low=lineMask(engine,doc,effect);
 effect.params.lineDetail=99;
 const high=lineMask(engine,doc,effect),warm=lineMask(engine,doc,effect);
 assert.ok(high.coverage>low.coverage,'higher line detail reveals the weak luminance edge');
 assert.ok(high.pixels>low.pixels,'higher line detail adds visible mask pixels');
 assert.deepEqual(warm.png.data,high.png.data,'warm Flow-XDoG output matches the cold render');
 assert.doesNotMatch(high.svg,/NaN|Infinity/);
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
 Object.assign(effect.params,{blackLevel:80,whiteLevel:170,lineStrength:77,lineDetail:149,lineSmooth:2.6,lineScale:.9,toneShape:'diamond',toneSize:72,toneDensity:24});
 const before=renderSVG(doc),params={...effect.params},index=doc.layers.indexOf(effect);
 let switched=switchLayerPattern(effect,'dots');doc.layers[index]=switched;
 switched=switchLayerPattern(switched,'manga');doc.layers[index]=switched;
 assert.deepEqual(switched.params,params);
 assert.equal(renderSVG(normalizeDocument(JSON.parse(JSON.stringify(doc)))),before);
 const legacy=JSON.parse(JSON.stringify(doc));delete legacy.layers[index].params.lineDetail;legacy.layers[index].params.lineStrength=77;
 const migrated=normalizeDocument(legacy);assert.equal(migrated.layers[index].params.lineDetail,203);assert.equal(migrated.layers[index].params.lineStrength,77);
 switched.params.blackLevel=190;switched.params.whiteLevel=100;
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


test('Flow-XDoG keeps a thin line visible and continuous without invalid SVG',()=>{
 const {doc,effect}=setup((x,y)=>x>=34&&x<=36&&y>=8&&y<=63?[18,18,18,255]:[255,255,255,255],72,72);
 effect.params.lineArt=true;
 const mask=lineMask(lineArtEngine(),doc,effect);
 assert.ok(mask.coverage>0&&mask.pixels>0,'dark stroke creates a non-empty alpha mask');
 for(let y=14;y<=57;y++)assert.ok(maskHasInk(mask,30,42,y,y+1),`stroke remains visible at y=${y}`);
 assert.doesNotMatch(mask.svg,/NaN|Infinity/);
 doc.layers[0]=source('image',72,72,(x,y)=>{const value=230+(x*17+y*31)%5;return [value,value,value,255];});
 assert.equal(ink(raster(renderSVG(doc))),0,'low-amplitude noise does not become visible ink');
});

test('thin source lines remain visible while broad gray and black fills stay complete',()=>{
 const eyes=[[60.5,42.5],[72.5,42.5]],rx=3.5,ry=2.5;
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
 Object.assign(effect.params,{lineArt:true,lineDetail:149,lineWidth:1});
 const mask=lineMask(lineArtEngine(),doc,effect);
 assert.ok(maskHasInk(mask,10,43,19,22),'first thin source line remains visible');
 assert.ok(maskHasInk(mask,10,43,23,26),'second thin source line remains visible');
 for(const [cx,cy] of eyes)assert.ok(maskHasInk(mask,cx-rx-1,cx+rx+1,cy-ry-1,cy+ry+1),`small eye contour remains visible near (${cx}, ${cy})`);
 assert.doesNotMatch(mask.svg,/NaN|Infinity/);
 const png=raster(renderSVG(doc));
 for(let y=38;y<58;y++)for(let x=96;x<116;x++)assert.deepEqual(pixel(png,x,y),[136,136,136,255],'broad gray fill remains intact');
 for(let y=38;y<58;y++)for(let x=132;x<152;x++)assert.deepEqual(pixel(png,x,y),[0,0,0,255],'broad black fill remains intact');
});

test('line-width settings change integrated mask coverage monotonically',()=>{
 const {doc,effect}=setup((x,y)=>x>=62&&x<=64&&y>=8&&y<=119?[18,18,18,255]:[255,255,255,255],128,128);
 effect.params.lineArt=true;
 const engine=lineArtEngine(),measured=[];
 for(const lineWidth of [.25,1,3]){
  effect.params.lineWidth=lineWidth;
  measured.push(lineMask(engine,doc,effect).coverage);
 }
 assert.ok(measured[0]>0,'the minimum line width retains some line coverage');
 assert.ok(measured[0]<measured[1]&&measured[1]<measured[2],`line coverage increases with width: ${measured.join(' < ')}`);
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
