/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Run with Playwright and Microsoft Edge installed. Uses a fresh headless context.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {PNG}=require('pngjs');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};

(async()=>{
 const {createDocument,createLayer,PATTERNS}=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const engineBundle=require('esbuild').buildSync({entryPoints:[path.join(root,'app/engine.mjs')],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].contents;
 const server=http.createServer(async(req,res)=>{
  try{
   const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
   if(!file.startsWith(root+path.sep))throw new Error('Outside fixture root');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(file===path.join(root,'app/engine.mjs')?engineBundle:await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>{if(!localStorage.getItem('ctm.preferences'))localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false}));});
  const page=await context.newPage(),errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}/app/index.html`;
  await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const field=key=>page.locator(`#inspector input[type=number][data-key="${key}"]`);
  const openInspectorSection=async key=>{const section=page.locator(`#inspector details[data-section="${key}"]`);if(!await section.evaluate(el=>el.open))await section.locator('summary').click();};
  const change=async(key,value)=>{await field(key).fill(String(value));await field(key).press('Tab');await page.waitForTimeout(40);};
  const load=async(type,params={},layerExtra={},docExtra={})=>{
   const doc=createDocument();Object.assign(doc,{width:512,height:512},docExtra);doc.layers=[createLayer(type,'fixture')];Object.assign(doc.layers[0],{color:'#252525',secondary:'#787878'},layerExtra);Object.assign(doc.layers[0].params,params);
   const discard=await page.locator('html').getAttribute('data-project-dirty')==='true';
   await page.locator('#file-project').setInputFiles({name:'fixture.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
   if(discard)await page.locator('#unsaved-discard').click();
   await page.waitForFunction(type=>document.querySelector(`[data-pattern="${type}"]`)?.getAttribute('aria-pressed')==='true',type);await page.waitForTimeout(80);
   return doc;
  };
  const centers=()=>page.locator('#artboard [data-cell]').evaluateAll(nodes=>nodes.map(el=>{const m=el.getScreenCTM(),x=Number(el.dataset.cx),y=Number(el.dataset.cy);return{id:el.dataset.cell,x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};}));
  const hidden=()=>page.locator('#artboard [data-hidden=true]').count();
  const transform=()=>page.locator('#artboard-wrap').evaluate(el=>el.style.transform);
  const drag=async(a,b)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up();await page.waitForTimeout(80);};
  const download=async(action)=>{const event=page.waitForEvent('download');await action();const item=await event;return fs.readFile(await item.path());};
  const save=()=>download(()=>page.locator('[data-action=save]').click());
  const exported=async(format)=>{await page.locator('[data-action=export]').click();await page.locator(`[data-format=${format}]`).click();return download(()=>page.locator('#do-export').click());};

  // Pattern variants belong to their layer and survive real editor save/restore routes.
  {
   await load('dots',{spacing:52,size:12},{rotation:18,offsetX:16,hiddenCells:['1:1']});
   await change('spacing',73);
   await page.locator('[data-pattern=grid]').click();await change('cellSize',88);
   await page.locator('[data-pattern=dots]').click();assert.equal(await field('spacing').inputValue(),'73');
   await openInspectorSection('transform');assert.equal(await field('rotation').inputValue(),'18');await change('rotation',31);
   const beforeSame=JSON.parse((await save()).toString());await page.locator('[data-pattern=dots]').click();
   assert.deepEqual(JSON.parse((await save()).toString()),beforeSame,'clicking the current pattern must keep all settings');
   await page.locator('[data-pattern=grid]').click();assert.equal(await field('cellSize').inputValue(),'88');
   const project=await save(),stored=JSON.parse(project.toString());
   assert.equal(stored.layers[0].patternSettings.dots.params.spacing,73,'inactive pattern parameters are saved');
   assert.equal(stored.layers[0].patternSettings.dots.rotation,31);assert.deepEqual(stored.layers[0].patternSettings.dots.hiddenCells,['1:1']);
   await load('waves');await page.locator('#file-project').setInputFiles({name:'All patterns.ctm',mimeType:'application/json',buffer:project});
   await page.waitForFunction(()=>document.querySelector('[data-pattern=grid]')?.getAttribute('aria-pressed')==='true');
   await page.locator('[data-pattern=dots]').click();assert.equal(await field('spacing').inputValue(),'73');assert.equal(await field('rotation').inputValue(),'31');
   await page.locator('[data-action=undo]').click();assert.equal(await field('cellSize').inputValue(),'88','undo restores the previous pattern and settings');
   await page.locator('[data-action=redo]').click();assert.equal(await field('spacing').inputValue(),'73');
   await page.locator('[data-action=reset]').click();assert.equal(Number(await field('spacing').inputValue()),PATTERNS.find(p=>p.id==='dots').defaults.spacing);
   await page.locator('[data-action=undo]').click();assert.equal(await field('spacing').inputValue(),'73','reset can be undone');
   await page.locator('[data-action=redo]').click();await page.locator('[data-pattern=grid]').click();assert.equal(await field('cellSize').inputValue(),'88','reset leaves other patterns intact');
   await page.locator('[data-pattern=dots]').click();await change('spacing',67);await page.locator('[data-pattern=grid]').click();
   await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
   assert.equal(await field('cellSize').inputValue(),'88');await page.locator('[data-pattern=dots]').click();assert.equal(await field('spacing').inputValue(),'67','autosave restores inactive settings after reload');
   await page.locator('[data-action=duplicate]').click();await change('spacing',99);await page.locator('[data-pattern=grid]').click();await change('cellSize',120);
   await page.locator('[data-action=select-layer][data-id=fixture]').click();assert.equal(await field('spacing').inputValue(),'67');
   await page.locator('[data-pattern=grid]').click();assert.equal(await field('cellSize').inputValue(),'88','duplicated layers keep independent variant settings');
   console.log('PASS pattern settings across switching, same-pattern clicks, project save/reopen, undo/redo, reset, autosave and independent layers');
  }

  await load('dots',{finite:true,rows:8,columns:8,size:8});
  let cells=await centers();const a=cells[18],b=cells[22],blank={x:a.x+18,y:a.y+18},original=await transform();
  await drag(blank,{x:blank.x+80,y:blank.y+30});assert.equal(await transform(),original,'cursor must never pan on a missed cell');
  await page.locator('[data-action=restore-cells]').click();
  await page.mouse.move(a.x,a.y);await page.mouse.down({button:'middle'});await page.mouse.move(a.x+40,a.y+15);await page.mouse.up({button:'middle'});assert.notEqual(await transform(),original,'existing middle-button pan remains available');assert.equal(await hidden(),0);await page.locator('[data-action=fit]').click();
  await page.locator('[data-action=tool-hand]').click();await drag(blank,{x:blank.x+70,y:blank.y+30});assert.notEqual(await transform(),original,'hand must pan');assert.equal(await hidden(),0,'hand must not edit cells');
  await page.locator('[data-action=fit]').click();await page.locator('[data-action=tool-cursor]').click();
  await page.mouse.move(blank.x,blank.y);await page.keyboard.down('Space');await drag(blank,{x:blank.x+45,y:blank.y+20});await page.keyboard.up('Space');assert.notEqual(await transform(),original,'Space must temporarily pan after tool button focus');assert.equal(await page.locator('#viewport').getAttribute('data-canvas-tool'),'cursor');
  await page.locator('[data-action=fit]').click();
  await page.locator('[data-action=edit-mode-select]').selectOption('erase');await change('brushSize',96);
  cells=await centers();await drag({x:cells[18].x,y:cells[18].y+12},{x:cells[22].x,y:cells[22].y+12});
  const erased=await hidden();assert.ok(erased>=5,`wide fast stroke should erase multiple cells, got ${erased}`);assert.equal(await transform(),original);
  await page.locator('[data-action=undo]').click();assert.equal(await hidden(),0,'one undo must restore the whole stroke');await page.locator('[data-action=redo]').click();assert.equal(await hidden(),erased);
  await page.locator('[data-action=edit-mode-select]').selectOption('paint');await drag({x:cells[18].x,y:cells[18].y+12},{x:cells[22].x,y:cells[22].y+12});assert.equal(await hidden(),0,'paint restores all cells within the stroke');
  await page.mouse.move(blank.x,blank.y);await page.keyboard.down('Space');assert.equal(await page.locator('#viewport').getAttribute('data-canvas-tool'),'hand','canvas editing releases the brush input focus for shortcuts');await page.keyboard.up('Space');
  await page.locator('[data-action=view-repeat]').click();const tiledTransform=await transform();await drag(blank,{x:blank.x+60,y:blank.y+20});assert.equal(await transform(),tiledTransform,'repeat view does not turn missed edits into pan');await page.locator('[data-action=view-single]').click();
  console.log('PASS cursor, hand, Space, brush area, fast drag, undo/redo, repeat view');

  await load('polygons',{cellSize:90,shape:'triangle'},{rotation:23,scale:1.2},{seamless:true});
  await page.locator('[data-action=edit-mode-select]').selectOption('erase');await change('brushSize',160);
  const art=await page.locator('#artboard').boundingBox(),middle={x:art.x+art.width/2,y:art.y+art.height/2};
  await drag(middle,{x:middle.x+100,y:middle.y+20});assert.ok(await hidden()>3,'transformed seamless polygons respond to brush');await page.locator('[data-action=undo]').click();assert.equal(await hidden(),0);
  console.log('PASS brush on rotated seamless polygon cells');

  await load('dots',{finite:true,rows:8,columns:8,size:12});
  await page.locator('[data-action=edit-mode-select]').selectOption('connect');await change('linkWidth',4);
  cells=await centers();const start=cells.find(c=>c.id==='2:2'),end=cells.find(c=>c.id==='2:6');
  await page.mouse.click(start.x,start.y);assert.equal(await page.locator('#connect-guide').isVisible(),true,'first point has visible feedback');
  await page.mouse.click(end.x,end.y);await page.waitForTimeout(60);assert.ok(await page.locator('#artboard [data-cell-link]').count()>0,'two visible cells must create a real line');
  assert.equal(JSON.parse((await save()).toString()).layers[0].cellLinks.length,1);
  const linkedPng=PNG.sync.read(await exported('png'));assert.ok(linkedPng.data[(160*512+192)*4+3]>200,'the line is present between cell centers in PNG export');
  assert.match((await exported('svg')).toString(),/data-cell-link/);
  await page.locator('[data-action=undo]').click();assert.equal(await page.locator('#artboard [data-cell-link]').count(),0);await page.locator('[data-action=redo]').click();assert.ok(await page.locator('#artboard [data-cell-link]').count()>0);
  await page.mouse.click(start.x,start.y);await page.mouse.click(end.x,end.y);await page.waitForTimeout(60);assert.equal(await page.locator('#artboard [data-cell-link]').count(),0,'same pair removes the connection');
  await page.mouse.click(start.x,start.y);await page.keyboard.press('Escape');assert.equal(await page.locator('#connect-guide').isVisible(),false);
  for(const shape of ['triangle','hexagon']){
   await load('polygons',{shape,cellSize:100},{rotation:21,scale:.9},{seamless:true});
   cells=await centers();const box=await page.locator('#artboard').boundingBox(),central=cells.filter(c=>c.x>box.x+box.width*.3&&c.x<box.x+box.width*.7&&c.y>box.y+box.height*.3&&c.y<box.y+box.height*.7);
   const p0=central[0],p1=central.find(c=>c.id!==p0.id);await page.mouse.click(p0.x,p0.y);await page.mouse.click(p1.x,p1.y);await page.waitForTimeout(60);assert.ok(await page.locator('#artboard [data-cell-link]').count()>0,`${shape} supports transformed seamless connections`);
  }
  console.log('PASS visible connections, start feedback, undo/redo, remove, Escape, polygon transforms and SVG/PNG');

  const mask=new PNG({width:128,height:64});
  for(let y=0;y<64;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4,v=x<64?0:255;mask.data[i]=mask.data[i+1]=mask.data[i+2]=v;mask.data[i+3]=y<8?0:255;}
  const maskBuffer=PNG.sync.write(mask);
  const replacement=PNG.sync.read(maskBuffer);replacement.data[0]=73;const replacementBuffer=PNG.sync.write(replacement),replacementDataUrl='data:image/png;base64,'+replacementBuffer.toString('base64');
  const alphaPixels=(png,x1,y1,x2,y2)=>{let total=0;for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)if(png.data[(y*png.width+x)*4+3]>8)total++;return total;};
  const alphaTotal=png=>{let total=0;for(let i=3;i<png.data.length;i+=4)if(png.data[i]>8)total++;return total;};
  const readMaskRaster=async()=>PNG.sync.read(await exported('png'));
  const savedDocument=async()=>JSON.parse((await save()).toString());
  const uploadMask=async()=>{await page.locator('#file-image-mask').setInputFiles({name:'Black white alpha.png',mimeType:'image/png',buffer:maskBuffer});await page.waitForFunction(()=>document.querySelector('#inspector .mask-source-preview img'));};
  const selectLayer=id=>page.locator('#layer-list [data-action=select-layer][data-id="'+id+'"]');
  const visibility=id=>page.locator('[data-action=visibility][data-id="'+id+'"]');
  await load('dots',{finite:false,spacing:48,size:12},{},{width:512,height:256});
  await uploadMask();
  let imageDoc=await savedDocument();let maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');
  assert.ok(maskLayer,'upload creates a persistent imageMask layer');assert.equal(maskLayer.imageWidth,128);assert.equal(maskLayer.imageHeight,64);assert.match(maskLayer.image,/^data:image\/png;base64,/);assert.equal(maskLayer.invert,false);assert.equal(maskLayer.fit,'contain');
  const maskId=maskLayer.id;
  const [maskChooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('[data-action=mask-replace]').click()]);await maskChooser.setFiles({name:'Replacement alpha.png',mimeType:'image/png',buffer:replacementBuffer});await page.waitForFunction(expected=>document.querySelector('#inspector .mask-source-preview img')?.getAttribute('src')===expected,replacementDataUrl);imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type==='imageMask').length,1);assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').id,maskId,'replacing the source preserves the selected mask layer');assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').image,replacementDataUrl,'replacement imports the new image source');
  const originalPatternId=imageDoc.layers.find(layer=>layer.type!=='imageMask').id;await selectLayer(originalPatternId).click();await page.locator('[data-action=duplicate]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type!=='imageMask').length,2,'pattern duplication remains available beside a mask');await page.locator('[data-action=delete]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type!=='imageMask').length,1,'deleting a duplicate preserves the last pattern');assert.equal(imageDoc.layers.filter(layer=>layer.type==='imageMask').length,1);
  await page.locator('[data-pattern=polygons]').click();
  imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type==='imageMask').length,1,'selecting a pattern while a mask is selected preserves the mask');assert.equal(imageDoc.layers.filter(layer=>layer.type!=='imageMask').length,1,'pattern selection replaces the last pattern');assert.equal(imageDoc.layers.find(layer=>layer.type!=='imageMask').type,'polygons');
  await page.locator('.library [data-action=add-layer]').click();await page.locator('[data-pattern=dots]').click();
  imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type==='imageMask').length,1);assert.equal(imageDoc.layers.filter(layer=>layer.type!=='imageMask').length,2,'image mask remains a separate layer across pattern edits');
  await selectLayer(maskId).click();assert.equal(await page.locator('#mask-overlay').isVisible(),true,'selected mask exposes transform handles in single view');await fs.mkdir(path.join(root,'.tools','validation-1.4.1'),{recursive:true});await page.screenshot({path:path.join(root,'.tools','validation-1.4.1','persistent-image-mask.png'),fullPage:true});
  let masked=await readMaskRaster();
  assert.ok(alphaPixels(masked,16,40,240,240)>0,'dark source region retains artwork');assert.equal(alphaPixels(masked,272,40,496,240),0,'white source region removes artwork from every pattern layer');assert.equal(alphaPixels(masked,0,0,512,24),0,'transparent source pixels remain empty');
  const baseAlpha=alphaTotal(masked);await page.locator('[data-action=layer-down]').click();let reordered=await readMaskRaster();assert.equal(alphaTotal(reordered),baseAlpha,'mask intersection is independent of layer stacking');
  imageDoc=await savedDocument();assert.equal(imageDoc.layers.filter(layer=>layer.type!=='imageMask').length,2);
  const dotsId=imageDoc.layers.find(layer=>layer.type==='dots').id;await selectLayer(dotsId).click();await change('spacing',24);await openInspectorSection('transform');await change('rotation',37);await selectLayer(maskId).click();
  const denserRotated=await readMaskRaster();assert.ok(alphaPixels(denserRotated,16,40,240,240)>0);assert.equal(alphaPixels(denserRotated,272,40,496,240),0,'pattern spacing and rotation do not rotate or scale mask coordinates');assert.equal(alphaPixels(denserRotated,0,0,512,24),0);
  await page.locator('#inspector [data-key="invert"]').check();let inverted=await readMaskRaster();assert.equal(alphaPixels(inverted,16,40,240,240),0);assert.ok(alphaPixels(inverted,272,40,496,240)>0);assert.equal(alphaPixels(inverted,0,0,512,24),0,'transparent pixels remain empty after inversion');
  await page.locator('#inspector [data-key="invert"]').uncheck();await change('threshold',72);const thresholdRange=page.locator('#layer-list [data-key="threshold"]');assert.equal(await thresholdRange.inputValue(),'72','inspector and layer-list threshold controls stay synchronized');await thresholdRange.focus();await thresholdRange.press('ArrowRight');assert.equal(await field('threshold').inputValue(),await thresholdRange.inputValue(),'left threshold slider updates the inspector number field');
  const thresholdLabels=[];for(const language of ['en','ja','zh']){await page.locator('[data-action=language]').selectOption(language);thresholdLabels.push(await field('threshold').evaluate(el=>el.closest('.field')?.querySelector('label')?.textContent.trim()||el.getAttribute('aria-label')||el.parentElement.textContent.trim()));}assert.equal(new Set(thresholdLabels).size,3,'mask threshold labels follow all three editor locales');
  await page.locator('#inspector [data-action=mask-auto-threshold]').click();assert.ok(Number.isFinite(Number(await field('threshold').inputValue())),'auto threshold remains available on the selected persistent mask');
  await openInspectorSection('mask-transform');await page.locator('#inspector select[data-key="fit"]').selectOption('cover');await change('scale',1.4);await change('rotation',28);await change('offsetX',36);await change('offsetY',14);await page.locator('#inspector [data-key="flipX"]').check();await page.locator('#inspector [data-key="flipY"]').check();
  imageDoc=await savedDocument();maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(maskLayer.fit,'cover');assert.equal(maskLayer.scale,1.4);assert.equal(maskLayer.rotation,28);assert.equal(maskLayer.offsetX,36);assert.equal(maskLayer.offsetY,14);assert.equal(maskLayer.flipX,true);assert.equal(maskLayer.flipY,true);assert.equal(maskLayer.threshold,Number(await field('threshold').inputValue()));
  const transformed=await readMaskRaster();assert.notDeepEqual(transformed.data,masked.data,'mask fit, scale, rotation, flip and offsets affect rendered artwork');
  const transformedProject=await save();await page.locator('#file-project').setInputFiles({name:'Transformed mask.ctm',mimeType:'application/json',buffer:transformedProject});await page.waitForFunction(()=>document.querySelector('#toast')?.classList.contains('show')&&document.querySelector('#toast').textContent==='專案已載入');await selectLayer(maskId).click();
  imageDoc=await savedDocument();maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(maskLayer.imageWidth,128);assert.equal(maskLayer.imageHeight,64);assert.equal(maskLayer.fit,'cover');assert.equal(maskLayer.scale,1.4);assert.equal(maskLayer.rotation,28);assert.equal(maskLayer.offsetX,36);assert.equal(maskLayer.offsetY,14);assert.equal(maskLayer.flipX,true);assert.equal(maskLayer.flipY,true,'transformed mask and source survive .ctm reopen');
  await page.locator('[data-action=mask-reset-transform]').click();imageDoc=await savedDocument();maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(maskLayer.fit,'contain');assert.equal(maskLayer.scale,1);assert.equal(maskLayer.rotation,0);assert.equal(maskLayer.offsetX,0);assert.equal(maskLayer.offsetY,0);assert.equal(maskLayer.flipX,false);assert.equal(maskLayer.flipY,false);
  const resizeHandles=page.locator('#mask-overlay [data-mask-action="resize"]'),rotateHandle=page.locator('#mask-overlay [data-mask-action="rotate"]');assert.equal(await resizeHandles.count(),4,'selected mask exposes four resize handles');assert.equal(await rotateHandle.count(),1,'selected mask exposes a rotate handle');
  const resizeBox=await resizeHandles.nth(2).boundingBox(),resizeStart={x:resizeBox.x+resizeBox.width/2,y:resizeBox.y+resizeBox.height/2};await drag(resizeStart,{x:resizeStart.x+14,y:resizeStart.y+14});imageDoc=await savedDocument();assert.ok(imageDoc.layers.find(layer=>layer.type==='imageMask').scale>1,'resize handle changes mask scale');await page.locator('[data-action=undo]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').scale,1,'one undo restores the resize gesture');
  await change('offsetY',64);const artboardBox=await page.locator('#artboard').boundingBox(),rotateBox=await rotateHandle.boundingBox();assert.ok(rotateBox,'rotate handle is available on the selected mask');const rotateStart={x:rotateBox.x+rotateBox.width/2,y:rotateBox.y+rotateBox.height/2},maskCenter={x:artboardBox.x+artboardBox.width/2,y:artboardBox.y+artboardBox.height/2+64*artboardBox.height/256},rotateRadius=Math.hypot(rotateStart.x-maskCenter.x,rotateStart.y-maskCenter.y),rotateAngle=Math.atan2(rotateStart.y-maskCenter.y,rotateStart.x-maskCenter.x),rotateTarget={x:maskCenter.x+Math.cos(rotateAngle+Math.PI/6)*rotateRadius,y:maskCenter.y+Math.sin(rotateAngle+Math.PI/6)*rotateRadius};await drag(rotateStart,rotateTarget);imageDoc=await savedDocument();assert.notEqual(imageDoc.layers.find(layer=>layer.type==='imageMask').rotation,0,'rotate handle changes mask rotation');await page.locator('[data-action=undo]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').rotation,0,'one undo restores the rotate gesture');await change('offsetY',0);
  imageDoc=await savedDocument();const panBox=await page.locator('#artboard').boundingBox(),panStart={x:panBox.x+panBox.width/2,y:panBox.y+panBox.height/2},beforeMaskPan=imageDoc.layers.find(layer=>layer.type==='imageMask'),beforePanTransform=await transform();await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(panStart.x,panStart.y);await page.keyboard.down('Space');await drag(panStart,{x:panStart.x+36,y:panStart.y+18});await page.keyboard.up('Space');assert.notEqual(await transform(),beforePanTransform,'Space plus drag pans the canvas with a mask selected');imageDoc=await savedDocument();const afterMaskPan=imageDoc.layers.find(layer=>layer.type==='imageMask');for(const key of ['scale','rotation','offsetX','offsetY'])assert.equal(afterMaskPan[key],beforeMaskPan[key],`Space pan leaves mask ${key} unchanged`);await page.locator('[data-action=fit]').click();
  const move=page.locator('#mask-overlay [data-mask-action="move"]'),moveBox=await move.boundingBox();assert.ok(moveBox,'move handle is available for a selected image mask');
  const beforeMove=maskLayer.offsetX;await drag({x:moveBox.x+moveBox.width/2,y:moveBox.y+moveBox.height/2},{x:moveBox.x+moveBox.width/2+28,y:moveBox.y+moveBox.height/2+10});imageDoc=await savedDocument();assert.notEqual(imageDoc.layers.find(layer=>layer.type==='imageMask').offsetX,beforeMove,'one canvas gesture moves the mask transform');
  const movedOffset=imageDoc.layers.find(layer=>layer.type==='imageMask').offsetX;await page.locator('[data-action=undo]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').offsetX,beforeMove,'one undo restores the full mask gesture');await page.locator('[data-action=redo]').click();imageDoc=await savedDocument();assert.equal(imageDoc.layers.find(layer=>layer.type==='imageMask').offsetX,movedOffset,'redo restores the mask gesture');await page.locator('[data-action=undo]').click();
  await page.locator('[data-action=view-repeat]').click();assert.equal(await page.locator('#mask-overlay').isVisible(),false,'transform handles are hidden in three-by-three repeat preview');
  const repeatState=await page.locator('#artboard svg').evaluate(svg=>({tiles:[...svg.children].filter(node=>node.matches('g[clip-path]')).length,maskImages:svg.querySelectorAll('defs mask image').length}));assert.equal(repeatState.tiles,9);assert.equal(repeatState.maskImages,1,'repeat preview reuses the embedded mask source');
  await page.locator('[data-action=view-single]').click();await visibility(maskId).click();const unmasked=await readMaskRaster();assert.ok(alphaPixels(unmasked,272,40,496,240)>0,'hiding the mask restores pattern artwork');assert.ok(alphaPixels(unmasked,0,0,512,24)>0,'hiding the mask restores artwork beneath transparent source pixels');
  await visibility(maskId).click();masked=await readMaskRaster();assert.equal(alphaPixels(masked,272,40,496,240),0,'showing the mask restores its global intersection');
  imageDoc=await savedDocument();const embeddedMask=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(embeddedMask.image,maskLayer.image,'project embeds the original image source');
  const maskSvg=(await exported('svg')).toString();assert.equal(maskSvg.split(embeddedMask.image).length-1,1,'SVG embeds the mask source once');assert.doesNotMatch(maskSvg,/data-mask-action/,'canvas transform handles are excluded from exports');
  const svgRegions=await page.evaluate(async source=>{const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;const count=(x1,y1,x2,y2)=>{let n=0;for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)if(data[(y*canvas.width+x)*4+3]>8)n++;return n;};URL.revokeObjectURL(url);return{left:count(16,40,240,240),right:count(272,40,496,240),top:count(0,0,512,24)};},maskSvg);
  assert.ok(svgRegions.left>0&&svgRegions.right===0&&svgRegions.top===0,'SVG raster and alpha PNG apply the same mask source');
  const roundTrip=await save();await page.locator('#file-project').setInputFiles({name:'Persistent mask.ctm',mimeType:'application/json',buffer:roundTrip});await page.waitForFunction(()=>document.querySelector('#toast')?.classList.contains('show')&&document.querySelector('#toast').textContent==='專案已載入');await selectLayer(maskId).click();
  imageDoc=await savedDocument();maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(maskLayer.image,embeddedMask.image);assert.equal(maskLayer.fit,'contain');assert.equal(maskLayer.rotation,0);assert.equal(maskLayer.offsetX,0);assert.equal(maskLayer.offsetY,0);
  await page.waitForTimeout(450);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  imageDoc=await savedDocument();maskLayer=imageDoc.layers.find(layer=>layer.type==='imageMask');assert.equal(maskLayer.image,embeddedMask.image,'persistent source survives app reload');assert.equal(maskLayer.type,'imageMask');
  await selectLayer(maskId).click();const dotsLayer=imageDoc.layers.find(layer=>layer.type==='dots');await selectLayer(dotsLayer.id).click();
  await page.locator('[data-action=edit-mode-select]').selectOption('erase');await change('brushSize',4);
  const dotsCenters=await page.locator('#artboard [data-cell][data-layer="'+dotsLayer.id+'"]').evaluateAll(nodes=>nodes.map(el=>{const m=el.getScreenCTM(),x=Number(el.dataset.cx),y=Number(el.dataset.cy);return{id:el.dataset.cell,x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};}));
  const artBox=await page.locator('#artboard').boundingBox(),editable=dotsCenters.find(point=>point.x<artBox.x+artBox.width*.42&&point.y>artBox.y+artBox.height*.3);assert.ok(editable,'dot cells remain manually editable beneath the persistent mask');
  await page.mouse.click(editable.x,editable.y);await page.waitForFunction(({layerId,cellId})=>[...document.querySelectorAll('#artboard [data-cell]')].some(el=>el.dataset.layer===layerId&&el.dataset.cell===cellId&&el.hasAttribute('data-hidden')),{layerId:dotsLayer.id,cellId:editable.id});
  imageDoc=await savedDocument();const editedDots=imageDoc.layers.find(layer=>layer.id===dotsLayer.id);assert.ok(editedDots.hiddenCells.length>0,'manual cell edits remain in hiddenCells beside the image mask');
  const manualCells=[...editedDots.hiddenCells];await selectLayer(maskId).click();await visibility(maskId).click();imageDoc=await savedDocument();assert.deepEqual(imageDoc.layers.find(layer=>layer.id===dotsLayer.id).hiddenCells,manualCells,'mask visibility changes preserve manual cell edits');
  const patternTypes=PATTERNS.map(pattern=>pattern.id);assert.equal(patternTypes.length,17,'coverage includes every production pattern');
  const browserMaskCoverage=await page.evaluate(async({types,source})=>{
   const {renderSVG,createDocument,createLayer,createImageMaskLayer}=await import('/app/engine.mjs'),canvas=document.createElement('canvas');
   // Keep repeated canvas readbacks on one backend so antialiasing comparisons stay deterministic.
   const context=canvas.getContext('2d',{willReadFrequently:true});
   const alphaCount=(x,y,width,height)=>{const data=context.getImageData(x,y,width,height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i]>8)count++;return count;};
   const rasterStats=async(svg,size,includeTotal=false)=>{const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image();image.src=url;try{await image.decode();canvas.width=size;canvas.height=size;context.clearRect(0,0,size,size);context.drawImage(image,0,0);const x0=Math.floor(size*.05),x1=Math.floor(size*.45),x2=Math.floor(size*.55),x3=Math.floor(size*.95),y0=Math.floor(size*.35),y1=Math.floor(size*.70),top0=Math.floor(size*.26),top1=Math.floor(size*.30),result={dark:alphaCount(x0,y0,x1-x0,y1-y0),white:alphaCount(x2,y0,x3-x2,y1-y0),transparentTop:alphaCount(0,top0,size,top1-top0)};if(includeTotal)result.total=alphaCount(0,0,size,size);return result;}finally{URL.revokeObjectURL(url);}};
   const rasterPixels=async(svg,width,height)=>{const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image();image.src=url;try{await image.decode();canvas.width=width;canvas.height=height;context.clearRect(0,0,width,height);context.drawImage(image,0,0);return new Uint8ClampedArray(context.getImageData(0,0,width,height).data);}finally{URL.revokeObjectURL(url);}};
   const documentFor=(type,size,masked)=>{const doc=createDocument(),pattern=createLayer(type,`coverage-${type}`);doc.width=size;doc.height=size;doc.transparent=true;doc.seamless=false;pattern.color='#252525';pattern.secondary='#787878';doc.layers=[pattern];if(masked)doc.layers.push(createImageMaskLayer({id:'coverage-mask',name:'Coverage mask',image:source,imageWidth:128,imageHeight:64}));return doc;};
   const results=[];for(const size of [512,1024])for(const type of types){const base=await rasterStats(renderSVG(documentFor(type,size,false)),size,true),masked=await rasterStats(renderSVG(documentFor(type,size,true)),size,true);results.push({type,size,base,masked});}
   const tiny=documentFor('concentric',128,false);tiny.layers[0].params.startAngle=-80;tiny.layers[0].params.sweep=160;const tinyBase=await rasterStats(renderSVG(tiny),128,true),tinyMasked={...tiny,layers:[tiny.layers[0],createImageMaskLayer({id:'tiny-mask',name:'White right half',image:source,imageWidth:128,imageHeight:64})]},tinyAfter=await rasterStats(renderSVG(tinyMasked),128,true);
   const repeatDoc=documentFor('polygons',128,true);repeatDoc.seamless=true;Object.assign(repeatDoc.layers[0].params,{cellSize:48,shape:'hexagon',filled:true});const singlePixels=await rasterPixels(renderSVG(repeatDoc,{repeat:1}),128,128),repeatPixels=await rasterPixels(renderSVG(repeatDoc,{repeat:3}),384,384);let mismatchedChannels=0;for(let tileY=0;tileY<3;tileY++)for(let tileX=0;tileX<3;tileX++)for(let y=0;y<128;y++)for(let x=0;x<128;x++){const sourceIndex=(y*128+x)*4,targetIndex=((tileY*128+y)*384+tileX*128+x)*4;for(let channel=0;channel<4;channel++)if(singlePixels[sourceIndex+channel]!==repeatPixels[targetIndex+channel])mismatchedChannels++;}
   return{results,tinyConcentric:{base:tinyBase.total,masked:tinyAfter.total},repeatHexagon:{mismatchedChannels}};
  },{types:patternTypes,source:'data:image/png;base64,'+maskBuffer.toString('base64')});
  assert.equal(browserMaskCoverage.results.length,34,'all 17 patterns render at both 512 and 1024');
  const darkRetentionCases=browserMaskCoverage.results.map(result=>({pattern:result.type,size:result.size,base:result.base.dark,masked:result.masked.dark,ratio:result.base.dark?Number((result.masked.dark/result.base.dark).toFixed(4)):null})),measuredRetention=darkRetentionCases.filter(result=>result.ratio!==null),minimumRetention=measuredRetention.reduce((minimum,result)=>result.ratio<minimum.ratio?result:minimum,measuredRetention[0]);console.log(`MASK_DARK_RETENTION ${JSON.stringify(minimumRetention)}`);
  for(const result of browserMaskCoverage.results){const label=`${result.type} at ${result.size}px`;assert.ok(result.base.total>0||result.masked.total===0,`${label} preserves a naturally empty baseline`);if(result.base.dark>0)assert.ok(result.masked.dark>=result.base.dark*.95,`${label} retains baseline artwork in the opaque dark half (${result.masked.dark}/${result.base.dark} pixels)`);if(result.base.white>0)assert.equal(result.masked.white,0,`${label} removes baseline artwork in the opaque white half`);assert.equal(result.masked.transparentTop,0,`${label} keeps the transparent source band empty`);}
  assert.ok(browserMaskCoverage.tinyConcentric.base>0,'128px concentric reproduction has baseline arc artwork');assert.equal(browserMaskCoverage.tinyConcentric.masked,0,'128px concentric artwork confined to the white right half renders fully transparent after masking');
  assert.equal(browserMaskCoverage.repeatHexagon.mismatchedChannels,0,'all nine masked seamless hexagon preview tiles match the single-tile raster pixel-for-pixel');
  console.log('PASS persistent image mask source, global threshold/invert/alpha, transforms, stack order, repeat preview, undo, visibility and manual edits');
  console.log('PASS browser SVG mask coverage for all 17 patterns at 512/1024, 128px concentric white-half reproduction, and nine seamless hexagon tiles');

  await load('dots',{finite:true,rows:5,columns:5,size:60});
  const styledSvg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop stop-color="#ffcc00"/><stop offset="1" stop-color="#ff5500"/></linearGradient><clipPath id="clip"><circle cx="32" cy="32" r="27"/></clipPath><clipPath id="full"><rect width="64" height="64"/></clipPath><mask id="mask" style="mask-type:luminance"><rect width="64" height="64" fill="white"/><circle cx="32" cy="32" r="9" fill="black"/></mask><mask id="full-mask"><rect width="64" height="64" fill="white"/></mask></defs><rect width="64" height="64" style="fill:url(\'#g\');stroke:#fff;stroke-width:2;clip-path:url(\'#clip\');mask:url(\'#mask\')" fill="#00ff00" clip-path="url(\'#full\')" mask="url(\'#full-mask\')"/></svg>';
  await page.locator('[data-action=shape-library]').click();await page.locator('#file-image').setInputFiles({name:'Sun ring.svg',mimeType:'image/svg+xml',buffer:Buffer.from(styledSvg)});
  await page.waitForFunction(()=>document.querySelector('#artboard image')?.getAttribute('href')?.startsWith('data:image/svg+xml'));assert.equal(await page.locator('#p-shape').inputValue(),'custom');
  const data=await page.locator('#artboard image').first().getAttribute('href'),xml=Buffer.from(data.split(',')[1],'base64').toString();assert.match(xml,/fill="url\(#g\)"/);assert.match(xml,/clip-path="url\(#clip\)"/);assert.match(xml,/mask="url\(#mask\)"/);assert.match(xml,/mask-type="luminance"/);assert.doesNotMatch(xml,/style=/);
  await page.locator('[data-action=shape-library]').click();await page.locator('[data-action=rename-shape]').click();await page.locator('#name-input').fill('日輪 / Solar ring');await page.locator('#name-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.shape-name')?.textContent==='日輪 / Solar ring');await page.locator('[data-action=use-shape]').click();
  await page.locator('[data-target=layer][data-key=motifTint]').check();
  await page.locator('input[type=text][data-key=color]').fill('#ff0066');await page.locator('input[type=text][data-key=color]').press('Tab');
  const tintedSvg=(await exported('svg')).toString();assert.match(tintedSvg,/mask-type="alpha"/);assert.equal(tintedSvg.split(data).length-1,1,'tint still embeds the image once');
  const tintedRaster=PNG.sync.read(await exported('png'));let tintedPixels=0;for(let i=0;i<tintedRaster.data.length;i+=4)if(tintedRaster.data[i+3]>200){assert.ok(tintedRaster.data[i]>245&&tintedRaster.data[i+1]<8&&Math.abs(tintedRaster.data[i+2]-102)<8,'opaque tint pixels use the primary color');tintedPixels++;}assert.ok(tintedPixels>100);
  const tintProject=await save();await page.locator('#file-project').setInputFiles({name:'Tint.ctm',mimeType:'application/json',buffer:tintProject});await page.waitForTimeout(70);assert.equal(await page.locator('[data-key=motifTint]').isChecked(),true);await page.locator('[data-key=motifTint]').uncheck();
  const pixels=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [[0,0],[32,32],[32,12]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);},data);
  assert.equal(pixels[0][3],0,'clip must preserve transparent corners');assert.equal(pixels[1][3],0,'mask must keep the hole transparent');assert.ok(pixels[2][0]>200&&pixels[2][2]<30&&pixels[2][3]>200,'inline style gradient must survive import');
  for(const type of ['halftone','polygons','symbols','dots']){
   await page.locator(`[data-pattern=${type}]`).click();await page.locator('[data-action=shape-library]').click();await page.locator('[data-action=use-shape]').click();await page.waitForTimeout(40);assert.ok(await page.locator('#artboard image').count()>0,`${type} should use shared SVG`);
  }
  const saved=JSON.parse((await save()).toString());assert.equal(saved.layers[0].customMotif,data);
  const svg=(await exported('svg')).toString();assert.match(svg,/<image /);assert.ok(svg.includes(data));const png=await exported('png');assert.equal(png.subarray(1,4).toString(),'PNG');
  const raster=PNG.sync.read(png);let colored=0,transparent=0;for(let i=0;i<raster.data.length;i+=4){if(raster.data[i+3]===0)transparent++;if(raster.data[i]>180&&raster.data[i+2]<60&&raster.data[i+3]>80)colored++;}assert.ok(colored>100&&transparent>10000,'nested SVG shapes must really appear with colors and transparency in the exported PNG');
  await page.waitForTimeout(450);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');await page.locator('[data-action=shape-library]').click();assert.equal(await page.locator('[data-action=use-shape]').count(),1,'library persists across reload');
  assert.equal(await page.locator('.shape-name').textContent(),'日輪 / Solar ring','renamed shared shape persists across reload');
  await page.locator('[data-action=remove-shape]').click();await page.waitForFunction(()=>!document.querySelector('[data-action=use-shape]'));await page.locator('dialog .modal-close').click();assert.ok(await page.locator('#artboard image').count()>0,'removing library asset preserves embedded project shape');
  await page.locator('#p-shape').selectOption('heart');await page.waitForFunction(()=>!document.querySelector('#artboard image'));assert.equal(await page.locator('#artboard image').count(),0,'builtin shape clears custom selection');
  await page.locator('[data-action=shape-library]').click();await page.locator('#file-image').setInputFiles({name:'Exported dots.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelector('#artboard image')?.getAttribute('href')?.startsWith('data:image/png'));
  assert.equal(JSON.parse((await save()).toString()).layers[0].customMotif.startsWith('data:image/png'),true);
  console.log('PASS SVG colors/gradient/clip/mask, all shared families, library persistence/removal, project and SVG/PNG export');

  await load('grid');assert.equal(await page.locator('[data-parameter-group]').count(),4);assert.equal(await page.locator('#p-diagonalStyle').isDisabled(),true);assert.equal(await field('dashLength').isDisabled(),true);
  await change('diagonals',2);assert.equal(await page.locator('#p-diagonalStyle').isDisabled(),false);await page.locator('#p-diagonalStyle').selectOption('dashed');await change('diagonalDashLength',17);await change('diagonalDashGap',6);
  const getPaths=()=>page.locator('#artboard path[stroke]').evaluateAll(nodes=>nodes.filter(n=>n.closest('svg')?.id!=='none').map(n=>({stroke:n.getAttribute('stroke'),dash:n.getAttribute('stroke-dasharray')})));
  let paths=await getPaths();assert.ok(paths.some(p=>p.stroke==='#787878'&&p.dash==='17 6'));assert.ok(paths.some(p=>p.stroke==='#252525'&&!p.dash));
  await page.locator('#p-lineStyle').selectOption('dashed');await change('dashLength',3);await change('dashGap',9);paths=await getPaths();assert.ok(paths.some(p=>p.stroke==='#787878'&&p.dash==='17 6'));assert.ok(paths.some(p=>p.stroke==='#252525'&&p.dash==='3 9'));
  await page.locator('[data-target=doc][data-key=seamless]').check();await page.waitForTimeout(60);paths=await getPaths();assert.ok(paths.some(p=>p.stroke==='#787878'&&p.dash==='17 6'));assert.ok(paths.some(p=>p.stroke==='#252525'&&p.dash==='3 9'));
  assert.equal(await page.locator('#p-junction option[value=plus]').count(),0);
  for(const [language,title] of [['en','Base grid'],['ja','基本グリッド'],['zh','主格線']]){await page.locator('[data-action=language]').selectOption(language);assert.equal(await page.locator('[data-parameter-group=mainGrid] h2').textContent(),title);}
  console.log('PASS independent grid/diagonal dashes, grouping, controls and three languages');
  // Exercise the desktop header layout without launching a native window.
  {
   const desktopContext=await browser.newContext({viewport:{width:1440,height:960}});
   await desktopContext.addInitScript(()=>{
    localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false}));
    Object.defineProperty(window.chrome,'webview',{value:{postMessage(){},addEventListener(){}}});
   });
   const desktopPage=await desktopContext.newPage();desktopPage.on('pageerror',error=>errors.push(error.message));
   await desktopPage.goto(url);await desktopPage.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
   for(const width of [960,1080,1180,1280,1440,1600,1920,2560]){
    await desktopPage.setViewportSize({width,height:960});
    const layout=await desktopPage.evaluate(()=>{
     const box=s=>document.querySelector(s).getBoundingClientRect();
     const project=box('.document-name'),stage=box('.stage'),title=box('.art-title'),icon=box('.document-name svg'),brandEnd=box('.brand small');
     const language=box('.language-select'),help=box('[data-action=help]'),controls=box('.window-controls');
     return{projectWidth:project.width,projectLeft:project.left,stageLeft:stage.left,titleLeft:title.left,iconLeft:icon.left,brandRight:brandEnd.right,languageRight:language.right,helpLeft:help.left,controlsRight:controls.right,viewport:innerWidth};
    });
    if(width>1180){
     assert.ok(Math.abs(layout.projectLeft-layout.stageLeft)<1,`${width}: project area aligns with canvas column`);
     assert.ok(Math.abs(layout.iconLeft-layout.titleLeft)<1,`${width}: project icon aligns with canvas header inset`);
     assert.ok(layout.brandRight<layout.projectLeft-4,`${width}: brand and project name do not overlap`);
    }else assert.equal(layout.projectWidth,0,'compact desktop header hides the project name');
    assert.ok(layout.languageRight+4<=layout.helpLeft,`${width}: language and help have separate space`);
    assert.ok(layout.controlsRight<=layout.viewport,`${width}: window controls stay inside the viewport`);
   }
   await desktopPage.setViewportSize({width:1440,height:960});
   for(const theme of ['dark','light']){
    if(theme==='light')await desktopPage.locator('[data-action=theme]').click();
    await fs.mkdir(path.join(root,'.tools','validation-1.4.1'),{recursive:true});
    await desktopPage.screenshot({path:path.join(root,'.tools','validation-1.4.1',`aligned-header-${theme}.png`),fullPage:true});
   }
   await desktopContext.close();
   console.log('PASS desktop project/header column alignment and toolbar spacing at eight widths');
  }
  assert.deepEqual(errors,[],'app must not emit unhandled browser errors');
  console.log('PASS editor browser integration');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
