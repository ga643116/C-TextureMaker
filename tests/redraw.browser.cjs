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
  await context.addInitScript(()=>{
   localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false}));
   window.__screenPickCalls=0;window.__cancelScreenPick=false;
   window.EyeDropper=class{async open({signal}={}){window.__screenPickCalls++;if(window.__holdScreenPick)return new Promise((resolve,reject)=>{window.__resolveScreenPick=resolve;signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});});if(window.__cancelScreenPick)throw new DOMException('Cancelled','AbortError');return {sRGBHex:'#123abc'};}};
  });
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

  await page.locator('[data-action="redraw-mode"][data-mode="outline"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#artboard [data-redraw-region]')].every(node=>node.getAttribute('fill')==='none'));
  assert.ok(await page.locator('#artboard [data-redraw-region]').evaluateAll(nodes=>nodes.every(node=>node.getAttribute('fill')==='none')),'outline mode hides region fills');
  await page.locator('[data-action="redraw-mode"][data-mode="blocks"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#artboard [data-redraw-region]')].some(node=>node.getAttribute('fill')!=='none'));
  const secondId=regionIds[1],secondRegion=page.locator('#artboard [data-redraw-region="'+secondId+'"]');
  await firstRegion.dispatchEvent('pointermove');
  assert.equal(await firstRegion.evaluate(node=>node.classList.contains('redraw-hover')),true,'hover reveals the region boundary');
  const hoverStyle=await firstRegion.evaluate(node=>({stroke:getComputedStyle(node).stroke,width:getComputedStyle(node).strokeWidth,opacity:getComputedStyle(node).strokeOpacity}));
  assert.equal(hoverStyle.stroke,'rgb(36, 157, 255)','hover uses a visible blue boundary');assert.equal(hoverStyle.width,'2px');assert.equal(hoverStyle.opacity,'1');
  await page.screenshot({path:path.join(output,'shape-redraw-hover-blue.png'),fullPage:true});
  assert.equal(await page.locator('label[for="redraw-tool-color"]').innerText(),'填充顏色','fill color describes the tool purpose');

  await firstRegion.click({force:true});
  await secondRegion.click({force:true,modifiers:['Control']});
  assert.equal(await page.locator('#artboard .redraw-selected').count(),2,'Ctrl-click selects multiple regions');
  await secondRegion.click({force:true,modifiers:['Control']});
  assert.equal(await page.locator('#artboard .redraw-selected').count(),1,'Ctrl-click selected region deselects it');
  await page.locator('#viewport').click({position:{x:8,y:65}});
  assert.equal(await page.locator('#artboard .redraw-selected').count(),0,'blank canvas clears selection');
  await firstRegion.click({force:true});await secondRegion.click({force:true,modifiers:['Control']});
  await setColor(page,'#redraw-region-color','#331122');
  await page.waitForFunction(ids=>ids.every(id=>document.querySelector('#artboard [data-redraw-region="'+id+'"]')?.getAttribute('fill')==='#331122'),[firstId,secondId]);
  assert.equal(await firstRegion.getAttribute('fill'),'#331122');assert.equal(await secondRegion.getAttribute('fill'),'#331122');
  await page.locator('[data-action="undo"]').click();
  assert.notEqual(await firstRegion.getAttribute('fill'),'#331122','bulk recolor is one undo step');

  // Dragging a line color updates existing SVG nodes instead of rebuilding paths.
  const lineInput='input[type="color"][data-target="params"][data-key="lineColor"]';
  await revealField(page,page.locator(lineInput));
  await page.evaluate(()=>{window.__lineNode=document.querySelector('#artboard [data-redraw-line-color]');});
  assert.ok(await page.evaluate(()=>Boolean(window.__lineNode)));
  const paint=await page.locator(lineInput).evaluate(node=>{
   const start=performance.now();for(let n=0;n<80;n++){node.value='#'+(0x224400+n).toString(16);node.dispatchEvent(new Event('input',{bubbles:true}));}
   return {elapsed:performance.now()-start,same:window.__lineNode===document.querySelector('#artboard [data-redraw-line-color]'),stroke:window.__lineNode.getAttribute('stroke')};
  });
  assert.equal(paint.same,true,'line color gestures preserve SVG geometry nodes');assert.equal(paint.stroke,'#22444f');
  await page.locator(lineInput).dispatchEvent('change');
  console.log('Line paint 80 input events:',Math.round(paint.elapsed),'ms');

  // Test the product color-picker UI with a deterministic eyedropper stand-in.
  await revealField(page,page.locator('#redraw-tool-color'));await page.locator('#redraw-tool-color').click();
  await page.locator('.ctm-color-picker').waitFor({state:'visible'});
  const sv=page.locator('.ctm-color-picker .cp-sv'),svBox=await sv.boundingBox();
  await page.mouse.move(svBox.x+20,svBox.y+20);await page.mouse.down();await page.mouse.move(svBox.x+100,svBox.y+65,{steps:12});await page.mouse.up();
  assert.match(await page.locator('#redraw-tool-color').inputValue(),/^#[0-9a-f]{6}$/);
  assert.equal(await page.locator('.ctm-color-picker .cp-head strong').innerText(),'填充顏色');
  await page.evaluate(()=>window.__holdScreenPick=true);
  await page.locator('.cp-pick').click();await page.waitForFunction(()=>document.documentElement.classList.contains('screen-picking'));
  assert.match(await firstRegion.evaluate(node=>getComputedStyle(node).cursor),/data:image\/svg\+xml/,'an eyedropper cursor is active during selection');
  await page.evaluate(()=>{window.__holdScreenPick=false;window.__resolveScreenPick({sRGBHex:'#123abc'});});
  await page.waitForFunction(()=>document.querySelector('#redraw-tool-color')?.value==='#123abc'&&!document.documentElement.classList.contains('screen-picking'));

  assert.equal(await page.evaluate(()=>window.__screenPickCalls),1,'screen picker is invoked from the explicit button');
  await page.evaluate(()=>window.__cancelScreenPick=true);await page.locator('.cp-pick').click();
  await page.waitForFunction(()=>!document.querySelector('.cp-pick')?.disabled);
  assert.equal(await page.locator('#redraw-tool-color').inputValue(),'#123abc','cancelling eyedropper preserves the prior color');
  await page.evaluate(()=>{window.__cancelScreenPick=false;window.__holdScreenPick=true;});
  await page.locator('.cp-pick').click();await page.waitForFunction(()=>document.documentElement.classList.contains('screen-picking'));
  assert.equal(await page.evaluate(()=>document.documentElement.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}))),false,'right-click is consumed while screen picking');
  await page.waitForFunction(()=>!document.documentElement.classList.contains('screen-picking')&&!document.querySelector('.cp-pick')?.disabled);
  assert.equal(await page.locator('#redraw-tool-color').inputValue(),'#123abc','right-click cancellation does not apply a screen color');
  await page.evaluate(()=>window.__holdScreenPick=false);

  await page.screenshot({path:path.join(output,'shape-redraw-picker.png'),fullPage:true});
  await page.locator('.cp-done').click();

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
  await firstRegion.click({force:true});
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===true);
  await firstRegion.click({force:true});
  await page.waitForFunction(()=>document.querySelector('#redraw-region-visible')?.checked===false);

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


  // Existing geometry follows the image through the same controls as manual dragging.
  await selectLayer(sourceId);
  await setRange(page,'input[type="number"][data-target="layer"][data-key="offsetX"]',25);
  const placed=await save();
  assert.equal(placed.layers.find(layer=>layer.id===sourceId).offsetX,25);
  assert.match(await page.locator('#artboard').innerHTML(),/matrix\(1 0 0 1 25 0\)/,'generated paths follow the moved source without regeneration');
  const redrawPath=page.locator('#artboard [data-redraw-region]').first();
  const beforeDrag=await redrawPath.evaluate(node=>{const m=node.getScreenCTM();return {x:m.e,y:m.f};});
  const handle=await page.locator('#mask-overlay [data-mask-action="move"]').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+20,handle.y+handle.height/2+12,{steps:4});await page.mouse.up();
  const afterDrag=await redrawPath.evaluate(node=>{const m=node.getScreenCTM();return {x:m.e,y:m.f};});
  assert.ok(Math.abs(afterDrag.x-beforeDrag.x-20)<1&&Math.abs(afterDrag.y-beforeDrag.y-12)<1,'dragging the source moves generated shapes by the same on-screen distance');
  await selectLayer(redrawLayerId);
  assert.equal(await page.locator('[data-redraw-stale]').count(),0,'linked image movement does not incorrectly request regeneration');

  // A project larger than 1 MiB formerly exhausted the 24 MiB undo budget.
  const large=structuredClone(regenerated);large.name='Thirty-step undo regression';
  const pixels=Buffer.alloc(512*512*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=i%251;pixels[i+1]=(i>>8)%251;pixels[i+2]=(i>>16)%251;pixels[i+3]=255;}
  large.layers.find(layer=>layer.id===sourceId).colorMap={width:512,height:512,rgba:pixels.toString('base64')};
  assert.ok(Buffer.byteLength(JSON.stringify(large))>1024*1024);
  await load(large,'redraw-large-history.ctm');
  const opacity='input[type="number"][data-target="layer"][data-key="opacity"]';
  for(let step=1;step<=30;step++)await setRange(page,opacity,1-step/100);
  for(let step=1;step<=30;step++){
   await page.locator('[data-action="undo"]').click();
   assert.equal(Number(await page.locator(opacity).inputValue()),Number((.7+step/100).toFixed(2)),'undo step '+step);
  }
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(),true,'exactly thirty actions retained after project load');
  for(let step=1;step<=30;step++)await page.locator('[data-action="redo"]').click();
  assert.equal(Number(await page.locator(opacity).inputValue()),.7,'all thirty actions can be redone');
  await save();assert.equal(await isDirty(),'false');
  await revealField(page,page.locator('#redraw-tool-color'));await page.locator('#redraw-tool-color').click();await page.locator('.cp-done').click();
  assert.equal(await isDirty(),'false','opening and closing an unchanged tool color does not mark a saved project dirty');
  await revealField(page,page.locator('input[type="color"][data-key="lineColor"]'));await page.locator('input[type="color"][data-key="lineColor"]').click();await page.locator('.cp-done').click();
  assert.equal(await isDirty(),'false','opening and closing unchanged line color does not mark a saved project dirty');
  await setSelect(page,'#p-paletteMode','original');await save();
  const paletteSwatch=page.locator('input[data-redraw-palette]').first();await revealField(page,paletteSwatch);await paletteSwatch.click();await page.locator('.cp-done').click();
  assert.equal(await page.locator('#p-paletteMode').inputValue(),'original','unchanged palette popover does not silently switch to custom');
  assert.equal(await isDirty(),'false');


  // Small mode edits coexist with full project snapshots in the same undo chain.
  const modeProject=structuredClone(large);modeProject.name='Mixed mode undo regression';
  const modeLayer=modeProject.layers.find(layer=>layer.id===redrawLayerId);modeLayer.params.mode='blocks';modeLayer.opacity=1;
  await load(modeProject,'redraw-mode-history.ctm');
  const clickMode=async mode=>{await page.locator('[data-action="redraw-mode"][data-mode="'+mode+'"]').click();await page.waitForFunction(expected=>document.querySelector('[data-action="redraw-mode"][aria-pressed="true"]')?.dataset.mode===expected,mode);};
  const currentMode=()=>page.locator('[data-action="redraw-mode"][aria-pressed="true"]').getAttribute('data-mode');
  await page.evaluate(()=>window.__retainedViewport=document.querySelector('#viewport'));
  await clickMode('three');
  assert.equal(await page.evaluate(()=>window.__retainedViewport===document.querySelector('#viewport')),true,'mode changes preserve the workspace DOM');
  await setRange(page,opacity,.6);await clickMode('outline');
  for(const [mode,value] of [['three',.6],['three',1],['blocks',1]]){
   await page.locator('[data-action="undo"]').click();assert.equal(await currentMode(),mode);assert.equal(Number(await page.locator(opacity).inputValue()),value);
  }
  for(const [mode,value] of [['three',1],['three',.6],['outline',.6]]){
   await page.locator('[data-action="redo"]').click();assert.equal(await currentMode(),mode);assert.equal(Number(await page.locator(opacity).inputValue()),value);
  }
  await page.locator('[data-action="undo"]').click();await clickMode('blocks');await clickMode('blocks');
  assert.equal(await page.locator('[data-action="redo"]').isDisabled(),true,'mode changes clear the redo branch');
  await page.locator('[data-action="undo"]').click();assert.equal(await currentMode(),'three','clicking the current mode does not create an extra undo step');
  const modeSaved=await save();assert.equal(modeSaved.layers.find(layer=>layer.id===redrawLayerId).params.mode,'three');
  assert.equal(modeSaved.layers.find(layer=>layer.id===redrawLayerId).opacity,.6);
  assert.deepEqual(modeSaved.layers.find(layer=>layer.id===sourceId).colorMap,modeProject.layers.find(layer=>layer.id===sourceId).colorMap,'mode undo preserves the source image bytes');
  console.log('PASS right-click screen-color cancellation and mixed mode/parameter undo, redo, branching, saved state and workspace retention');
  console.log('PASS outline mode, Ctrl multi-selection, deselect, toggle-hide, hover, shared color picker, linked movement and 30 large-project undo/redo steps');
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