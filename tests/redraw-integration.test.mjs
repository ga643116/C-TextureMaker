/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,createLayer,normalizeDocument,switchLayerPattern,resetLayerPattern,renderSVG} from '../app/engine.mjs';
import {createUserPreset,applyUserPreset} from '../app/user-presets.mjs';
import {Resvg} from '@resvg/resvg-js';
import {PNG} from 'pngjs';

const data=()=>({version:1,width:128,height:128,detail:55,regions:[
 {id:'r0',color:'#e8c993',role:0,rings:[[8,8,64,8,64,120,8,120],[20,40,20,60,40,60,40,40]]},
 {id:'r1',color:'#235a88',role:2,rings:[[70,8,120,8,120,120,70,120]]},
],lines:[]});
function fixture(){const d=createDocument();d.width=d.height=128;const l=createLayer('redraw','redraw-main');l.redrawData=data();l.redrawEdits={r1:{color:'#a31a42'}};l.redrawPalette=['#ffffff','#ffce00','#121212'];d.layers=[l];return d;}
const raster=d=>PNG.sync.read(new Resvg(renderSVG(d)).render().asPng());
const pixel=(image,x,y)=>[...image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)];

test('generated geometry and edits survive project, pattern history, presets and undo snapshots',()=>{
 const doc=fixture(),layer=doc.layers[0],saved=normalizeDocument(JSON.parse(JSON.stringify(doc)));
 assert.deepEqual(saved.layers[0].redrawData,layer.redrawData);
 assert.deepEqual(saved.layers[0].redrawEdits,layer.redrawEdits);
 const away=switchLayerPattern(saved.layers[0],'dots'),back=switchLayerPattern(away,'redraw');
 assert.deepEqual(back.redrawData,layer.redrawData);assert.deepEqual(back.redrawEdits,layer.redrawEdits);
 const preset=createUserPreset(doc,layer.id,{id:'saved-regions',name:'Editable cutout'});
 const target=createDocument(),applied=applyUserPreset(target,target.layers[0].id,preset,'new-id');
 assert.deepEqual(applied.document.layers[0].redrawData,layer.redrawData);
 assert.deepEqual(applied.document.layers[0].redrawEdits,layer.redrawEdits);
 applied.document.layers[0].redrawData.regions[0].rings[0][0]=10;
 assert.equal(layer.redrawData.regions[0].rings[0][0],8,'preset must not alias geometry');
 assert.equal(resetLayerPattern(back).redrawData,null);assert.deepEqual(resetLayerPattern(back).redrawEdits,{});
});

test('older active layers and cached snapshots restore with empty redraw state',()=>{
 const d=createDocument();let l=switchLayerPattern(d.layers[0],'dots');
 for(const state of [l,...Object.values(l.patternSettings)])for(const key of ['redrawData','redrawEdits','redrawPalette','redrawPlacement'])delete state[key];
 d.layers=[l];const normalized=normalizeDocument(d);
 assert.equal(normalized.layers[0].redrawData,null);
 assert.deepEqual(normalized.layers[0].redrawEdits,{});
 assert.equal(switchLayerPattern(normalized.layers[0],'contour').redrawData,null);
});

test('SVG and PNG retain region color, transparency and holes; hidden regions are absent',()=>{
 const d=fixture(),l=d.layers[0];l.params.straightness=0;
 const svg=renderSVG(d),image=raster(d);
 assert.doesNotMatch(svg,/<image|data-redraw-region/);
 assert.deepEqual(pixel(image,12,12),[232,201,147,255]);
 assert.equal(pixel(image,30,50)[3],0,'inner hole stays transparent');
 assert.deepEqual(pixel(image,90,60),[163,26,66,255]);
 l.redrawEdits.r1.hidden=true;
 assert.doesNotMatch(renderSVG(d),/#a31a42/);
 assert.equal(pixel(raster(d),90,60)[3],0);
 assert.match(renderSVG(d,{preview:true}),/data-redraw-region="r1"/,'hidden region remains recoverable in preview');
});

test('malformed redraw payloads and orphan edits fail before rendering or applying presets',()=>{
 for(const mutate of [
  l=>l.redrawData.regions[0].rings[0][0]=Infinity,
  l=>l.redrawEdits={missing:{hidden:true}},
  l=>l.redrawPalette=['javascript:alert(1)'],
  l=>l.redrawData.regions[0].color='url(https://example.com)',
 ]){const d=fixture();mutate(d.layers[0]);assert.throws(()=>normalizeDocument(d));}
});
