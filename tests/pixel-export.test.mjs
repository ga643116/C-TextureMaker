/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import {Resvg} from '@resvg/resvg-js';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {createDocument,createLayer,renderSVG,normalizeDocument} from '../app/engine.mjs';
import {pixelExportSize,resizeSVG} from '../app/pixel-export.mjs';
test('grid output is genuinely smaller than the minimum canvas and ignores PNG enlargement',()=>{
 const doc=createDocument();doc.width=1024;doc.height=512;const layer=createLayer('pixel','pixel-export');doc.layers=[layer];
 layer.params.pixelCount=32;layer.params.outputSize='grid';
 const before=JSON.stringify(doc);
 for(const format of ['svg','png'])for(const mult of [1,2,4])assert.deepEqual(pixelExportSize(doc,layer,format,mult),{width:32,height:16});
 const svg=resizeSVG(renderSVG(doc),32,16);
 assert.match(svg,/<svg[^>]*width="32"[^>]*height="16"/);assert.match(svg,/viewBox="0 0 1024 512"/);
 assert.equal(JSON.stringify(doc),before);assert.equal(normalizeDocument(doc).width,1024);
 layer.params.outputSize='canvas';assert.deepEqual(pixelExportSize(doc,layer,'png',2),{width:2048,height:1024});
 assert.deepEqual(pixelExportSize(doc,layer,'svg',4),{width:1024,height:512});
 assert.deepEqual(pixelExportSize(doc,null,'png',4),{width:4096,height:2048});
});

test('rounded grid dimensions fill the PNG without transparent letterbox edges',()=>{
 const doc=createDocument();doc.width=640;doc.height=935;doc.transparent=true;
 const layer=createLayer('pixel','rounded-grid');doc.layers=[layer];
 Object.assign(layer.params,{sizeMode:'width',pixelCount:4,outputSize:'grid'});
 layer.color=layer.secondary='#ff0000';
 const {width,height}=pixelExportSize(doc,layer,'png');assert.deepEqual([width,height],[4,6]);
 const svg=resizeSVG(renderSVG(doc),width,height),png=PNG.sync.read(new Resvg(svg).render().asPng());
 for(let i=0;i<png.data.length;i+=4)assert.deepEqual([...png.data.subarray(i,i+4)],[255,0,0,255]);
});
