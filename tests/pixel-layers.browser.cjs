/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Pixel source/layer regressions run in a fresh headless Edge context only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.tools','validation-pixel-layers');

function solidImageLayer(engine,encodeColorMap,id,name,color,offsetX){
 const width=32,height=47,png=new PNG({width,height}),rgba=new Uint8ClampedArray(width*height*4);
 const rgb=color.match(/[0-9a-f]{2}/gi).map(value=>parseInt(value,16));
 for(let offset=0;offset<rgba.length;offset+=4)rgba.set([...rgb,255],offset);
 png.data.set(rgba);
 return Object.assign(engine.createImageMaskLayer({
  id,name,image:'data:image/png;base64,'+PNG.sync.write(png).toString('base64'),
  imageWidth:width,imageHeight:height,mode:'color',colorMap:encodeColorMap({width,height,data:rgba}),
 }),{offsetX});
}
function pixelAt(png,x,y){const offset=(y*png.width+x)*4;return [...png.data.slice(offset,offset+4)];}
function changedPixels(a,b){
 assert.deepEqual([a.width,a.height],[b.width,b.height],'composite exports have matching dimensions');
 let changed=0;for(let offset=0;offset<a.data.length;offset+=4)if(a.data[offset]!==b.data[offset]||a.data[offset+1]!==b.data[offset+1]||a.data[offset+2]!==b.data[offset+2]||a.data[offset+3]!==b.data[offset+3])changed++;
 return changed;
}
function makeFixture(engine,encodeColorMap){
 const doc=engine.createDocument();Object.assign(doc,{name:'Pixel source fixture',width:640,height:935,transparent:true});
 const pixel=engine.createLayer('pixel','pixel-main');pixel.imageSource='all';
 const red=solidImageLayer(engine,encodeColorMap,'source-red','Synthetic red','#ff0000',-160);
 const green=solidImageLayer(engine,encodeColorMap,'source-green','Synthetic green','#00ff00',160);
 doc.layers=[pixel,red,green];
 return {doc,pixelId:pixel.id,redId:red.id,greenId:green.id};
}
function pixelDocument(engine,encodeColorMap){
 const {doc}=makeFixture(engine,encodeColorMap);
 return JSON.parse(JSON.stringify(doc));
}

(async()=>{
 const engine=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const {encodeColorMap}=await import(pathToFileURL(path.join(root,'app/image-color.mjs')));
 const initial=makeFixture(engine,encodeColorMap);
 assert.equal(initial.doc.layers[0].imageSource,'all','new pattern layers default to all image sources');
 const engineBundle=require('esbuild').buildSync({entryPoints:[path.join(root,'app/engine.mjs')],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].contents;
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{
  try{
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep))throw Error('outside');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
   res.end(file===path.join(root,'app/engine.mjs')?engineBundle:await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false})));
  const page=await context.newPage(),errors=[];
  page.on('dialog',dialog=>dialog.accept());
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/index.html');
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await fs.mkdir(output,{recursive:true});

  const isDirty=()=>page.locator('html').getAttribute('data-project-dirty');
  const load=async(project,name='pixel-layers.ctm')=>{
   const wasDirty=await isDirty()==='true';
   await page.locator('#file-project').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   if(wasDirty){await page.locator('#unsaved-discard').waitFor({state:'visible',timeout:10000});await page.locator('#unsaved-discard').click();}
   const pixel=project.layers.find(layer=>layer.type==='pixel');
   assert.ok(pixel,'project fixture has a Pixel layer');
   await page.waitForFunction(({name,id,source,params})=>{
    const selected=document.querySelector('#layer-list .layer.selected [data-action="select-layer"]');
    const sourceButton=document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]');
    const sourceMode=['all','none'].includes(source)?source:'below';
    if(document.querySelector('.document-name span')?.textContent!==name||selected?.dataset.id!==id||sourceButton?.dataset.mode!==sourceMode||document.querySelector('[data-pattern="pixel"]')?.getAttribute('aria-pressed')!=='true')return false;
    return Object.entries(params).every(([key,value])=>{
     const control=document.querySelector('#inspector [data-target="params"][data-key="'+key+'"]');
     return !control||String(control.value)===String(value);
    });
   },{name:project.name,id:pixel.id,source:pixel.imageSource??'auto',params:pixel.params??{}},{timeout:10000});
  };
  const save=async()=>{
   const pending=page.waitForEvent('download');
   await page.locator('[data-action="save"]').click();
   const item=await pending,file=await item.path();
   assert.ok(file,'headless browser completed the project download');
   return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const ensureSection=async(section)=>{
   const details=page.locator('#inspector details[data-section="'+section+'"]');
   await details.waitFor({state:'attached'});
   if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
   return details;
  };
  const number=key=>page.locator('#inspector input[type="number"][data-key="'+key+'"]');
  const setNumber=async(key,value)=>{
   let field=number(key);await field.waitFor({state:'attached'});
   const section=await field.evaluate(element=>element.closest('details')?.dataset.section);
   if(section){await ensureSection(section);field=number(key);}
   await field.fill(String(value));await field.press('Tab');
   await page.waitForFunction(({key,expected})=>Number(document.querySelector('#inspector input[type="number"][data-key="'+key+'"]')?.value)===expected,{key,expected:Number(value)},{timeout:10000});
  };
  const setParam=async(key,value)=>{
   let field=page.locator('#inspector [data-target="params"][data-key="'+key+'"]');
   const section=await field.evaluate(element=>element.closest('details')?.dataset.section);
   if(section){await ensureSection(section);field=page.locator('#inspector [data-target="params"][data-key="'+key+'"]');}
   await field.selectOption(String(value));
   await page.waitForFunction(({key,expected})=>document.querySelector('#inspector [data-target="params"][data-key="'+key+'"]')?.value===expected,{key,expected:String(value)},{timeout:10000});
  };
  const sourceButton=mode=>page.locator('#inspector [data-action="image-source"][data-mode="'+mode+'"]');
  const activeSourceMode=()=>page.locator('#inspector [data-action="image-source"][aria-pressed="true"]').getAttribute('data-mode');
  const setSource=async(mode)=>{
   assert.ok(['all','below','none'].includes(mode),'source mode is available from the layer toolbar');
   await ensureSection('image-source');
   await sourceButton(mode).click();
   await page.waitForFunction(expected=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode===expected,mode,{timeout:10000});
  };
  const selectLayer=async(id)=>{
   await page.locator('#layer-list [data-action="select-layer"][data-id="'+id+'"]').click();
   await page.waitForFunction(expected=>document.querySelector('#layer-list .layer.selected [data-action="select-layer"]')?.dataset.id===expected,id,{timeout:10000});
  };
  const setOpacity=async(value)=>setNumber('opacity',value);
  const exportPNG=async({transparent=true,saveAs}={})=>{
   await page.locator('[data-action="export"]').click();
   const dialog=page.locator('#dialog-root dialog[open]');await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-format="png"]').click();
   const alpha=dialog.locator('#export-alpha');if(await alpha.isChecked()!==transparent){if(transparent)await alpha.check();else await alpha.uncheck();}
   const pending=page.waitForEvent('download');await dialog.locator('#do-export').click();
   const item=await pending,file=await item.path();await dialog.waitFor({state:'detached'});
   const bytes=await fs.readFile(file);if(saveAs)await fs.writeFile(saveAs,bytes);
   return PNG.sync.read(bytes);
  };
  const sourceImageCount=async(image)=>page.locator('#artboard svg image').evaluateAll((nodes,expected)=>nodes.filter(node=>node.getAttribute('href')===expected).length,image);
  const assertNoHorizontalOverflow=async(label)=>{
   const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,inspector:document.querySelector('#inspector').scrollWidth,inspectorClient:document.querySelector('#inspector').clientWidth}));
   assert.ok(sizes.document<=sizes.viewport+1,label+' page has no horizontal overflow: '+JSON.stringify(sizes));
   assert.ok(sizes.inspector<=sizes.inspectorClient+1,label+' inspector has no horizontal overflow: '+JSON.stringify(sizes));
  };

  await load(initial.doc);
  assert.equal(await activeSourceMode(),'all','Pixel source toolbar defaults to all image sources');
  assert.equal(await page.locator('#inspector select[data-key="imageSource"]').count(),0,'image-source dropdown was removed');
  assert.equal(await page.locator('#inspector .image-source-field [data-action="add-layer"]').count(),0,'source panel no longer contains the add-effect button');

  // Pixel dimensions and processing controls use their real inspector fields.
  await setParam('sizeMode','width');
  await setNumber('pixelCount',140);
  await page.waitForFunction(()=>document.querySelector('#pixel-grid-size')?.textContent.trim()==='140 × 205',{},{timeout:10000});
  await setParam('sizeMode','block');
  await setNumber('blockSize',8);
  await page.waitForFunction(()=>document.querySelector('#pixel-grid-size')?.textContent.trim()==='80 × 117',{},{timeout:10000});
  await setParam('sizeMode','longEdge');
  await setNumber('pixelCount',64);
  await setParam('resample','nearest');
  await setParam('resample','bilinear');
  await setParam('resample','average');
  await ensureSection('pixel-processing');
  await setParam('colorDistance','rgb');
  await setParam('colorDistance','oklab');
  await setParam('dither','bayer4');
  await setNumber('ditherStrength',0.65);
  await setParam('dither','floyd-steinberg');
  await setParam('dither','none');
  for(const key of ['brightness','contrast','saturation','alphaThreshold']){
   const field=number(key),min=Number(await field.getAttribute('min')),max=Number(await field.getAttribute('max')),step=Number(await field.getAttribute('step'))||1;
   const midpoint=Math.round((min+(max-min)*0.6)/step)*step;
   await setNumber(key,midpoint);
  }
  await page.screenshot({path:path.join(output,'pixel-advanced-zh.png'),fullPage:true});
  for(const locale of ['en','ja','zh']){
   await page.locator('.language-select').selectOption(locale);
   await page.waitForFunction(expected=>document.querySelector('.language-select')?.value===expected,locale);
   await assertNoHorizontalOverflow('Pixel '+locale);
  }
  console.log('PASS Pixel width/block sizing, resampling, color distance, dithering, image processing and localized inspector layout');

  // Reload clean defaults before source sampling and visibility checks.
  await load(initial.doc,'pixel-sources.ctm');
  const sourceModes=await page.locator('#inspector [data-action="image-source"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mode).sort());
  assert.deepEqual(sourceModes,['all','below','none'],'source toolbar exposes all, below and none');
  await setSource('none');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode==='all');
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode==='none');
  await setSource('all');
  await setParam('sizeMode','width');await setNumber('pixelCount',4);await setNumber('colorCount',2);await setParam('paletteMode','auto');
  await page.locator('[data-action="pixel-output"][data-mode="grid"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="pixel-output"][data-mode="grid"]')?.getAttribute('aria-pressed')==='true');
  const combined=await exportPNG({saveAs:path.join(output,'combined-sources.png')});
  const savedAll=await save();
  await fs.writeFile(path.join(output,'combined-sources.ctm'),JSON.stringify(savedAll,null,2),'utf8');
  const savedPixel=savedAll.layers.find(layer=>layer.id===initial.pixelId);
  const leftSourcePixel=pixelAt(combined,0,0),rightSourcePixel=pixelAt(combined,3,0);
  const alphaHistogram=Array.from(combined.data).filter((_,index)=>index%4===3).reduce((histogram,alpha)=>{histogram[alpha]=(histogram[alpha]||0)+1;return histogram;},{});
  const alphaValues=Object.keys(alphaHistogram).map(Number).sort((a,b)=>a-b);
  const inspection={width:combined.width,height:combined.height,savedPixel:{id:savedPixel.id,imageSource:savedPixel.imageSource,opacity:savedPixel.opacity,params:savedPixel.params},alphaValues,alphaHistogram,samples:{red:leftSourcePixel,green:rightSourcePixel}};
  await fs.writeFile(path.join(output,'combined-sources-inspection.json'),JSON.stringify(inspection,null,2),'utf8');
  assert.deepEqual([combined.width,combined.height],[4,6],'width-mode grid uses width count and canvas aspect ratio');
  assert.equal(savedPixel.imageSource,'all','save preserves source selection');
  assert.equal(savedPixel.opacity,1,'saved Pixel layer keeps full opacity for alpha validation');
  assert.equal(savedPixel.params.sizeMode,'width','save preserves Pixel size mode');
  assert.equal(savedPixel.params.pixelCount,4,'save preserves Pixel width count');
  assert.equal(savedPixel.params.colorCount,2,'save preserves requested palette limit');
  assert.equal(savedPixel.params.alphaThreshold,0.5,'save preserves binary transparency threshold');
  assert.ok(alphaValues.every(alpha=>alpha===0||alpha===255),'binary Pixel grid contains only transparent or fully opaque alpha');
  assert.deepEqual(leftSourcePixel,[255,0,0,255],'left-positioned red source contributes an opaque red cell');
  assert.deepEqual(rightSourcePixel,[0,255,0,255],'right-positioned green source contributes an opaque green cell');
  await setSource('below');
  const savedBelow=await save();
  assert.equal(savedBelow.layers.find(layer=>layer.id===initial.pixelId).imageSource,'below','save preserves the below source mode');
  await setSource('all');
  await load(savedBelow,'pixel-source-roundtrip.ctm');
  assert.equal(await activeSourceMode(),'below','load restores the below source mode');
  await setSource('all');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode==='below');
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector [data-action="image-source"][aria-pressed="true"]')?.dataset.mode==='all');
  console.log('PASS all/none/below source toolbar, undo/redo, save/load and simultaneous image contributions');

  // Color images display their original when no effect consumes them.
  await setSource('none');
  await selectLayer(initial.redId);
  const mode=page.locator('#inspector [data-action="image-mode"][data-id="'+initial.redId+'"]');
  assert.deepEqual(await mode.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),['mask','color']);
  const colorDoc=await save(),colorImage=colorDoc.layers.find(layer=>layer.id===initial.redId).image;
  assert.equal(await sourceImageCount(colorImage),1,'unprocessed color source is visible');
  await page.locator('#layer-list [data-action="visibility"][data-id="'+initial.redId+'"]').click();
  assert.equal(await sourceImageCount(colorImage),0,'hiding an image removes its original');
  await page.locator('#layer-list [data-action="visibility"][data-id="'+initial.redId+'"]').click();
  await selectLayer(initial.pixelId);
  await setSource('all');
  const sharedColors=await save(),colorPixel=sharedColors.layers.find(layer=>layer.id===initial.pixelId);
  assert.equal(await sourceImageCount(colorImage),0,'Pixel output replaces its original source');
  const colorRaster=engine.getPixelData(sharedColors,colorPixel);
  assert.deepEqual([...colorRaster.pixels.slice(0,4)],[255,0,0,255]);
  assert.deepEqual([...colorRaster.pixels.slice(3*4,4*4)],[0,255,0,255]);
  await selectLayer(initial.redId);
  await assertNoHorizontalOverflow('image layer zh');
  await page.screenshot({path:path.join(output,'image-layer-zh.png'),fullPage:true});
  console.log('PASS two image modes, visible originals before processing, effect replacement and visibility toggle');

  // Add a second pattern through the existing library control and share one source.
  await selectLayer(initial.pixelId);
  await setSource('all');
  await page.locator('.library .layer-add-actions [data-action="add-layer"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer:not(.image-mask-layer)').length===2);
  const secondId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  assert.ok(secondId&&secondId!==initial.pixelId,'add-layer creates a distinct pattern layer');
  assert.equal(await activeSourceMode(),'all','new layer carries the current source mode');
  await page.locator('#pattern-list [data-pattern="lowpoly"]').click();
  await page.waitForFunction(()=>document.querySelector('#pattern-list [data-pattern="lowpoly"]')?.getAttribute('aria-pressed')==='true');
  await setSource('all');
  await setOpacity(0.65);
  await selectLayer(initial.pixelId);
  await setSource('all');
  await setParam('paletteMode','grayscale');await setNumber('colorCount',2);await setNumber('pixelCount',32);await setParam('sizeMode','longEdge');await setParam('dither','none');await setOpacity(0.35);
  await ensureSection('pixel-processing');
  await page.screenshot({path:path.join(output,'pixel-advanced-zh.png'),fullPage:true});
  const shared=await save();
  const sharedPixel=shared.layers.find(layer=>layer.id===initial.pixelId),sharedLowPoly=shared.layers.find(layer=>layer.id===secondId);
  assert.equal(sharedPixel.imageSource,'all');assert.equal(sharedLowPoly.imageSource,'all');
  assert.equal(sharedPixel.opacity,0.35);assert.equal(sharedLowPoly.opacity,0.65);
  const patternOrder=shared.layers.filter(layer=>layer.type!=='imageMask').map(layer=>layer.id);
  assert.deepEqual(patternOrder,[initial.pixelId,secondId],'new pattern is composited above the existing pattern');
  if(await page.locator('[data-action="pixel-output"][data-mode="canvas"]').getAttribute('aria-pressed')!=='true')await page.locator('[data-action="pixel-output"][data-mode="canvas"]').click();
  const pixelLayerBefore=await exportPNG();
  await selectLayer(initial.pixelId);
  for(let step=0;step<3;step++)await page.locator('[data-action="layer-up"]').click();
  const reordered=await save();
  const reorderedPatterns=reordered.layers.filter(layer=>layer.type!=='imageMask').map(layer=>layer.id);
  assert.deepEqual(reorderedPatterns,[secondId,initial.pixelId],'layer controls change the rendered pattern order');
  const pixelLayerAfter=await exportPNG();
  assert.ok(changedPixels(pixelLayerBefore,pixelLayerAfter)>0,'changing layer order changes the actual PNG composite');

  const legacy=pixelDocument(engine,encodeColorMap);
  for(const layer of legacy.layers)if(layer.type!=='imageMask')delete layer.imageSource;
  await load(legacy,'pixel-legacy.ctm');
  assert.equal(await activeSourceMode(),'below','legacy automatic sources are represented by the below toolbar state');
  const legacyRoundTrip=await save();
  assert.equal(legacyRoundTrip.layers.find(layer=>layer.id===initial.pixelId).imageSource,'auto','loading and saving a legacy project preserves its original automatic source value');
  const crowded=pixelDocument(engine,encodeColorMap);
  for(let index=0;index<7;index++)crowded.layers.push({...JSON.parse(JSON.stringify(crowded.layers[2])),id:'crowded-'+index,name:'Synthetic image '+index,visible:false});
  await load(crowded,'image-layer-layout.ctm');
  await page.setViewportSize({width:1440,height:720});
  for(const locale of ['zh','en','ja']){
   await page.locator('.language-select').selectOption(locale);
   await selectLayer(initial.redId);
   for(const mode of ['color','mask']){
    await page.locator('#layer-list [data-action="image-mode"]').selectOption(mode);
    const geometry=await page.locator('#layer-list .layer').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();const controls=node.querySelector('.mask-layer-controls')?.getBoundingClientRect();return {top:box.top,bottom:box.bottom,controlsBottom:controls?.bottom};}));
    for(let index=0;index<geometry.length;index++){
     const row=geometry[index];
     if(row.controlsBottom!==undefined)assert.ok(row.controlsBottom<=row.bottom+1,'selected image controls stay inside their row');
     if(index)assert.ok(row.top>=geometry[index-1].bottom-1,'layer rows never overlap');
    }
   }
  }
  await page.locator('.language-select').selectOption('zh');
  await page.locator('#layer-list [data-action="image-mode"]').selectOption('color');
  await page.screenshot({path:path.join(output,'image-layer-compact-zh.png'),fullPage:true});
  console.log('PASS compact layer controls without overlap in three languages and both modes');
  assert.deepEqual(errors,[],'headless browser completed without page errors');
  console.log('PASS two pattern layers share an image source, keep independent opacity, and render in saved layer order');
  console.log('Screenshots:',path.join(output,'image-layer-zh.png'),'and',path.join(output,'pixel-advanced-zh.png'));
  await context.close();
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});