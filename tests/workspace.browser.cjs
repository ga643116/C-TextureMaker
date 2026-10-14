/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const engine=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const a=engine.createDocument();Object.assign(a,{name:'Project A',width:768,height:512});a.layers=[engine.createLayer('dots','art'),engine.createLayer('grid','other')];
 const c=engine.createDocument();Object.assign(c,{name:'Project C',width:1024,height:1024});c.layers=[engine.createLayer('waves','art-c')];
 const legacy=engine.createDocument();legacy.name='Legacy project';legacy.layers=[engine.createLayer('dots','old')];legacy.layers[0].params.spacing=91;
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error('outside');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:960}});
  await context.addInitScript(legacy=>{
   localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false}));
   if(!localStorage.getItem('test.initialized')){localStorage.setItem('ctm.presets',JSON.stringify([{id:'legacy',name:'Legacy preset',document:legacy}]));localStorage.setItem('test.initialized','1');}
   const listeners=[];let sequence=0;window.nativeRequests=[];window.nativeNext=null;
   window.emitNative=data=>listeners.forEach(fn=>fn({data}));
   Object.defineProperty(window.chrome,'webview',{value:{addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(msg){
    window.nativeRequests.push(msg);if(msg.type==='window'){if(msg.action==='close')queueMicrotask(()=>window.emitNative({type:'window-close-request'}));return;}
    const next=window.nativeNext;window.nativeNext=null;let reply={id:msg.id,type:msg.type+'-result',ok:true};
    if(next?.cancelled)reply={...reply,ok:false,cancelled:true};else if(next?.error)reply={...reply,ok:false,error:'Write failed'};
    else if(msg.type==='save')reply.projectToken=msg.projectToken&&!msg.saveAs?msg.projectToken:(++sequence).toString(16).padStart(32,'0');
    else if(msg.type==='open')reply={...reply,name:'opened.ctm',projectToken:'f'.repeat(32),base64:btoa(unescape(encodeURIComponent(JSON.stringify(window.nativeOpenDoc))))};
    const respond=()=>window.emitNative(reply);if(next?.defer)window.finishNative=respond;else queueMicrotask(respond);
   }}});
  },legacy);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/app/index.html`);await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const dirty=()=>page.locator('html').getAttribute('data-project-dirty');
  const field=(key,target='params')=>page.locator(`#inspector input[type=number][data-target=${target}][data-key=${key}]`);
  const change=async(key,value,target='params')=>{await field(key,target).fill(String(value));await field(key,target).press('Tab');};
  const file=async doc=>{const wasDirty=await dirty()==='true';await page.locator('#file-project').setInputFiles({name:'test.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});if(wasDirty)await page.locator('#unsaved-discard').click();await page.waitForFunction(name=>document.querySelector('.document-name span')?.textContent===name,doc.name);};
  const lastSave=()=>page.evaluate(()=>window.nativeRequests.filter(r=>r.intent==='project').at(-1));
  const save=async()=>{await page.locator('[data-action=save]').click();await page.waitForFunction(()=>document.documentElement.dataset.projectDirty==='false');return JSON.parse(Buffer.from((await lastSave()).base64,'base64').toString());};
  const countAction=action=>page.evaluate(action=>window.nativeRequests.filter(r=>r.type==='window'&&r.action===action).length,action);
  assert.equal(await dirty(),'false');await file(a);await change('spacing',61);
  await page.locator('#inspector [data-action=save-preset]').click();await page.locator('#name-input').fill('My dots');await page.locator('#name-form').evaluate(f=>f.requestSubmit());await page.waitForTimeout(150);
  await file(c);await save();await save();const token=(await lastSave()).projectToken;
  await page.locator('[data-action=presets]').click();await page.locator('[data-action=preset]').filter({hasText:'My dots'}).click();
  let stored=await save();assert.equal(stored.name,c.name);assert.equal(stored.width,c.width);assert.equal(stored.layers.length,1);assert.equal(stored.layers[0].id,'art-c');assert.equal(stored.layers[0].params.spacing,61);assert.equal((await lastSave()).projectToken,token,'preset retains save destination');
  await page.locator('[data-action=undo]').click();assert.equal(await dirty(),'true');await page.locator('[data-action=redo]').click();assert.equal(await dirty(),'false','redo to saved baseline is clean');
  await file(a);await page.locator('[data-action=presets]').click();await page.locator('[data-action=preset][data-id=legacy]').click();stored=await save();assert.equal(stored.name,a.name);assert.equal(stored.width,768);assert.equal(stored.layers[0].params.spacing,91);assert.deepEqual(stored.layers[1],a.layers[1]);
  const presets=await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('c-texturemaker',1);req.onsuccess=()=>{const db=req.result,r=db.transaction('records').objectStore('records').get('presets');r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};}));
  assert.equal(presets[0].document.name,'Legacy project');const user=presets.find(p=>p.name==='My dots');assert.ok(user.layer);assert.equal(user.document,undefined,'new preset is not a project snapshot');assert.equal(stored.presets,undefined);
  console.log('PASS user presets across projects, legacy data preservation, destination and undo baseline');

  await change('spacing',80);await page.locator('[data-action=new]').click();await page.locator('#unsaved-cancel').click();assert.equal(await field('spacing').inputValue(),'80');assert.equal(await dirty(),'true');
  await page.evaluate(()=>window.nativeNext={cancelled:true});await page.locator('[data-action=new]').click();await page.locator('#unsaved-save').click();await page.waitForTimeout(80);assert.ok(await page.locator('#unsaved-save').isVisible(),'cancelled save leaves warning open');await page.locator('#unsaved-cancel').click();
  await page.evaluate(()=>window.nativeNext={error:true});await page.locator('[data-action=new]').click();await page.locator('#unsaved-save').click();await page.waitForTimeout(80);assert.ok(await page.locator('#unsaved-save').isVisible(),'failed save leaves project open');await page.locator('#unsaved-cancel').click();
  await page.locator('[data-action=new]').click();await page.locator('#unsaved-save').click();await page.waitForFunction(()=>document.querySelector('.document-name span')?.textContent==='未命名圖樣');assert.equal(await dirty(),'false');assert.equal(await page.locator('[data-action=undo]').isDisabled(),true);await save();assert.equal((await lastSave()).projectToken,undefined);
  await page.locator('[data-pattern=dots]').click();await page.evaluate(doc=>window.nativeOpenDoc=doc,c);
  const opens=await page.evaluate(()=>window.nativeRequests.filter(r=>r.type==='open').length);await page.locator('[data-action=open]').click();await page.locator('#unsaved-cancel').click();assert.equal(await page.evaluate(()=>window.nativeRequests.filter(r=>r.type==='open').length),opens);
  await page.locator('[data-action=open]').click();await page.locator('#unsaved-discard').click();await page.waitForFunction(()=>document.querySelector('.document-name span')?.textContent==='Project C');await save();assert.equal((await lastSave()).projectToken,'f'.repeat(32));
  await page.locator('[data-pattern=dots]').click();let confirmed=await countAction('close-confirmed');await page.locator('[data-action=window-close]').click();await page.locator('#unsaved-cancel').click();assert.equal(await countAction('close-confirmed'),confirmed);assert.equal(await countAction('close-cancelled'),1);
  await page.evaluate(()=>window.emitNative({type:'window-close-request'}));await page.locator('#unsaved-save').click();await page.waitForFunction(n=>window.nativeRequests.filter(r=>r.action==='close-confirmed').length>n,confirmed);
  await change('spacing',70);await page.evaluate(()=>window.nativeNext={defer:true});await page.locator('[data-action=save]').click();await change('spacing',72);await page.evaluate(()=>window.finishNative());await page.waitForTimeout(50);assert.equal(await dirty(),'true','editing during save retains dirty state');await save();
  await change('spacing',73);await page.evaluate(()=>window.emitNative({type:'window-close-request'}));await page.locator('#unsaved-discard').click();await page.waitForTimeout(100);
  const recovery=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('c-texturemaker',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('records').objectStore('records').get('autosave');q.onsuccess=()=>{resolve(q.result);db.close();};};}));assert.equal(recovery.layers[0].params.spacing,72,'close discard recovers only the saved version');
  console.log('PASS unsaved New/Open/close choices, cancelled/failed save, discard recovery and edits during async save');

  await file(a);await page.locator('#dimensions-label').click();await page.locator('#canvas-lock').check();await page.locator('#canvas-width').fill('1536');await page.locator('#canvas-width').press('Tab');assert.equal(await page.locator('#canvas-height').inputValue(),'1024');await page.locator('#apply-canvas-size').click();assert.equal(await page.locator('#dimensions-label').textContent(),'1536 × 1024');
  await change('height',512,'doc');assert.equal(await field('width','doc').inputValue(),'768');
  const options=await page.locator('#size-preset option').allTextContents();assert.ok(options.includes('16:9 - 1920 × 1080'));await page.locator('#size-preset').selectOption('1920,1080');await change('width',1280,'doc');assert.equal(await field('height','doc').inputValue(),'720');
  const sized=await save();assert.deepEqual(sized.aspectRatio,[1920,1080]);await file(c);await file(sized);assert.equal(await page.locator('[data-action=aspect-lock]').isChecked(),true);await change('height',900,'doc');assert.equal(await field('width','doc').inputValue(),'1600');
  await page.locator('#dimensions-label').click();await page.locator('#canvas-width').fill('2048');await page.locator('dialog [data-action=close-dialog]').first().click();assert.equal(await field('width','doc').inputValue(),'1600','size dialog cancel preserves canvas');
  await page.locator('[data-action=aspect-lock]').uncheck();await change('height',1000,'doc');assert.equal(await field('width','doc').inputValue(),'1600');
  await page.locator('[data-action=aspect-lock]').check();await change('width',4096,'doc');assert.equal(await field('height','doc').inputValue(),'2560');
  console.log('PASS canvas shortcut, draft cancel, ratio presets, both-axis locking and project roundtrip');

  const png=new PNG({width:320,height:180});png.data.fill(255);const bytes=Array.from(PNG.sync.write(png));
  const drop=async(files)=>page.evaluate(files=>{const data=new DataTransfer();for(const f of files)data.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:f.type}));document.querySelector('#viewport').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));},files);
  const imageFile={name:'Dropped.png',type:'image/png',bytes};await drop([imageFile]);await page.waitForFunction(()=>document.querySelector('.mask-name')?.textContent==='Dropped');assert.match(await page.locator('.image-source-size').textContent(),/320 × 180 px.*16:9/);
  stored=await save();let images=stored.layers.filter(l=>l.type==='imageMask');assert.equal(images.length,1);assert.equal(images[0].imageWidth,320);assert.equal(images[0].imageHeight,180);assert.equal(stored.width,4096);
  await drop([{name:'bad.png',type:'image/png',bytes:[1,2,3]}]);await page.waitForTimeout(80);assert.equal((await save()).layers.length,stored.layers.length,'invalid dropped image does not alter project');
  await drop([{...imageFile,name:'Second.png'},{...imageFile,name:'Third.png'}]);await page.waitForFunction(()=>document.querySelector('.mask-name')?.textContent==='Third');assert.equal((await save()).layers.filter(l=>l.type==='imageMask').length,3);
  await page.locator('[data-action=save-preset]').click();await page.locator('#name-input').fill('Image preset');await page.locator('#name-form').evaluate(f=>f.requestSubmit());await page.waitForTimeout(100);await file(c);await page.locator('[data-action=presets]').click();await page.locator('[data-action=preset]').filter({hasText:'Image preset'}).click();stored=await save();assert.equal(stored.name,c.name);assert.equal(stored.layers.length,2);assert.equal(stored.layers[0].type,'waves');
  await page.waitForTimeout(400);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');assert.equal(await dirty(),'true','recovered work needs a manual file save');await page.locator('[data-action=presets]').click();assert.ok(await page.locator('[data-action=preset]').filter({hasText:'My dots'}).isVisible());await page.locator('dialog [data-action=close-dialog]').click();
  await page.locator('[data-action=select-layer]').first().click();
  await fs.mkdir(path.join(root,'.tools','validation-1.5.0'),{recursive:true});await page.screenshot({path:path.join(root,'.tools','validation-1.5.0','image-dimensions.png')});
  await page.locator('#dimensions-label').click();await page.waitForTimeout(250);await page.screenshot({path:path.join(root,'.tools','validation-1.5.0','canvas-size.png')});
  console.log('PASS external file drop, original resolution, invalid input, multiple images and persistent user library');
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
