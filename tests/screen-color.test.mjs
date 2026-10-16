/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createScreenColorPicker} from '../app/screen-color.mjs';
function host(){const h={messages:[],postMessage(value){this.messages.push(value);},addEventListener(type,fn){this.reply=fn;}};return h;}
test('native screen picker correlates replies, returns color and allows retry after cancellation',async()=>{
 const h=host(),picker=createScreenColorPicker({host:h}),pending=picker.pick();
 assert.equal(h.messages[0].type,'pick-color');
 await assert.rejects(picker.pick(),/already active/);
 h.reply({data:{type:'pick-color-result',id:'wrong',ok:true,color:'#ffffff'}});
 h.reply({data:{type:'pick-color-result',id:h.messages[0].id,ok:true,color:'#ABCDEF'}});
 assert.equal(await pending,'#abcdef');
 const cancel=picker.pick();h.reply({data:{type:'pick-color-result',id:h.messages[1].id,cancelled:true}});assert.equal(await cancel,null);
 const invalid=picker.pick();h.reply({data:{type:'pick-color-result',id:h.messages[2].id,ok:true,color:'red'}});await assert.rejects(invalid,/failed/);
});
test('native timeout and bridge errors release pending selection',async()=>{
 const h=host(),picker=createScreenColorPicker({host:h,timeoutMs:5});
 await assert.rejects(picker.pick(),/timed out/);
 h.postMessage=()=>{throw Error('bridge unavailable');};
 await assert.rejects(picker.pick(),/bridge unavailable/);
});
test('browser eyedropper handles color, Escape and missing capability without screen access in tests',async()=>{
 assert.equal(await createScreenColorPicker({EyeDropper:class{async open(){return {sRGBHex:'#123ABC'};}}}).pick(),'#123abc');
 assert.equal(await createScreenColorPicker({EyeDropper:class{async open(){throw Object.assign(Error('cancel'),{name:'AbortError'});}}}).pick(),null);
 await assert.rejects(createScreenColorPicker({EyeDropper:null}).pick(),/unavailable/);
 await assert.rejects(createScreenColorPicker({EyeDropper:class{async open(){return {sRGBHex:'invalid'};}}}).pick(),/Invalid/);
});
