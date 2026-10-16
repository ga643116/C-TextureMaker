/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Shape-redraw UI, worker, persistence and export regressions run in headless Edge.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.tools','validation-redraw');

function fixturePNG(){
 const width=192,height=160,png=new PNG({width,height});
 const pixel=(x,y,rgba)=>png.data.set(rgba,(y*width+x)*4);
 const rect=(x0,y0,x1,y1,rgba)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)pixel(x,y,rgba);};
 const red=[202,54,66,255],blue=[43,115,153,255],gold=[226,172,67,255],ink=[26,29,34,255];
 rect(20,17,83,145,red);
 rect(105,14,143,53,red); // A disconnected island with the same source color.
 rect(94,70,174,132,blue);
 rect(30,101,71,130,gold);
 rect(41,47,60,74,[0,0,0,0]); // Transparent hole.
 rect(60,74,72,88,[0,0,0,0]); // A second hole touches the first at one corner.
 for(let x=31;x<72;x++){const y=77+Math.floor((x-31)/3);pixel(x,y,ink);} // Thin line art.
 for(let y=24;y<39;y++)for(let x=20;x<22;x++)pixel(x,y,ink);
 return PNG.sync.write(png);
}
async function revealField(page,field){
 await field.waitFor({state:'attached'});
 const section=await field.evaluate(node=>node.closest('details')?.dataset.section);
 if(section){
  const details=page.locator('#inspector details[data-section="'+section+'"]');
  if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
 }
}
async function setRange(page,selector,value){
 const field=page.locator(selector);await revealField(page,field);
 await field.evaluate((node,next)=>{node.value=String(next);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);
 await page.waitForFunction(({selector,expected})=>Number(document.querySelector(selector)?.value)===expected,{selector,expected:Number(value)},{timeout:10000});
}
async function setSelect(page,selector,value){
 const field=page.locator(selector);await revealField(page,field);await field.selectOption(value);
 await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.value===expected,{selector,expected:String(value)},{timeout:10000});
}
async function setColor(page,target,color){
 const field=typeof target==='string'?page.locator(target):target;await revealField(page,field);
 await field.evaluate((node,next)=>{node.value=next;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},color);
 await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.value.toLowerCase()===expected.toLowerCase(),{selector:typeof target==='string'?target:'input[data-redraw-palette]',expected:color},{timeout:10000});
}
async function assertNoHorizontalOverflow(page,label){
 const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,inspector:document.querySelector('#inspector').scrollWidth,inspectorClient:document.querySelector('#inspector').clientWidth}));
 assert.ok(sizes.document<=sizes.viewport+1,label+' page has no horizontal overflow: '+JSON.stringify(sizes));
 assert.ok(sizes.inspector<=sizes.inspectorClient+1,label+' inspector has no horizontal overflow: '+JSON.stringify(sizes));
}

(async()=>{
 await fs.mkdir(output,{recursive:true});
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=path.resolve(root,'.'+pathname);
   if(!file.startsWith(root+path.sep))throw Error('outside');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
   res.setHeader('Cache-Control','no-store');
   res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser,page;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false})));
  const origin='http://127.0.0.1:'+server.address().port+'/';
  const blockedRequests=[],pageErrors=[],workerURLs=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.startsWith(origin)||url.startsWith('data:')||url.startsWith('blob:')||url==='about:blank')return route.continue();
   blockedRequests.push(url);return route.abort();
  });
  page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')pageErrors.push(message.text());});
  page.on('worker',worker=>workerURLs.push(worker.url()));
  await page.goto(origin+'app/index.html');
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const isDirty=()=>page.locator('html').getAttribute('data-project-dirty');
  const selectLayer=async id=>{
   await page.locator('#layer-list [data-layer-id="'+id+'"] [data-action="select-layer"]').click();
   await page.waitForFunction(expected=>document.querySelector('#layer-list .layer.selected [data-action="select-layer"]')?.dataset.id===expected,id,{timeout:10000});
  };
  const save=async()=>{
   const pending=page.waitForEvent('download');await page.locator('[data-action="save"]').click();
   const item=await pending,file=await item.path();assert.ok(file,'headless browser completed the project download');
   return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const load=async(project,name)=>{
   const wasDirty=await isDirty()==='true';
   await page.locator('#file-project').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   if(wasDirty){await page.locator('#unsaved-discard').waitFor({state:'visible',timeout:10000});await page.locator('#unsaved-discard').click();}
   await page.waitForFunction(expected=>document.querySelector('.document-name span')?.textContent===expected,project.name,{timeout:10000});
  };
  const exportAsset=async(format)=>{
   await page.locator('[data-action="export"]').click();
   const dialog=page.locator('#dialog-root dialog[open]');await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-format="'+format+'"]').click();
   const alpha=dialog.locator('#export-alpha');if(!await alpha.isChecked())await alpha.check();
   const pending=page.waitForEvent('download');await dialog.locator('#do-export').click();
   const item=await pending,file=await item.path();await dialog.waitFor({state:'detached'});
   const bytes=await fs.readFile(file);await fs.writeFile(path.join(output,'shape-redraw.'+format),bytes);return bytes;
  };

  await page.locator('#pattern-list [data-pattern="redraw"]').click();
  await page.waitForFunction(()=>document.querySelector('#pattern-list [data-pattern="redraw"]')?.getAttribute('aria-pressed')==='true');
  const redrawLayerId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  const thumbColors=await page.locator('#pattern-list [data-pattern="redraw"] .redraw-thumb [fill]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('fill')).filter(color=>/^#[0-9a-f]{6}$/i.test(color)));
  assert.ok(thumbColors.length>0&&thumbColors.every(color=>color.slice(1,3)===color.slice(3,5)&&color.slice(3,5)===color.slice(5,7)),'redraw library thumbnail uses only grayscale fills');
  assert.ok(redrawLayerId,'redraw pattern is active on a real project layer');
  const sourceStatus=page.locator('#inspector .inspector-head > p.helper');await sourceStatus.waitFor({state:'attached'});
  const initialSourcePrompt=(await sourceStatus.innerText()).trim();
  assert.match(initialSourcePrompt,/來源/,'redraw shows a localized missing-source prompt');
  await page.locator('[data-action="redraw-generate"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-generation-status')?.dataset.state==='error',{}, {timeout:10000});
  assert.match(await page.locator('#redraw-generation-status').innerText(),/來源/,'missing-source feedback is explicit');
  assert.equal(await page.locator('#artboard svg [data-redraw-region]').count(),0,'generation without a source does not create empty output');

  const chooserEvent=page.waitForEvent('filechooser');
  await page.locator('#inspector [data-action="redraw-import"]').click();
  const chooser=await chooserEvent;
  await chooser.setFiles({name:'redraw-fixture.png',mimeType:'image/png',buffer:fixturePNG()});
  await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer[data-layer-type="imageMask"]').length===1,{},{timeout:10000});
  await page.waitForFunction(()=>Boolean(document.querySelector('#layer-list .layer[data-layer-type="imageMask"].selected')),{},{timeout:10000});
  const sourceId=await page.locator('#layer-list .layer[data-layer-type="imageMask"].selected [data-action="select-layer"]').getAttribute('data-id');
  assert.ok(sourceId,'UI import creates a selectable source layer');
  assert.equal(await page.locator('#layer-list [data-layer-id="'+sourceId+'"] [data-action="image-mode"]').inputValue(),'color','redraw import uses a color source');
  assert.deepEqual(await page.locator('#inspector [data-action="image-mode"] option').evaluateAll(nodes=>nodes.map(node=>node.value)),['mask','color'],'image modes have only mask and color choices');
  assert.equal(await page.locator('#artboard svg image').count(),1,'the source remains visible before any redraw output exists');
  await selectLayer(redrawLayerId);
  const sourceSection=page.locator('#inspector details[data-section="image-source"]');
  await sourceSection.waitFor({state:'attached'});
  if(!await sourceSection.evaluate(node=>node.open))await sourceSection.locator('summary').click();
  await page.locator('#inspector [data-action="image-source"][data-mode="all"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode==='all');

  await setRange(page,'#r-detail',58);
  await setRange(page,'#r-straightness',6.5);
  await page.locator('[data-action="redraw-mode"][data-mode="blocks"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="redraw-mode"][data-mode="blocks"]')?.getAttribute('aria-pressed')==='true');
  await setSelect(page,'#p-paletteMode','original');
  const lines=page.locator('input[type="checkbox"][data-target="params"][data-key="lines"]');await revealField(page,lines);await lines.check();
  await setRange(page,'#r-lineWidth',1.5);
  await setColor(page,'input[type="color"][data-target="params"][data-key="lineColor"]','#1a1d22');
  await setRange(page,'#r-outlineWidth',1.25);

  await page.locator('[data-action="redraw-generate"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-generation-status')?.dataset.state==='ready'&&document.querySelectorAll('#artboard svg [data-redraw-region]').length>0,{}, {timeout:60000});
  assert.ok(workerURLs.length>0,'generation completed with a browser WebWorker');
  assert.ok(workerURLs.some(url=>{try{const worker=new URL(url);return worker.origin===new URL(origin).origin&&worker.pathname.endsWith('/redraw-worker.js');}catch{return false;}}),'generation used the local redraw-worker.js');
  let regionIds=await page.locator('#artboard svg [data-redraw-region]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-redraw-region')));
  assert.ok(regionIds.length>=2,'the imported multi-region image produces editable regions');
  assert.equal(new Set(regionIds).size,regionIds.length,'generated region identifiers are unique');
  const firstId=regionIds[0],firstRegion=page.locator('#artboard svg [data-redraw-region="'+firstId+'"]');

  await page.locator('[data-action="redraw-edit-mode"][data-mode="recolor"]').click();
  await firstRegion.click({force:true});
  await setColor(page,'#redraw-region-color','#12ab34');
  await page.locator('[data-action="redraw-edit-mode"][data-mode="erase"]').click();
  await firstRegion.click({force:true});
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===false,{}, {timeout:10000});
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===true,{}, {timeout:10000});
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===false,{}, {timeout:10000});
  assert.equal(await page.locator('#artboard svg [data-redraw-region="'+firstId+'"]').count(),1,'hidden regions remain addressable in the editable preview');
  await page.locator('[data-action="redraw-edit-mode"][data-mode="select"]').click();
  await page.locator('#artboard svg [data-redraw-region="'+firstId+'"]').click({force:true});
  const visible=page.locator('#redraw-region-visible');if(!await visible.isChecked())await visible.check();
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===true);

  const visibleSVG=Buffer.from(await exportAsset('svg')).toString('utf8');
  assert.match(visibleSVG,/<path\b/i,'SVG export contains editable vector paths');
  assert.doesNotMatch(visibleSVG,/<image(?:\s|>)/i,'color-mode source image is not embedded in SVG');
  const png=PNG.sync.read(await exportAsset('png'));
  const alphaValues=new Set(),colors=new Set();
  for(let offset=0;offset<png.data.length;offset+=4){
   const alpha=png.data[offset+3];alphaValues.add(alpha);
   if(alpha>0)colors.add(png.data[offset]+','+png.data[offset+1]+','+png.data[offset+2]);
  }
  assert.ok(alphaValues.has(0)&&alphaValues.has(255),'PNG export keeps transparent pixels and opaque redraw artwork');
  assert.ok(colors.size>=2,'PNG export contains multiple visible colors');

  await page.locator('#inspector').evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:path.join(output,'shape-redraw-dark-zh.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.screenshot({path:path.join(output,'shape-redraw-light-zh.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  for(const locale of ['en','ja','zh']){
   await page.locator('.language-select').selectOption(locale);
   await page.waitForFunction(expected=>document.querySelector('.language-select')?.value===expected,locale);
   for(const width of [1440,960,880]){
    await page.setViewportSize({width,height:960});
    await assertNoHorizontalOverflow(page,'redraw '+locale+' '+width);
   }
   await page.setViewportSize({width:1440,height:960});
   await page.locator('#inspector').evaluate(node=>node.scrollTop=0);
   if(locale!=='zh')await page.screenshot({path:path.join(output,'shape-redraw-dark-'+locale+'.png'),fullPage:true});
  }
  await page.locator('.language-select').selectOption('zh');

  await setRange(page,'#r-straightness',9);
  await page.locator('[data-action="redraw-mode"][data-mode="three"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="redraw-mode"][data-mode="three"]')?.getAttribute('aria-pressed')==='true');
  await setSelect(page,'#p-paletteMode','custom');
  const customPalette=page.locator('input[data-redraw-palette]').first();await customPalette.waitFor({state:'attached'});
  await setColor(page,customPalette,'#2674a8');
  if(await lines.isChecked())await lines.uncheck();
  await setRange(page,'#r-lineWidth',2.5);
  await setColor(page,'input[type="color"][data-target="params"][data-key="lineColor"]','#26384a');
  await setRange(page,'#r-outlineWidth',2.25);
  const afterSettings=await page.locator('#artboard svg [data-redraw-region]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-redraw-region')));
  assert.deepEqual(afterSettings,regionIds,'straightness, mode, palette and line controls preserve generated region IDs');

  const saved=await save(),savedRedraw=saved.layers.find(layer=>layer.id===redrawLayerId),savedSource=saved.layers.find(layer=>layer.id===sourceId);
  assert.ok(savedRedraw?.redrawData?.regions?.length>=2,'project save keeps generated region geometry');
  assert.equal(savedRedraw.redrawEdits[firstId]?.color,'#12ab34','project save keeps a recolored region');
  assert.equal(savedRedraw.redrawEdits[firstId]?.hidden,undefined,'restored region is saved as visible');
  assert.equal(savedRedraw.params.detail,58);
  assert.equal(savedRedraw.params.straightness,9);
  assert.equal(savedRedraw.params.mode,'three');
  assert.equal(savedRedraw.params.paletteMode,'custom');
  assert.equal(savedRedraw.params.lines,false);
  assert.ok(savedRedraw.redrawPalette.includes('#2674a8'),'project save keeps the custom redraw palette');
  assert.equal(savedSource.mode,'color','project save keeps the imported source in color mode');
  assert.ok(savedSource.image.startsWith('data:image/png;base64,'),'project save embeds the imported PNG data');

  await page.locator('#pattern-list [data-pattern="dots"]').click();
  await page.waitForFunction(()=>document.querySelector('#pattern-list [data-pattern="dots"]')?.getAttribute('aria-pressed')==='true');
  await page.locator('#pattern-list [data-pattern="redraw"]').click();
  await page.waitForFunction(()=>document.querySelector('#pattern-list [data-pattern="redraw"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('#r-detail').inputValue(),'58','switching patterns restores redraw detail');
  assert.equal(await page.locator('#r-straightness').inputValue(),'9','switching patterns restores straightness');
  assert.equal(await page.locator('[data-action="redraw-mode"][data-mode="three"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#p-paletteMode').inputValue(),'custom');
  assert.equal(await page.locator('input[type="checkbox"][data-target="params"][data-key="lines"]').isChecked(),false);
  const switchedSave=await save(),switchedRedraw=switchedSave.layers.find(layer=>layer.id===redrawLayerId);
  assert.deepEqual(switchedRedraw.redrawData.regions.map(region=>region.id),regionIds,'switching away and back preserves generated region identities');
  assert.deepEqual(switchedRedraw.redrawEdits[firstId],savedRedraw.redrawEdits[firstId],'switching away and back preserves region edits');

  await load(switchedSave,'redraw-roundtrip.ctm');
  const roundTrip=await save(),roundTripRedraw=roundTrip.layers.find(layer=>layer.id===redrawLayerId);
  assert.deepEqual(roundTripRedraw.redrawData.regions.map(region=>region.id),regionIds,'project load restores generated vector regions');
  assert.deepEqual(roundTripRedraw.redrawEdits[firstId],savedRedraw.redrawEdits[firstId],'project load restores the region color and visibility edit');
  assert.equal(roundTripRedraw.params.paletteMode,'custom','project load restores redraw controls');

  await page.locator('#artboard svg [data-redraw-region="'+firstId+'"]').click({force:true});
  const loadedRegionColor=page.locator('#redraw-region-color');
  assert.equal(await loadedRegionColor.inputValue(),'#12ab34','project load restores the editable region color in the UI');
  const generateButton=page.locator('[data-action="redraw-generate"]'),confirmDialog=page.locator('dialog.redraw-confirm-modal');
  await generateButton.click();
  await confirmDialog.waitFor({state:'visible'});
  await page.locator('[data-action="redraw-cancel-generate"]').click();
  await confirmDialog.waitFor({state:'detached'});
  assert.equal(await page.locator('#redraw-region-color').inputValue(),'#12ab34','canceling regeneration preserves region edits');
  assert.equal(await page.locator('#redraw-region-visible').isChecked(),true,'canceling regeneration preserves region visibility');
  await generateButton.click();
  await confirmDialog.waitFor({state:'visible'});
  await page.locator('[data-action="redraw-confirm-generate"]').click();
  await page.waitForFunction(()=>document.querySelector('#redraw-generation-status')?.dataset.state==='ready'&&document.querySelectorAll('#artboard svg [data-redraw-region]').length>0,{}, {timeout:60000});
  const regenerated=await save(),regeneratedRedraw=regenerated.layers.find(layer=>layer.id===redrawLayerId);
  assert.deepEqual(regeneratedRedraw.redrawEdits,{},'confirming regeneration clears prior region edits');
  assert.ok(regeneratedRedraw.redrawData.regions.length>=2,'confirmed regeneration replaces the saved geometry');

  assert.deepEqual(blockedRequests,[],'the browser requested no remote resources');
  assert.deepEqual(pageErrors,[],'headless redraw flow completed without browser errors');
  console.log('PASS imported PNG redraw worker, region edits with undo/redo, custom settings, pattern/project roundtrip, transparent PNG and editable SVG');
  console.log('Screenshots and exports:',output);
 }catch(error){
  if(page)await page.screenshot({path:path.join(output,'shape-redraw-failure.png'),fullPage:true}).catch(()=>{});
  throw error;
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});