/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Resvg} from '@resvg/resvg-js';
import {createDocument,createLayer,createImageMaskLayer,normalizeDocument,captureRedrawPlacement,renderSVG,imageMaskGeometry,switchLayerPattern} from '../app/engine.mjs';
import {normalizeRedrawPlacement,placementMatrix,canFollowPlacement} from '../app/redraw-placement.mjs';
import {createUserPreset} from '../app/user-presets.mjs';
const fixture=()=>{
 const d=createDocument();d.width=d.height=128;
 const png=new PNG({width:128,height:128});png.data.fill(255);
 const image='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
 const source=createImageMaskLayer({id:'image-a',image,imageWidth:128,imageHeight:128});source.mode='color';
 source.colorMap={width:1,height:1,rgba:Buffer.from([255,255,255,255]).toString('base64')};
 const layer=createLayer('redraw','redraw-a');layer.imageSource='below';layer.params.straightness=0;
 layer.redrawData={version:1,width:128,height:128,detail:55,regions:[{id:'r0',color:'#ff0000',role:1,rings:[[20,20,40,20,40,40,20,40]]}],lines:[]};
 d.layers=[source,layer];layer.redrawPlacement=captureRedrawPlacement(d,layer);return {d,source,layer};
};
const sample=(d,x,y)=>{const png=PNG.sync.read(new Resvg(renderSVG(d)).render().asPng());return [...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];};
const approx=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-7,`${actual} ≈ ${expected}`));
test('existing generated regions follow source translation, rotation, scale and flip without regeneration',()=>{
 const {d,source,layer}=fixture(),original=JSON.stringify(layer.redrawData);
 assert.deepEqual(sample(d,25,25),[255,0,0,255]);source.offsetX=30;source.offsetY=10;
 approx(placementMatrix(layer.redrawPlacement,d,[source],imageMaskGeometry),[1,0,0,1,30,10]);
 assert.equal(sample(d,25,25)[3],0);assert.deepEqual(sample(d,55,35),[255,0,0,255]);
 source.offsetX=source.offsetY=0;source.rotation=90;
 approx(placementMatrix(layer.redrawPlacement,d,[source],imageMaskGeometry),[0,1,-1,0,128,0]);
 assert.deepEqual(sample(d,100,25),[255,0,0,255]);
 source.rotation=0;source.scale=2;approx(placementMatrix(layer.redrawPlacement,d,[source],imageMaskGeometry),[2,0,0,2,-64,-64]);
 source.scale=1;source.flipX=true;assert.deepEqual(sample(d,100,25),[255,0,0,255]);
 assert.equal(JSON.stringify(layer.redrawData),original,'affine placement keeps stable editable region geometry');
});
test('placement persists through save/load and switching patterns while user presets do not bind project image IDs',()=>{
 const {d,source,layer}=fixture();source.offsetX=18;
 const loaded=normalizeDocument(JSON.parse(JSON.stringify(d)));
 assert.deepEqual(loaded.layers[1].redrawPlacement,layer.redrawPlacement);
 assert.deepEqual(switchLayerPattern(switchLayerPattern(loaded.layers[1],'dots'),'redraw').redrawPlacement,layer.redrawPlacement);
 assert.deepEqual(sample(loaded,45,25),[255,0,0,255]);
 const preset=createUserPreset(d,layer.id,{id:'test-preset',name:'Test'});
 assert.doesNotMatch(JSON.stringify(preset),/image-a/);
});
test('seamless rendering wraps moved geometry and preserves editable metadata',()=>{
 const {d,source}=fixture();d.seamless=true;source.offsetX=110;
 assert.deepEqual(sample(d,7,25),[255,0,0,255]);
 assert.match(renderSVG(d,{preview:true}),/data-redraw-region="r0"/);
});
test('multiple sources follow a common transform and require regeneration after relative changes',()=>{
 const {d,source,layer}=fixture(),second={...source,id:'image-b',offsetX:12};d.layers=[source,second,layer];layer.imageSource='all';layer.redrawPlacement=captureRedrawPlacement(d,layer);
 source.offsetY=second.offsetY=8;
 assert.equal(canFollowPlacement(layer.redrawPlacement,d,[source,second],imageMaskGeometry),true);
 approx(placementMatrix(layer.redrawPlacement,d,[source,second],imageMaskGeometry),[1,0,0,1,0,8]);
 second.offsetX+=1;assert.equal(canFollowPlacement(layer.redrawPlacement,d,[source,second],imageMaskGeometry),false);
 assert.equal(placementMatrix(layer.redrawPlacement,d,[source,second],imageMaskGeometry),null);
});
test('malformed source anchors are rejected and old projects accept a missing anchor',()=>{
 const {d,layer}=fixture();
 for(const edit of [v=>v.sources[0].matrix[0]=Infinity,v=>v.sources[0].matrix=[0,0,0,0,0,0],v=>v.sources.push(v.sources[0]),v=>v.width=0]){const bad=structuredClone(layer.redrawPlacement);edit(bad);assert.throws(()=>normalizeRedrawPlacement(bad));}
 delete layer.redrawPlacement;assert.equal(normalizeDocument(d).layers[1].redrawPlacement,null);
});
