/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const IMAGE_TYPES=['image/png','image/jpeg','image/webp'];
const MAX_BYTES=16*1024*1024;
export function clipboardImageFile(data){
 for(const item of Array.from(data?.items??[]))if(item.kind==='file'&&IMAGE_TYPES.includes(item.type)){
  const file=item.getAsFile();if(file)return file;
 }
 return Array.from(data?.files??[]).find(file=>IMAGE_TYPES.includes(file.type))??null;
}
export function createImageClipboard({host,clipboard=globalThis.navigator?.clipboard,timeoutMs=10000}={}){
 let sequence=0,pending=null;
 const native=host&&typeof host.postMessage==='function'&&typeof host.addEventListener==='function'?host:null;
 const asFile=(blob)=>new File([blob],'clipboard.'+(blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'),{type:blob.type});
 if(native)native.addEventListener('message',event=>{
  const reply=event?.data;if(!pending||reply?.type!=='clipboard-image-result'||reply.id!==pending.id)return;
  const job=pending;pending=null;clearTimeout(job.timer);
  try{
   if(!reply.ok)throw new Error(reply.error||'Clipboard image read failed');
   if(reply.empty){job.resolve(null);return;}
   if(reply.mime!=='image/png'||typeof reply.base64!=='string'||reply.base64.length%4||reply.base64.length>Math.ceil(MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(reply.base64))throw new Error('Invalid clipboard image');
   const binary=atob(reply.base64);if(!binary.length||binary.length>MAX_BYTES)throw new Error('Invalid clipboard image size');
   job.resolve(asFile(new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'image/png'})));
  }catch(error){job.reject(error);}
 });
 return {native:Boolean(native),async read(){
  if(native){
   if(pending)throw new Error('Clipboard read already active');
   return new Promise((resolve,reject)=>{
    const id='clipboard-image-'+(++sequence).toString(36),job={id,resolve,reject,timer:null};pending=job;
    job.timer=setTimeout(()=>{if(pending===job){pending=null;reject(new Error('Clipboard read timed out'));}},timeoutMs);
    try{native.postMessage({type:'clipboard-image',id});}catch(error){clearTimeout(job.timer);pending=null;reject(error);}
   });
  }
  if(typeof clipboard?.read!=='function')throw new Error('Clipboard image read unavailable');
  const items=await clipboard.read();
  for(const item of items){const type=IMAGE_TYPES.find(type=>item.types.includes(type));if(type){const blob=await item.getType(type);if(blob.size>MAX_BYTES)throw new Error('Clipboard image too large');return asFile(blob);}}
  return null;
 }};
}
