/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
export function createScreenColorPicker({host,EyeDropper=globalThis.EyeDropper,timeoutMs=180000}={}){
 let sequence=0,pending=null,busy=false;
 const native=host&&typeof host.postMessage==='function'&&typeof host.addEventListener==='function'?host:null;
 const color=value=>{if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Invalid screen color');return value.toLowerCase();};
 if(native)native.addEventListener('message',event=>{
  const reply=event?.data;if(!pending||reply?.type!=='pick-color-result'||reply.id!==pending.id)return;
  const job=pending;pending=null;clearTimeout(job.timer);
  if(reply.cancelled)job.resolve(null);
  else if(reply.ok&&/^#[0-9a-f]{6}$/i.test(reply.color))job.resolve(reply.color.toLowerCase());
  else job.reject(new Error(reply.error||'Screen color selection failed'));
 });
 const pickNative=()=>new Promise((resolve,reject)=>{
  const id='screen-color-'+(++sequence).toString(36),job={id,resolve,reject,timer:null};pending=job;
  job.timer=setTimeout(()=>{if(pending===job){pending=null;reject(new Error('Screen color selection timed out'));}},timeoutMs);
  try{native.postMessage({type:'pick-color',id});}catch(error){clearTimeout(job.timer);pending=null;reject(error);}
 });
 return {async pick(){
  if(busy)throw new Error('Screen color selection is already active');
  busy=true;
  try{
   if(native)return await pickNative();
   if(typeof EyeDropper==='function'){
    const controller=new AbortController(),target=globalThis.document;
    const cancelRight=event=>{if(event.type==='contextmenu'||event.button===2){event.preventDefault();controller.abort();}};
    target?.addEventListener('pointerdown',cancelRight,{capture:true});target?.addEventListener('contextmenu',cancelRight,{capture:true});
    try{return color((await new EyeDropper().open({signal:controller.signal}))?.sRGBHex);}
    catch(error){
     if(error?.name==='AbortError')return null;
     throw error;
    }finally{target?.removeEventListener('pointerdown',cancelRight,{capture:true});target?.removeEventListener('contextmenu',cancelRight,{capture:true});}
   }
   throw new Error('Screen color selection is unavailable');
  }finally{busy=false;}
 }};
}
