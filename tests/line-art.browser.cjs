/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),appRoot=path.join(root,'dist/C-TextureMaker/app'),output=path.join(root,'.tools/validation-line-art');
const field=key=>'#inspector input[type="number"][data-target="params"][data-key="'+key+'"]';
async function set(page,key,value){
 const input=page.locator(field(key));
 await input.evaluate(node=>{node.closest('details').open=true;});
 await input.fill(String(value));await input.dispatchEvent('change');
 await page.waitForTimeout(180);
}
async function download(page,action){const pending=page.waitForEvent('download');await action();return fs.readFile(await (await pending).path());}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{
  const file=path.resolve(appRoot,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(appRoot+path.sep))throw Error('outside app');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'light',motion:false})));
  const origin='http://127.0.0.1:'+server.address().port+'/',errors=[],external=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin)||/^(data:|blob:|about:)/.test(url))return route.continue();external.push(url);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'index.html');await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const addPattern=async type=>{await page.locator('[data-pattern="'+type+'"]').click();await page.waitForFunction(type=>document.querySelector('[data-pattern="'+type+'"]')?.getAttribute('aria-pressed')==='true',type);};
  const selectLayer=async id=>{await page.locator('#layer-list [data-action="select-layer"][data-id="'+id+'"]').click();await page.waitForFunction(expected=>document.querySelector('#layer-list .layer.selected [data-action="select-layer"]')?.dataset.id===expected,id);};
  const initialLayerId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  await addPattern('lineart');
  const lineartLayerId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  await selectLayer(initialLayerId);await page.locator('[data-action="delete"]').click();await selectLayer(lineartLayerId);
  assert.equal(await page.locator('#alpha-status').getAttribute('aria-pressed'),'true');
  const fixture=new PNG({width:256,height:256});
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const ring=Math.abs(Math.hypot(x-128,y-128)-72)<2,eyes=(Math.hypot(x-104,y-116)<6||Math.hypot(x-152,y-116)<6),mouth=y>153&&y<157&&x>108&&x<148;
   fixture.data.set(ring||eyes||mouth?[25,25,25,255]:[240,220,200,255],(y*256+x)*4);
  }
  const chooserEvent=page.waitForEvent('filechooser');
  await page.locator('#inspector [data-action="add-color-image"]').click();
  await (await chooserEvent).setFiles({name:'face.png',mimeType:'image/png',buffer:PNG.sync.write(fixture)});
  await page.waitForFunction(()=>document.querySelector('#layer-list .layer[data-layer-type="imageMask"]'));
  await selectLayer(lineartLayerId);
  await page.locator('#artboard [data-flow-lines]').waitFor();
  await set(page,'lineDetail',149);await set(page,'lineSmooth',3);await set(page,'lineScale',.65);
  const saved=JSON.parse((await download(page,()=>page.locator('[data-action="save"]').click())).toString());
  const effect=saved.layers.find(l=>l.type==='lineart');assert.ok(effect);assert.equal(effect.params.lineDetail,149);assert.equal(saved.transparent,true);
  const before=await page.locator('#artboard [data-flow-lines]').first().evaluate(node=>node.outerHTML);
  await addPattern('manga');await page.locator('#artboard [data-manga]').waitFor();
  const mangaLayerId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  assert.equal(await page.locator(field('lineStrength')).count(),0);
  await selectLayer(lineartLayerId);assert.equal(await page.locator(field('lineDetail')).inputValue(),'149');
  assert.ok((await page.locator('#artboard [data-flow-lines]').evaluateAll(nodes=>nodes.map(node=>node.outerHTML))).includes(before),'adding Manga leaves the existing line-art rendering unchanged');
  await selectLayer(mangaLayerId);await page.locator('[data-action="delete"]').click();await selectLayer(lineartLayerId);
  await page.locator('[data-action="export"]').click();
  const dialog=page.locator('#dialog-root dialog[open]');await dialog.locator('[data-format="png"]').click();
  assert.equal(await dialog.locator('#export-alpha').isChecked(),true);
  const bytes=await download(page,()=>dialog.locator('#do-export').click()),png=PNG.sync.read(bytes);
  const alphas=Array.from({length:png.width*png.height},(_,i)=>png.data[i*4+3]);
  assert.ok(alphas.some(v=>v>128));assert.equal(png.data[3],0,'export has no paper fill');
  await fs.writeFile(path.join(output,'line-art-export.png'),bytes);
  await page.screenshot({path:path.join(output,'line-art-inspector.png')});
  await addPattern('redraw');await page.locator('[data-action="redraw-generate"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-generation-status')?.dataset.state==='ready',null,{timeout:30000});
  await page.locator('[data-action="redraw-mode"][data-mode="outline"]').click();
  await page.locator('#artboard g:has(> [data-redraw-region]) [data-flow-lines]').waitFor();
  await set(page,'lineDetail',179);assert.ok(await page.locator('#artboard [data-redraw-region]').count());
  await page.screenshot({path:path.join(output,'redraw-flow-outline.png')});
  await selectLayer(lineartLayerId);
  await page.locator('#file-project').setInputFiles({name:'roundtrip.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.locator('#unsaved-discard').click();
  await page.waitForFunction(()=>document.querySelector('#pattern-list [data-pattern="lineart"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator(field('lineDetail')).inputValue(),'149');
  await page.locator('#artboard [data-flow-lines]').waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS shared Flow-XDoG UI: transparent PNG, source import, controls, pattern persistence, project reload, redraw outline and no external requests.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
