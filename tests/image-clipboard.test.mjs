/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardImageFile,createImageClipboard} from '../app/image-clipboard.mjs';
function bridge(){let listener;const sent=[];return {sent,postMessage:message=>sent.push(message),addEventListener:(_,fn)=>listener=fn,reply:data=>listener({data})};}
const png=()=>new File([Uint8Array.of(137,80,78,71)],'sample.png',{type:'image/png'});
test('paste event reads image data only and never interprets URLs or HTML as images',()=>{
 const file=png();assert.equal(clipboardImageFile({items:[{kind:'file',type:'image/png',getAsFile:()=>file}]}),file);
 assert.equal(clipboardImageFile({files:[file]}),file);
 assert.equal(clipboardImageFile({items:[{kind:'string',type:'text/html',getAsFile:()=>{throw Error('not an image');}}]}),null);
});
test('browser clipboard is read only on explicit request and prefers PNG representations',async()=>{
 let calls=0;const reader=createImageClipboard({clipboard:{read:async()=>{calls++;return [{types:['text/html','image/jpeg','image/png'],getType:async type=>new Blob(['image'],{type})}];}}});
 assert.equal(calls,0);const file=await reader.read();assert.equal(calls,1);assert.equal(file.type,'image/png');assert.equal(file.name,'clipboard.png');
});
test('native request correlates replies and returns a binary file without touching clipboard content',async()=>{
 const host=bridge(),reader=createImageClipboard({host});assert.equal(host.sent.length,0);
 const promise=reader.read();assert.equal(host.sent[0].type,'clipboard-image');
 const id=host.sent[0].id;host.reply({type:'clipboard-image-result',id:'another',ok:true,empty:true});
 host.reply({type:'clipboard-image-result',id,ok:true,empty:false,mime:'image/png',base64:'iVBORw=='});
 const file=await promise;assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[137,80,78,71]);assert.equal(host.sent.length,1);
});
test('native empty, invalid, failure and timeout paths settle once and release the busy state',async()=>{
 const host=bridge(),reader=createImageClipboard({host,timeoutMs:20});
 let pending=reader.read();await assert.rejects(reader.read(),/already active/);
 host.reply({type:'clipboard-image-result',id:host.sent.at(-1).id,ok:true,empty:true});assert.equal(await pending,null);
 pending=reader.read();host.reply({type:'clipboard-image-result',id:host.sent.at(-1).id,ok:true,mime:'text/html',base64:'iVBORw=='});await assert.rejects(pending,/Invalid clipboard image/);
 pending=reader.read();host.reply({type:'clipboard-image-result',id:host.sent.at(-1).id,ok:false,error:'Clipboard busy'});await assert.rejects(pending,/Clipboard busy/);
 await assert.rejects(reader.read(),/timed out/);
 pending=reader.read();host.reply({type:'clipboard-image-result',id:host.sent.at(-1).id,ok:true,empty:true});assert.equal(await pending,null);
});
test('browser empty and denied clipboard reads remain explicit outcomes',async()=>{
 assert.equal(await createImageClipboard({clipboard:{read:async()=>[]}}).read(),null);
 await assert.rejects(createImageClipboard({clipboard:{read:async()=>{throw Error('Permission denied');}}}).read(),/Permission denied/);
});
