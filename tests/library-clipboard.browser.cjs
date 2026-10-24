/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),appRoot=path.join(root,'dist/C-TextureMaker/app'),output=path.join(root,'.tools/validation-library-clipboard');
const fixture=new PNG({width:128,height:128});
for(let y=0;y<128;y++)for(let x=0;x<128;x++)fixture.data.set([x<64?30:220,100,180,x<10?0:255],(y*128+x)*4);
const encoded=PNG.sync.write(fixture).toString('base64');
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{
  const file=path.resolve(appRoot,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(appRoot+path.sep))throw Error('outside app');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const origin='http://127.0.0.1:'+server.address().port+'/',context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(base64=>{
   localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'light',motion:false}));
   window.testClipboardReads=0;window.testClipboardImage=base64;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>{window.testClipboardReads++;return [{types:['image/png'],getType:async()=>new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'})}];}}});
  },encoded);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'index.html');await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const rows=()=>page.locator('#layer-list .layer'),imageRows=()=>page.locator('#layer-list .layer[data-layer-type="imageMask"]');
  const selectedId=()=>page.locator('#layer-list .layer.selected').getAttribute('data-layer-id');
  const original=await selectedId(),originalType=await page.locator('#layer-list .layer.selected').getAttribute('data-layer-type');
  await page.locator('[data-pattern="dots"]').click();const dots=await selectedId();assert.notEqual(dots,original);assert.equal(await rows().count(),2);
  await page.locator('[data-pattern="dots"]').click();assert.equal(await rows().count(),3,'same card also adds a new layer');
  await page.keyboard.press('Control+z');assert.equal(await rows().count(),2,'addition is one undo step');
  await page.keyboard.press('Control+y');assert.equal(await rows().count(),3);
  const save=async()=>{const wait=page.waitForEvent('download');await page.locator('[data-action="save"]').click();return JSON.parse(await fs.readFile(await (await wait).path(),'utf8'));};
  const before=await save();assert.equal(before.layers.find(l=>l.id===original).type,originalType);
  const dispatchPaste=async selector=>page.locator(selector).evaluate((target,base64)=>{
   const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'source.png',{type:'image/png'}));
   target.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
  },encoded);
  await dispatchPaste('#pattern-search');assert.equal(await rows().count(),3,'text fields do not import images');
  const pasteAnchor=await selectedId();await dispatchPaste('#viewport');await imageRows().waitFor();assert.equal(await rows().count(),4);
  const pasted=await selectedId(),after=await save();assert.deepEqual(after.layers.filter(l=>l.id!==pasted),before.layers,'paste leaves existing layers untouched');
  const pasteIndex=after.layers.findIndex(l=>l.id===pasted);assert.equal(pasteIndex,after.layers.findIndex(l=>l.id===pasteAnchor)+1);assert.equal(after.layers[pasteIndex].mode,'color');assert.equal(after.layers[pasteIndex].imageWidth,128);
  assert.equal(await page.evaluate(()=>window.testClipboardReads),0,'paste event does not request another clipboard read');
  await page.locator('#viewport').click({button:'right',position:{x:25,y:25}});
  await page.locator('.canvas-context-menu [role="menuitem"]').click();await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer[data-layer-type="imageMask"]').length===2);
  assert.equal(await page.evaluate(()=>window.testClipboardReads),1);assert.equal(await page.locator('.canvas-context-menu').count(),0);
  await page.locator('#viewport').click({button:'right',position:{x:25,y:25}});await page.keyboard.press('Escape');assert.equal(await page.locator('.canvas-context-menu').count(),0);
  await page.locator('[data-pattern="lineart"]').click();const resultId=await selectedId(),result=await save(),effect=result.layers.find(l=>l.id===resultId);assert.equal(effect.type,'lineart');assert.equal(effect.imageSource,'below');
  await page.locator('#artboard [data-flow-lines]').waitFor();
  for(const type of ['redraw','manga','lineart']){
   const thumb=page.locator('[data-pattern="'+type+'"] .thumb svg');assert.equal(await thumb.getAttribute('viewBox'),'0 0 128 128');
   assert.equal(await thumb.locator('text').count(),0);
  }
  await page.locator('[data-pattern="redraw"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'library-light.png')});
  await page.locator('[data-action="theme"]').click();await page.screenshot({path:path.join(output,'library-dark.png')});
  assert.deepEqual(errors,[]);await context.close();
  // Native keyboard route uses a mock bridge, keeping the real OS clipboard untouched.
  const native=await browser.newContext({viewport:{width:1280,height:900}});
  await native.addInitScript(base64=>{
   localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'light',motion:false}));
   const listeners=[];window.nativeClipboardRequests=0;
   window.chrome??={};window.chrome.webview={addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>{
    if(message.type==='clipboard-image'){window.nativeClipboardRequests++;setTimeout(()=>listeners.forEach(fn=>fn({data:{type:'clipboard-image-result',id:message.id,ok:true,empty:false,mime:'image/png',base64}})),0);}
   }};
  },encoded);
  const nativePage=await native.newPage();await nativePage.goto(origin+'index.html');await nativePage.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await nativePage.locator('#viewport').click({position:{x:20,y:20}});await nativePage.keyboard.press('Control+v');
  await nativePage.waitForFunction(()=>document.querySelectorAll('#layer-list .layer[data-layer-type="imageMask"]').length===1);
  assert.equal(await nativePage.evaluate(()=>window.nativeClipboardRequests),1);
  await nativePage.locator('#pattern-search').focus();await nativePage.keyboard.press('Control+v');assert.equal(await nativePage.evaluate(()=>window.nativeClipboardRequests),1);
  await native.close();console.log('PASS library additions, preservation, undo/redo, clipboard event and context menu, native Ctrl+V routing, thumbnails in both themes.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
