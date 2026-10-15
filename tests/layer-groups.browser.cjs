/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Layer hierarchy regressions run in a fresh headless Edge context only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.tools','validation-layer-groups');

function colorImage(engine,encodeColorMap,id,name,rgba){
 const width=128,height=128,png=new PNG({width,height}),data=new Uint8ClampedArray(width*height*4);
 for(let offset=0;offset<data.length;offset+=4)data.set(rgba,offset);
 png.data.set(data);
 return Object.assign(engine.createImageMaskLayer({
  id,name,image:'data:image/png;base64,'+PNG.sync.write(png).toString('base64'),
  imageWidth:width,imageHeight:height,mode:'color',colorMap:encodeColorMap({width,height,data}),
 }),{offsetX:0,offsetY:0});
}
function makeFixture(engine,encodeColorMap){
 const doc=engine.createDocument();Object.assign(doc,{name:'Layer groups fixture',width:128,height:128,transparent:true});
 const red=colorImage(engine,encodeColorMap,'source-red','Synthetic red',[255,0,0,255]);
 const green=colorImage(engine,encodeColorMap,'source-green','Synthetic green',[0,255,0,128]);
 const skipped=engine.createLayer('dots','effect-between');skipped.imageSource='none';skipped.visible=true;
 skipped.color='#26384a';skipped.secondary='#9db0bd';skipped.params.spacing=128;skipped.params.size=64;
 const pixel=engine.createLayer('pixel','effect-top');
 Object.assign(pixel.params,{sizeMode:'width',pixelCount:4,colorCount:16,outputSize:'grid',resample:'nearest',dither:'none'});
 doc.layers=[red,green,skipped,pixel];
 return {doc,redId:red.id,greenId:green.id,skipId:skipped.id,pixelId:pixel.id};
}
function rgbaAt(png,x=0,y=0){const offset=(y*png.width+x)*4;return [...png.data.subarray(offset,offset+4)];}
function allAlpha(png){const values=new Set();for(let i=3;i<png.data.length;i+=4)values.add(png.data[i]);return [...values].sort((a,b)=>a-b);}

(async()=>{
 const engine=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const {encodeColorMap}=await import(pathToFileURL(path.join(root,'app/image-color.mjs')));
 const fixture=makeFixture(engine,encodeColorMap);
 const bundle=require('esbuild').buildSync({entryPoints:[path.join(root,'app/engine.mjs')],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].contents;
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=http.createServer(async(req,res)=>{
  try{
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep))throw Error('outside');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
   res.end(file===path.join(root,'app/engine.mjs')?bundle:await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser,page;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false})));
  page=await context.newPage();const errors=[];
  page.on('dialog',dialog=>dialog.accept());
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/index.html');
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await fs.mkdir(output,{recursive:true});

  const isDirty=()=>page.locator('html').getAttribute('data-project-dirty');
  const row=id=>page.locator('#layer-list [data-layer-id="'+id+'"]');
  const selectButton=id=>row(id).locator('[data-action="select-layer"]');
  const selectLayer=async id=>{
   await selectButton(id).click();
   await page.waitForFunction(expected=>document.querySelector('#layer-list .layer.selected [data-action="select-layer"]')?.dataset.id===expected,id,{timeout:10000});
  };
  const activeSourceMode=()=>page.locator('#inspector [data-action="image-source"][aria-pressed="true"]').getAttribute('data-mode');
  const setSource=async mode=>{
   await ensureSourceSection();
   await page.locator('#inspector [data-action="image-source"][data-mode="'+mode+'"]').click();
   await page.waitForFunction(expected=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode===expected,mode,{timeout:10000});
  };
  const ensureSourceSection=async()=>{
   const section=page.locator('#inspector details[data-section="image-source"]');
   await section.waitFor({state:'attached'});
   if(!await section.evaluate(node=>node.open))await section.locator('summary').click();
   return section;
  };
  const save=async()=>{
   const pending=page.waitForEvent('download');
   await page.locator('[data-action="save"]').click();
   const download=await pending,file=await download.path();
   assert.ok(file,'headless browser completed the project download');
   return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const load=async(project,name)=>{
   const wasDirty=await isDirty()==='true';
   await page.locator('#file-project').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   if(wasDirty){await page.locator('#unsaved-discard').waitFor({state:'visible',timeout:10000});await page.locator('#unsaved-discard').click();}
   await page.waitForFunction(expected=>document.querySelector('.document-name span')?.textContent===expected,project.name,{timeout:10000});
  };
  const exportPNG=async()=>{
   await page.locator('[data-action="export"]').click();
   const dialog=page.locator('#dialog-root dialog[open]');await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-format="png"]').click();
   const alpha=dialog.locator('#export-alpha');if(!await alpha.isChecked())await alpha.check();
   const pending=page.waitForEvent('download');await dialog.locator('#do-export').click();
   const download=await pending,file=await download.path();await dialog.waitFor({state:'detached'});
   return PNG.sync.read(await fs.readFile(file));
  };
  const groupFrom=project=>project.layers.find(layer=>layer.type==='group');
  const groupChildren=(project,id)=>project.layers.filter(layer=>layer.parentId===id);
  const scopeRefs=async effectId=>page.locator('#artboard svg [id="image-color-source-'+effectId+'"] use').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
  const assertSourceButtonsFit=async locale=>{
   await page.locator('.language-select').selectOption(locale);
   await page.waitForFunction(expected=>document.querySelector('.language-select')?.value===expected,locale);
   await ensureSourceSection();
   const layout=await page.locator('.image-source-modes').evaluate(element=>{
    const box=element.getBoundingClientRect(),buttons=[...element.querySelectorAll('button')];
    return {
     containerOverflow:element.scrollWidth>element.clientWidth+1,
     buttonOverflow:buttons.some(button=>button.scrollWidth>button.clientWidth+1),
     outside:buttons.some(button=>{const rect=button.getBoundingClientRect();return rect.left<box.left-1||rect.right>box.right+1;}),
    };
   });
   assert.equal(layout.containerOverflow,false,locale+' source toolbar fits its container at 1440px');
   assert.equal(layout.buttonOverflow,false,locale+' source labels fit their buttons at 1440px');
   assert.equal(layout.outside,false,locale+' source buttons stay inside their toolbar at 1440px');
  };
  await load(fixture.doc,'layer-groups.ctm');
  await selectLayer(fixture.redId);
  await selectButton(fixture.greenId).click({modifiers:['Control']});
  await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer.multi-selected').length===2,{},{timeout:10000});
  const rangeStart=selectButton(fixture.skipId);
  await rangeStart.click();
  await selectButton(fixture.redId).click({modifiers:['Shift']});
  await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer.multi-selected').length===3,{},{timeout:10000});
  await selectLayer(fixture.redId);
  await selectButton(fixture.greenId).click({modifiers:['Control']});
  await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer.multi-selected').length===2,{},{timeout:10000});

  await page.locator('[data-action="group-layers"]').click();
  let saved=await save(),group=groupFrom(saved);
  assert.ok(group,'group toolbar creates a group node');
  let children=groupChildren(saved,group.id);
  assert.deepEqual(children.map(layer=>layer.id),[fixture.redId,fixture.greenId],'group children keep bottom-to-top order');
  const groupIndex=saved.layers.findIndex(layer=>layer.id===group.id);
  assert.deepEqual(saved.layers.slice(groupIndex-2,groupIndex).map(layer=>layer.id),[fixture.redId,fixture.greenId],'group children are contiguous immediately before their group header');

  await page.locator('[data-action="undo"]').click();
  const undone=await save();
  assert.equal(undone.layers.some(layer=>layer.type==='group'),false,'undo restores the ungrouped layer list');
  await page.locator('[data-action="redo"]').click();
  saved=await save();group=groupFrom(saved);
  assert.ok(group,'redo restores grouping');
  await selectLayer(group.id);
  await page.keyboard.press('Control+Shift+g');
  saved=await save();
  assert.equal(saved.layers.some(layer=>layer.type==='group'),false,'Ctrl+Shift+G ungroups selected group');
  await selectLayer(fixture.redId);
  await selectButton(fixture.greenId).click({modifiers:['Control']});
  await page.keyboard.press('Control+g');
  saved=await save();group=groupFrom(saved);
  assert.ok(group,'Ctrl+G groups the selected siblings');

  await selectLayer(group.id);
  await page.locator('[data-action="ungroup-layers"]').click();
  saved=await save();
  assert.equal(saved.layers.some(layer=>layer.type==='group'),false,'ungroup toolbar removes the selected group');
  await page.locator('[data-action="undo"]').click();
  saved=await save();group=groupFrom(saved);
  assert.ok(group,'undo restores toolbar ungroup');
  await page.locator('[data-action="redo"]').click();
  saved=await save();
  assert.equal(saved.layers.some(layer=>layer.type==='group'),false,'redo reapplies toolbar ungroup');
  await page.locator('[data-action="undo"]').click();
  saved=await save();group=groupFrom(saved);
  assert.ok(group,'grouped state is restored for hierarchy checks');
  await selectLayer(group.id);
  const renamedGroup='Browser regression group';
  const groupNameInput=page.locator('#inspector input[data-target="group"][data-key="name"]');
  await groupNameInput.fill(renamedGroup);
  await groupNameInput.press('Tab');
  await page.waitForFunction(expected=>document.querySelector('#art-title')?.textContent===expected,renamedGroup,{timeout:10000});
  saved=await save();group=groupFrom(saved);
  assert.equal(group.name,renamedGroup,'renaming a group updates its stage title and saved name');

  await selectLayer(fixture.skipId);
  const sourceModes=await page.locator('#inspector [data-action="image-source"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mode).sort());
  assert.deepEqual(sourceModes,['all','below','none'],'inspector uses the three source buttons');
  assert.equal(await page.locator('#inspector select[data-key="imageSource"]').count(),0,'source dropdown is absent');
  assert.equal(await page.locator('#inspector .image-source-field [data-action="add-layer"]').count(),0,'source panel has no add-effect button');
  await setSource('below');
  await page.waitForFunction(({effectId,redId,greenId})=>{
   const scope=document.querySelector('#artboard svg [id="image-color-source-'+effectId+'"]');
   if(!scope)return false;
   const refs=Array.from(scope.querySelectorAll('use'),node=>node.getAttribute('href'));
   return refs.includes('#image-source-'+redId)&&refs.includes('#image-source-'+greenId);
  },{effectId:fixture.skipId,redId:fixture.redId,greenId:fixture.greenId},{timeout:10000});
  let refs=await scopeRefs(fixture.skipId);
  assert.deepEqual(refs,['#image-source-'+fixture.redId,'#image-source-'+fixture.greenId],'below source resolves both color images from the nearest lower group, skipping the intervening effect');
  await selectLayer(fixture.pixelId);
  await setSource('below');
  await ensureSourceSection();
  await page.screenshot({path:path.join(output,'layer-tree-dark.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.screenshot({path:path.join(output,'layer-tree-light.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  for(const locale of ['en','ja'])await assertSourceButtonsFit(locale);
  await page.locator('.language-select').selectOption('zh');
  await page.waitForFunction(()=>document.querySelector('.language-select')?.value==='zh');
  await ensureSourceSection();

  const initialComposite=await exportPNG();
  assert.deepEqual([initialComposite.width,initialComposite.height],[4,4],'pixel effect exports the normalized four-by-four synthetic sample');
  assert.deepEqual(rgbaAt(initialComposite),[127,128,0,255],'below source blends the lower red and upper half-alpha green images');

  const groupRow=()=>row(group.id);
  const redRow=()=>row(fixture.redId);
  const greenRow=()=>row(fixture.greenId);
  await redRow().dragTo(greenRow(),{targetPosition:{x:80,y:1}});
  saved=await save();group=groupFrom(saved);
  children=groupChildren(saved,group.id);
  assert.deepEqual(children.map(layer=>layer.id),[fixture.greenId,fixture.redId],'drag reorders group children');
  const reorderedComposite=await exportPNG();
  assert.deepEqual(rgbaAt(reorderedComposite),[255,0,0,255],'reordering the source images changes the exported pixel composite');

  await row(fixture.skipId).dragTo(groupRow(),{targetPosition:{x:80,y:Math.max(2,(await groupRow().boundingBox()).height/2)}});
  saved=await save();group=groupFrom(saved);
  assert.equal(saved.layers.find(layer=>layer.id===fixture.skipId).parentId,group.id,'drag moves an effect into a group');
  children=groupChildren(saved,group.id);
  assert.deepEqual(children.map(layer=>layer.id),[fixture.greenId,fixture.redId,fixture.skipId],'drop into group keeps children contiguous before the group header');

  const pixelRow=row(fixture.pixelId);
  const rootDrop=page.locator('#layer-list [data-layer-drop-root]');
  assert.equal(await rootDrop.isVisible(),true,'layer list exposes a root drop target');
  await row(fixture.skipId).dragTo(rootDrop,{targetPosition:{x:80,y:Math.max(2,(await rootDrop.boundingBox()).height/2)}});
  saved=await save();group=groupFrom(saved);
  assert.equal(saved.layers.find(layer=>layer.id===fixture.skipId).parentId,undefined,'drag moves a grouped effect back to root');

  await groupRow().dragTo(redRow(),{targetPosition:{x:80,y:24}});
  saved=await save();group=groupFrom(saved);
  assert.equal(group.parentId,undefined,'dropping a group onto its own descendant is rejected');
  assert.equal(saved.layers.find(layer=>layer.id===fixture.redId).parentId,group.id,'cycle rejection preserves the descendant membership');

  await row(fixture.skipId).locator('[data-action="visibility"][data-id="'+fixture.skipId+'"]').click();
  await groupRow().locator('[data-action="visibility"][data-id="'+group.id+'"]').click();
  saved=await save();group=groupFrom(saved);
  assert.equal(group.visible,false,'group visibility can be turned off');
  assert.ok(groupChildren(saved,group.id).every(layer=>layer.visible===true),'hiding a group preserves each child visibility flag');
  const hiddenRefs=await scopeRefs(fixture.skipId);
  assert.deepEqual(hiddenRefs,[],'hidden group descendants are not inherited as effect sources');
  const hiddenComposite=await exportPNG();
  assert.deepEqual(allAlpha(hiddenComposite),[0],'hiding the group hides its descendant sources in the exported result');
  await page.locator('[data-action="undo"]').click();
  saved=await save();group=groupFrom(saved);
  assert.equal(group.visible,true,'undo restores inherited group visibility');
  await page.locator('[data-action="redo"]').click();
  saved=await save();group=groupFrom(saved);
  assert.equal(group.visible,false,'redo hides the group again');
  await groupRow().locator('[data-action="visibility"][data-id="'+group.id+'"]').click();
  saved=await save();group=groupFrom(saved);

  await page.locator('[data-action="toggle-group"][data-id="'+group.id+'"]').click();
  saved=await save();group=groupFrom(saved);
  assert.equal(group.collapsed,true,'collapse state is saved on the group node');
  assert.equal(await row(fixture.redId).isVisible(),false,'collapsed group hides its first child row');
  await page.locator('[data-action="toggle-group"][data-id="'+group.id+'"]').click();
  await row(fixture.redId).waitFor({state:'visible',timeout:10000});

  await row(fixture.skipId).dragTo(groupRow(),{targetPosition:{x:80,y:Math.max(2,(await groupRow().boundingBox()).height/2)}});
  saved=await save();group=groupFrom(saved);
  assert.equal(saved.layers.find(layer=>layer.id===fixture.skipId).parentId,group.id,'effect can be moved into the group after reopening it');
  await row(fixture.skipId).dragTo(rootDrop,{targetPosition:{x:80,y:Math.max(2,(await rootDrop.boundingBox()).height/2)}});
  saved=await save();group=groupFrom(saved);
  assert.equal(saved.layers.find(layer=>layer.id===fixture.skipId).parentId,undefined,'effect can be moved back to root');
  const rootOrderBefore=saved.layers.filter(layer=>!layer.parentId).map(layer=>layer.id);
  await groupRow().dragTo(pixelRow,{targetPosition:{x:80,y:1}});
  saved=await save();group=groupFrom(saved);
  const rootOrderAfter=saved.layers.filter(layer=>!layer.parentId).map(layer=>layer.id);
  assert.notDeepEqual(rootOrderAfter,rootOrderBefore,'drag reorders root-level layer blocks');
  assert.equal(group.parentId,undefined,'root reorder keeps the group at root');

  const groupedRoundTrip=await save();
  await load(groupedRoundTrip,'group-roundtrip.ctm');
  await selectLayer(fixture.pixelId);
  const roundTripGroup=groupFrom(groupedRoundTrip);
  assert.ok(roundTripGroup,'download roundtrip contains the group node');
  assert.deepEqual(groupChildren(groupedRoundTrip,roundTripGroup.id).map(layer=>layer.id),[fixture.greenId,fixture.redId],'download roundtrip preserves group membership and child order');
  assert.equal(roundTripGroup.collapsed,false,'download roundtrip preserves the expanded group state');
  assert.equal(await activeSourceMode(),'below','download roundtrip restores the below source control');

  const legacy=JSON.parse(JSON.stringify(fixture.doc));legacy.name='Legacy flat project';
  for(const layer of legacy.layers){delete layer.parentId;if(layer.type!=='imageMask')delete layer.imageSource;}
  await load(legacy,'legacy-flat.ctm');
  await selectLayer(fixture.pixelId);
  assert.equal(await activeSourceMode(),'below','legacy auto source maps to the compatibility toolbar state');
  const legacyRoundTrip=await save();
  assert.equal(legacyRoundTrip.layers.find(layer=>layer.id===fixture.pixelId).imageSource,'auto','legacy auto source survives loading and saving');
  assert.equal(legacyRoundTrip.layers.some(layer=>layer.type==='group'),false,'older flat projects load without synthetic groups');
  // Layer operations protect at least one pattern while keeping image deletion undoable.
  await load(fixture.doc,'layer-operation-guards.ctm');
  const rootOrder=project=>project.layers.filter(layer=>!layer.parentId).map(layer=>layer.id);
  for(const action of ['layer-up','layer-down']){
   await selectLayer(fixture.skipId);
   await page.locator('[data-action="'+action+'"]').click();
   const moved=await save();
   assert.notDeepEqual(rootOrder(moved),rootOrder(fixture.doc),action+' toolbar changes the selected layer order');
   await page.locator('[data-action="undo"]').click();
   const restored=await save();
   assert.deepEqual(rootOrder(restored),rootOrder(fixture.doc),action+' undo restores the original layer order');
  }
  await selectLayer(fixture.redId);
  await page.locator('[data-action="delete"]').click();
  let deletedImage=await save();
  assert.equal(deletedImage.layers.some(layer=>layer.id===fixture.redId),false,'deleting one image layer succeeds');
  await page.locator('[data-action="undo"]').click();
  const restoredImage=await save();
  assert.ok(restoredImage.layers.some(layer=>layer.id===fixture.redId),'undo restores a deleted image layer');

  await selectLayer(fixture.skipId);
  await selectButton(fixture.pixelId).click({modifiers:['Control']});
  await page.locator('[data-action="delete"]').click();
  const protectedPatterns=await save();
  assert.ok([fixture.skipId,fixture.pixelId].every(id=>protectedPatterns.layers.some(layer=>layer.id===id)),'deleting all pattern layers is refused');

  await selectLayer(fixture.skipId);
  await selectButton(fixture.pixelId).click({modifiers:['Control']});
  await page.locator('[data-action="group-layers"]').click();
  const protectedGroup=await save(),lastPatternGroup=groupFrom(protectedGroup);
  assert.ok(lastPatternGroup,'the final pattern layers can be placed in a group');
  await selectLayer(lastPatternGroup.id);
  await page.locator('[data-action="delete"]').click();
  const afterGroupDelete=await save();
  assert.ok(groupFrom(afterGroupDelete),'deleting a group that contains all pattern layers is refused');
  assert.ok([fixture.skipId,fixture.pixelId].every(id=>afterGroupDelete.layers.some(layer=>layer.id===id)),'refused group deletion preserves its pattern children');
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已自動儲存',{}, {timeout:10000});
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true'&&document.querySelectorAll('#layer-list .layer.selected').length===1&&document.querySelectorAll('#layer-list .layer.multi-selected').length===1,{}, {timeout:10000});
  const activeIds=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
  const multiSelectedIds=await page.locator('#layer-list .layer.multi-selected [data-action="select-layer"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
  assert.equal(activeIds.length,1,'autosave reload initializes exactly one active layer');
  assert.deepEqual(multiSelectedIds,activeIds,'autosave reload keeps the active layer and multi-selection in sync');

  assert.deepEqual(errors,[],'headless browser completed without page and console errors');

  console.log('PASS group/ungroup shortcuts and toolbar, range selection, collapse, drag reorder/nesting, cycle rejection, below-group sampling, visibility, undo/redo, download roundtrip and legacy loading');
  console.log('Screenshots:',path.join(output,'layer-tree-dark.png'),'and',path.join(output,'layer-tree-light.png'));
  await context.close();
 }catch(error){
  if(page){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'layer-groups-failure.png'),fullPage:true}).catch(()=>{});}
  throw error;
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
