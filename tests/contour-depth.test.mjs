/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderContours } from '../app/contours.mjs';

const legacyGeometryHash = 'd2b9ee2eeb1133a55f5f14265be0e4990ec952a9d63eca563ac82479178bbae4';
const pathData = source => [...source.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(match => match[1]);
function fixture(id='contour-depth-legacy') {
  const doc={width:128,height:128,seed:42,seamless:false};
  const layer={id,type:'contour',rotation:0,scale:1,color:'#112233',secondary:'#445566',params:{
    peaks:3,terrainScale:1.75,sampling:72,levels:4,octaves:3,roughness:0.65,strokeWidth:1.5,
    depth:false,shadowRange:16,shadowOffset:10,shadowAngle:45,shadowColor:'#123e3b',shadowOpacity:0.35,shadowSide:'outer'
  }};
  return {doc,layer};
}
const hashPaths=paths=>createHash('sha256').update(JSON.stringify(paths)).digest('hex');
const finiteBounds=bounds=>bounds&&Object.values(bounds).every(Number.isFinite);

test('depth=false preserves the pre-extraction contour path geometry',()=>{
  const {doc,layer}=fixture();
  const result=renderContours(layer,doc);
  assert.equal(hashPaths(pathData(result.content)),legacyGeometryHash,'the extracted paths should match the old engine contour geometry');
  assert.equal(result.world,false);
  assert.ok(finiteBounds(result.bounds));
});

test('depth regions keep a secondary base, closed evenodd holes, and canonical seamless bounds',()=>{
  const {doc,layer}=fixture('contour-depth-holes');
  doc.seamless=true;
  layer.rotation=27;
  layer.scale=0.73;
  Object.assign(layer.params,{depth:true,levels:10,sampling:72});
  const result=renderContours(layer,doc);
  const paths=pathData(result.content);
  assert.match(result.content,/<rect x="0" y="0" width="128" height="128" fill="#445566"\/>/,'the secondary base should fill the whole canonical canvas');
  assert.ok(paths.length>0,'filled contour polygons should be emitted');
  assert.ok(paths.every(path=>path.endsWith('Z')),'each d3 contour ring should be closed');
  assert.match(result.content,/fill-rule="evenodd"/,'holes must use evenodd fill semantics');
  assert.ok(paths.some(path=>(path.match(/Z/g)||[]).length>=2),'at least one polygon should retain a hole ring');
  const filterCount=(result.content.match(/<filter\b/g)||[]).length;
  assert.equal((result.content.match(/<use\b/g)||[]).length,filterCount*9,'each filtered contour level should reference its geometry nine times');
  assert.deepEqual(result.bounds,{minX:0,minY:0,maxX:128,maxY:128});
  assert.equal(result.world,true);
  assert.match(result.content,/contour-depth-contour-depth-holes-tile/);
});

test('seamless offsets wrap by tile periods and large blur expands source coverage',()=>{
  const {doc,layer}=fixture('contour-depth-periodic-shadow');
  doc.seamless=true;
  Object.assign(layer.params,{depth:true,levels:5,sampling:72,shadowAngle:0,shadowRange:16,shadowOffset:0});
  const noOffset=renderContours(layer,doc).content;
  layer.params.shadowOffset=256;
  assert.equal(renderContours(layer,doc).content,noOffset,'a 256px offset across a 128px tile period should wrap to zero');

  Object.assign(layer.params,{shadowAngle:45,shadowRange:128,shadowOffset:256});
  const result=renderContours(layer,doc);
  const filters=[...result.content.matchAll(/<filter\b[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
  const uses=[...result.content.matchAll(/<use\b[^>]*x="(-?[\d.]+)" y="(-?[\d.]+)"/g)];
  assert.ok(filters.length>0);
  assert.equal(uses.length,filters.length*25,'the maximum blur and wrapped offset require a 5 by 5 source neighborhood');
  assert.ok(uses.some(match=>Number(match[1])===-256&&Number(match[2])===-256),'the source neighborhood should cover the outer negative corner');
  assert.ok(uses.some(match=>Number(match[1])===256&&Number(match[2])===256),'the source neighborhood should cover the outer positive corner');
  for(const filter of filters){
    const values=filter.slice(1).map(Number);
    assert.ok(values.every(Number.isFinite)&&values[2]>0&&values[3]>0,'filter bounds should remain finite and nonempty');
  }
});

test('depth shadows and fillPaint controls affect the generated SVG',()=>{
  const {doc,layer}=fixture('contour-depth-controls');
  Object.assign(layer.params,{depth:true,levels:8,sampling:72});
  const base=renderContours(layer,doc).content;
  const variants=[
    {...layer.params,shadowSide:'inner'},
    {...layer.params,shadowRange:32},
    {...layer.params,shadowOffset:38},
    {...layer.params,shadowAngle:-90},
    {...layer.params,shadowColor:'#ab3210'},
    {...layer.params,shadowOpacity:0.8}
  ];
  for(const params of variants){
    const changed=renderContours({...layer,params},doc).content;
    assert.notEqual(changed,base,'changing a shadow control should change its filter output');
  }
  const painted=renderContours(layer,doc,{fillPaint:'url(#image-color-paint-layer)'}).content;
  assert.match(painted,/fill="url\(#image-color-paint-layer\)"/);
  assert.match(painted,/flood-color="#123e3b"/,'the shadow color should stay independent of fillPaint');
  assert.match(painted,/<rect x="0" y="0" width="128" height="128" fill="url\(#image-color-paint-layer\)"/,'fillPaint should color the base too');
  assert.ok(finiteBounds(renderContours(layer,doc).bounds));
});
