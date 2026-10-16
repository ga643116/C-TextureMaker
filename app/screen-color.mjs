/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
export function createScreenColorPicker({host,EyeDropper=globalThis.EyeDropper,timeoutMs=180000}={}){
 let sequence=0,pending=null;
 const native=host&&typeof host.postMessage==='function'&&typeof host.addEventListener==='function'?host:null;
 if(native)native.addEventListener('message',event=>{
  const reply=event?.data;if(!pending||reply?.type!=='pick-color-result'||reply.id!==pending.id)return;
  const job=pending;pending=null;clearTimeout(job.timer);
  if(reply.cancelled)job.resolve(null);
  else if(reply.ok&&/^#[0-9a-f]{6}$/i.test(reply.color))job.resolve(reply.color.toLowerCase());
  else job.reject(new Error(reply.error||'Screen color selection failed'));
 });
 return {async pick(){
  if(pending)throw new Error('Screen color selection is already active');
  if(native)return new Promise((resolve,reject)=>{
   const id='screen-color-'+(++sequence).toString(36),job={id,resolve,reject,timer:null};pending=job;
   job.timer=setTimeout(()=>{if(pending===job){pending=null;reject(new Error('Screen color selection timed out'));}},timeoutMs);
   try{native.postMessage({type:'pick-color',id});}catch(error){clearTimeout(job.timer);pending=null;reject(error);}
  });
  if(typeof EyeDropper!=='function')throw new Error('Screen color selection is unavailable');
  try{const result=await new EyeDropper().open();if(!/^#[0-9a-f]{6}$/i.test(result?.sRGBHex))throw new Error('Invalid screen color');return result.sRGBHex.toLowerCase();}
  catch(error){if(error?.name==='AbortError')return null;throw error;}
 }};
}
