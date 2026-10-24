/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Resvg} from '@resvg/resvg-js';
import {createDocument,createImageMaskLayer,createLayer,renderSVG,normalizeDocument,switchLayerPattern,imageMaskGeometry} from '../app/engine.mjs';
import {encodeColorMap} from '../app/image-color.mjs';
import {capturePlacement} from '../app/redraw-placement.mjs';

function setup(type='lineart',opacity=255){
 const png=new PNG({width:128,height:128});
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const dark=(Math.abs(x-35)<2||Math.abs(x-92)<2)&&y>20&&y<108;
  png.data.set(dark?[12,12,12,opacity]:[240,220,210,opacity],(y*128+x)*4);
 }
 const doc=createDocument();Object.assign(doc,{width:128,height:128,transparent:true});
 const image=createImageMaskLayer({id:'source',name:'source',image:'data:image/png;base64,'+PNG.sync.write(png).toString('base64'),imageWidth:128,imageHeight:128,mode:'color',colorMap:encodeColorMap({width:128,height:128,data:new Uint8ClampedArray(png.data)})});
 const effect=createLayer(type,'effect');effect.imageSource='below';doc.layers=[image,effect];
 return {doc,image,effect};
}
const raster=doc=>PNG.sync.read(new Resvg(renderSVG(doc),{font:{loadSystemFonts:false}}).render().asPng());
const alpha=png=>Uint8Array.from({length:png.width*png.height},(_,i)=>png.data[i*4+3]);
function inkMask(svg){const value=svg.match(/<mask id="flow-ink-[\s\S]*?<image href="data:image\/png;base64,([^"]+)"/);assert.ok(value,'shared flow mask exists');return PNG.sync.read(Buffer.from(value[1],'base64'));}
function attachRegions(doc,image,effect){
 effect.redrawData={version:1,width:128,height:128,detail:55,regions:[
  {id:'r0',color:'#e8c993',role:0,rings:[[0,0,64,0,64,128,0,128]]},
  {id:'r1',color:'#235a88',role:2,rings:[[64,0,128,0,128,128,64,128]]}
 ],lines:[]};
 effect.redrawPlacement=capturePlacement(doc,[image],imageMaskGeometry);
 effect.params.mode='outline';
}

test('standalone line extraction exports only ink with transparent clear areas and requested color',()=>{
 const {doc,effect}=setup();effect.params.lineColor='#1263a4';
 const png=raster(doc),coverage=alpha(png);
 assert.ok(coverage.some(a=>a>128),'visible ink');
 assert.equal(coverage[64*128+64],0,'flat source color is removed');
 assert.equal(coverage[5*128+5],0,'no white paper fill');
 for(let i=0;i<coverage.length;i++)if(coverage[i]>200){
  assert.ok(Math.abs(png.data[i*4]-18)<=1);
  assert.ok(Math.abs(png.data[i*4+1]-99)<=1);
  assert.ok(Math.abs(png.data[i*4+2]-164)<=1);
 }
 effect.params.lineColor='#f04020';
 assert.deepEqual(alpha(raster(doc)),coverage,'recolor changes only RGB, not extraction');
});

test('all three patterns share the exact extracted ink for identical source and controls',()=>{
 const {doc,image,effect}=setup();
 const reference=alpha(inkMask(renderSVG(doc)));
 for(const type of ['manga','redraw']){
  const next=createLayer(type,'effect');next.imageSource='below';doc.layers=[image,next];
  if(type==='redraw')attachRegions(doc,image,next);
  assert.deepEqual(alpha(inkMask(renderSVG(doc))),reference,type+' uses shared Flow-XDoG');
 }
});

test('line parameters persist per pattern and legacy manga strength migrates only when detail is missing',()=>{
 const {doc,effect}=setup();Object.assign(effect.params,{lineDetail:149,lineSmooth:3,lineScale:.65,lineWidth:.5});
 const before={...effect.params};doc.layers[1]=switchLayerPattern(switchLayerPattern(effect,'manga'),'lineart');
 assert.deepEqual(doc.layers[1].params,before);
 assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))).layers[1].params,before);
 const legacy=switchLayerPattern(doc.layers[1],'manga');doc.layers[1]=legacy;delete legacy.params.lineDetail;legacy.params.lineStrength=55;
 assert.equal(normalizeDocument(doc).layers[1].params.lineDetail,159);
 legacy.params.lineDetail=99;assert.equal(normalizeDocument(doc).layers[1].params.lineDetail,99);
});

test('source movement and redraw placement transform the shared lines exactly once',()=>{
 const {doc,image,effect}=setup('redraw');attachRegions(doc,image,effect);
 for(const transform of [{offsetX:7},{offsetX:0,rotation:90},{rotation:0,flipX:true}]){
  Object.assign(image,transform);
  const redraw=alpha(raster(doc));
  const line=createLayer('lineart','effect');line.imageSource='below';doc.layers=[image,line];
  assert.deepEqual(alpha(raster(doc)),redraw,'redraw lines align with live source');
  doc.layers=[image,effect];
 }
});

test('redraw region hiding clips shared lines and changing line controls preserves edits',()=>{
 const {doc,image,effect}=setup('redraw');attachRegions(doc,image,effect);
 effect.redrawEdits={r0:{hidden:true},r1:{color:'#ff9900'}};
 effect.params.lineDetail=179;
 const png=raster(doc);let left=0,right=0;
 for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(x<64)left+=png.data[(y*128+x)*4+3];else right+=png.data[(y*128+x)*4+3];
 assert.equal(left,0);assert.ok(right>1000);
 assert.deepEqual(normalizeDocument(doc).layers[1].redrawEdits,effect.redrawEdits);
 effect.params.mode='blocks';effect.params.lines=true;
 const color=raster(doc),i=(64*128+110)*4;
 assert.deepEqual([...color.data.slice(i,i+4)],[255,153,0,255]);
});

test('partial source alpha is applied once and missing sources produce no line output',()=>{
 const {doc,image,effect}=setup('lineart',128);
 assert.ok(Math.max(...alpha(raster(doc)))<=128);
 const manga=createLayer('manga','effect');manga.imageSource='below';doc.layers=[image,manga];
 const output=raster(doc);assert.equal(output.data[(64*128+35)*4+3],128,'paper and ink combined retain source alpha');
 doc.layers=[effect];assert.doesNotMatch(renderSVG(doc),/data-flow-lines/);
});
