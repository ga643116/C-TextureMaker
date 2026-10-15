/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Pixel regression flows run in a fresh headless Edge context, never on the desktop.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');

function makeFixture(){
 const png=new PNG({width:640,height:320});
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
  const offset=(y*png.width+x)*4;
  png.data[offset]=(x*11+y*5+Math.floor(x/32)%7*19)%256;
  png.data[offset+1]=(x*3+y*13+Math.floor(y/32)%5*27)%256;
  png.data[offset+2]=(x*7+y*17+Math.floor(x/32)%3*41)%256;
  png.data[offset+3]=(x<112&&y<80)||((Math.floor(x/16)+Math.floor(y/16))%23===0)?0:255;
 }
 return PNG.sync.write(png);
}
function uniqueOpaqueColors(pixels){
 const colors=new Set();
 for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset+3])colors.add(pixels[offset]+','+pixels[offset+1]+','+pixels[offset+2]);
 return colors;
}
function inspectPNG(bytes){
 const png=PNG.sync.read(bytes),colors=new Set(),alphas=new Set();
 for(let offset=0;offset<png.data.length;offset+=4){
  const alpha=png.data[offset+3];alphas.add(alpha);
  if(alpha)colors.add(png.data[offset]+','+png.data[offset+1]+','+png.data[offset+2]);
 }
 return {png,colors,alphas:[...alphas].sort((a,b)=>a-b)};
}
function assertPixelLimit(image,count,label){
 assert.ok(image.colors.size<=count,label+' has '+image.colors.size+' opaque RGB colors, over '+count);
 assert.ok(image.alphas.every(alpha=>alpha===0||alpha===255),label+' has non-binary alpha: '+image.alphas.join(','));
}
function assertNearestNeighbor(png,gridWidth,gridHeight,label){
 assert.equal(png.width%gridWidth,0,label+' width is not an integer multiple of the pixel grid');
 assert.equal(png.height%gridHeight,0,label+' height is not an integer multiple of the pixel grid');
 const scaleX=png.width/gridWidth,scaleY=png.height/gridHeight;
 for(let gy=0;gy<gridHeight;gy++)for(let gx=0;gx<gridWidth;gx++){
  const x0=gx*scaleX,y0=gy*scaleY,first=(y0*png.width+x0)*4;
  const r=png.data[first],g=png.data[first+1],b=png.data[first+2],a=png.data[first+3];
  for(let dy=0;dy<scaleY;dy++)for(let dx=0;dx<scaleX;dx++){
   const offset=((y0+dy)*png.width+x0+dx)*4;
   if(png.data[offset]!==r||png.data[offset+1]!==g||png.data[offset+2]!==b||png.data[offset+3]!==a)
    assert.fail(label+' contains interpolated pixels inside a nearest-neighbor cell');
  }
 }
}
function rgbKeyFromHex(hex){
 return parseInt(hex.slice(1,3),16)+','+parseInt(hex.slice(3,5),16)+','+parseInt(hex.slice(5,7),16);
}
function getLayer(project,type){
 const layer=project.layers.find(item=>item.type===type);
 assert.ok(layer,'saved project contains '+type+' layer');
 return layer;
}
function mostUsedPaletteIndex(data){
 assert.ok(Array.isArray(data.palette),'getPixelData returns a palette array');
 assert.equal(data.indices.length,data.width*data.height,'indices cover the pixel grid');
 const counts=new Array(data.palette.length).fill(0);
 for(const index of data.indices)if(index>=0&&index<counts.length)counts[index]++;
 let selected=0;
 for(let index=1;index<counts.length;index++)if(counts[index]>counts[selected])selected=index;
 assert.ok(counts[selected]>0,'at least one palette color is used');
 return selected;
}

(async()=>{
 const engine=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 assert.ok(engine.PATTERNS.some(pattern=>pattern.id==='pixel'),'pixel pattern is registered');
 assert.equal(typeof engine.getPixelGrid,'function');
 assert.equal(typeof engine.getPixelData,'function');
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
  const url='http://127.0.0.1:'+server.address().port+'/app/index.html';
  await page.goto(url);
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');

  const download=async action=>{
   const pending=page.waitForEvent('download');
   await action();
   const item=await pending;
   const file=await item.path();
   assert.ok(file,'headless browser completed the download');
   return fs.readFile(file);
  };
  const save=async()=>JSON.parse((await download(()=>page.locator('[data-action=save]').click())).toString('utf8'));
  const load=async project=>{
   const wasDirty=await page.locator('html').getAttribute('data-project-dirty')==='true';
   await page.locator('#file-project').setInputFiles({name:'pixel.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   if(wasDirty){
    await page.locator('#unsaved-discard').waitFor({state:'visible',timeout:10000});
    await page.locator('#unsaved-discard').click();
   }
   const pixel=project.layers.find(layer=>layer.type==='pixel');
   if(pixel){
    await page.waitForFunction(expected=>Number(document.querySelector('#inspector input[type=number][data-key="pixelCount"]')?.value)===expected.pixelCount&&Number(document.querySelector('#inspector input[type=number][data-key="colorCount"]')?.value)===expected.colorCount&&document.querySelector('#pixel-palette-mode')?.value===expected.paletteMode,{pixelCount:pixel.params.pixelCount,colorCount:pixel.params.colorCount,paletteMode:pixel.params.paletteMode},{timeout:10000});
   }else{
    const firstPattern=project.layers.find(layer=>layer.type!=='imageMask')?.type;
    await page.waitForFunction(expected=>document.querySelector('[data-pattern="'+expected+'"]')?.getAttribute('aria-pressed')==='true',firstPattern,{timeout:10000});
   }
   return wasDirty;
  };
  const range=key=>page.locator('#inspector input[type=range][data-target="params"][data-key="'+key+'"]');
  const numeric=key=>page.locator('#inspector input[type=number][data-target="params"][data-key="'+key+'"]');
  const waitGrid=async(expected)=>page.waitForFunction(value=>document.querySelector('#pixel-grid-size')?.textContent.trim()===value,expected,{timeout:10000});
  const setRangeByKeyboard=async(key,value)=>{
   const slider=range(key),min=Number(await slider.getAttribute('min')),max=Number(await slider.getAttribute('max'));
   await slider.focus();
   if(value===min)await slider.press('Home');
   else if(value===max)await slider.press('End');
   else{
    await slider.press('Home');
    for(let step=min;step<value;step++)await slider.press('ArrowRight');
   }
   await slider.press('Tab');
   assert.equal(Number(await numeric(key).inputValue()),value,key+' number input follows the real slider interaction');
  };
  const setColorCount=async value=>{
   await page.locator('[data-action="pixel-count"][data-count="'+value+'"]').click();
   await page.waitForFunction(expected=>Number(document.querySelector('#inspector input[type=number][data-key="colorCount"]')?.value)===expected,value);
  };
  const setPaletteMode=async value=>{
   await page.locator('#pixel-palette-mode').selectOption(value);
   await page.waitForFunction(expected=>document.querySelector('#pixel-palette-mode')?.value===expected,value);
  };
  const setOutput=async value=>{
   await page.locator('[data-action="pixel-output"][data-mode="'+value+'"]').click();
   await page.waitForFunction(expected=>document.querySelector('[data-action="pixel-output"][data-mode="'+expected+'"]')?.getAttribute('aria-pressed')==='true',value);
  };
  const exportAsset=async(format,options={})=>{
   await page.locator('[data-action="export"]').click();
   const dialog=page.locator('#dialog-root dialog[open]');
   await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-format="'+format+'"]').click();
   const alpha=dialog.locator('#export-alpha');
   if(typeof options.transparent==='boolean'&&await alpha.isChecked()!==options.transparent){
    if(options.transparent)await alpha.check();else await alpha.uncheck();
   }
   const scale=dialog.locator('#export-scale');
   if(options.scale)await scale.selectOption(String(options.scale));
   const size=(await dialog.locator('#export-size').textContent()).trim();
   const scaleDisabled=await scale.isDisabled();
   const bytes=await download(()=>dialog.locator('#do-export').click());
   await dialog.waitFor({state:'detached'});
   return {bytes,size,scaleDisabled};
  };
  const imageFixture=makeFixture();
  const fixturePixels=PNG.sync.read(imageFixture);
  assert.ok(uniqueOpaqueColors(fixturePixels.data).size>256,'generated fixture has more than 256 opaque source colors');
  assert.ok(Math.max(fixturePixels.width,fixturePixels.height)>=512,'generated PNG source is at least 512 pixels wide or tall');

  const project=engine.createDocument();
  project.width=512;project.height=256;project.transparent=false;
  project.layers=[engine.createLayer('dots','pixel-source')];
  await load(project);
  await page.locator('[data-pattern="pixel"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pattern="pixel"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await range('pixelCount').count(),1,'Pixel inspector exposes a range slider for density');
  assert.equal(await numeric('pixelCount').count(),1,'Pixel inspector exposes a numeric density input');
  assert.equal(await range('pixelCount').getAttribute('min'),'4');
  assert.equal(await range('pixelCount').getAttribute('max'),'512');
  assert.equal(await range('colorCount').getAttribute('min'),'2');
  assert.equal(await range('colorCount').getAttribute('max'),'256');

  await setRangeByKeyboard('pixelCount',4);
  await waitGrid('4 × 2');
  await setRangeByKeyboard('pixelCount',512);
  await waitGrid('512 × 256');
  await setRangeByKeyboard('pixelCount',64);
  await waitGrid('64 × 32');
  await setRangeByKeyboard('pixelCount',32);
  await waitGrid('32 × 16');
  await setRangeByKeyboard('pixelCount',64);
  await waitGrid('64 × 32');
  assert.equal((await page.locator('#pixel-output-size').textContent()).trim(),'512 × 256 px');

  const blankProject=await save(),blankPixel=getLayer(blankProject,'pixel');
  assert.deepEqual(engine.getPixelGrid(blankProject,blankPixel),{width:64,height:32});
  const blankData=engine.getPixelData(blankProject,blankPixel);
  assert.equal(blankData.width,64);
  assert.equal(blankData.height,32);
  assert.equal(blankData.indices.length,64*32);
  assert.equal(blankData.pixels.length,64*32*4);
  assert.ok(blankData.palette.length<=blankPixel.params.colorCount);
  for(const count of [2,8,256]){
   await setColorCount(count);
   const output=await exportAsset('png',{transparent:false});
   const image=inspectPNG(output.bytes);
   assert.equal(output.size.replace(/\s/g,''),'512×256','opaque Pixel PNG export uses the canvas dimensions');
   assertPixelLimit(image,count,'opaque no-source PNG at '+count+' colors');
   assert.deepEqual(image.alphas,[255],'default opaque document has no mask or transparent pixels');
  }
  console.log('PASS Pixel slider bounds and live grid, helper API, color-count limits and opaque no-source PNGs');

  await page.locator('[data-action="add-color-image"]').click();
  await page.locator('#file-image-mask').setInputFiles({name:'pixel-fixture.png',mimeType:'image/png',buffer:imageFixture});
  await page.waitForFunction(()=>document.querySelector('#layer-list .image-mask-layer')!==null,{},{timeout:20000});
  await page.locator('[data-pattern="pixel"]').click();
  await page.waitForFunction(()=>document.querySelector('#inspector #pixel-palette-mode')!==null,{},{timeout:10000});
  assert.equal(await page.locator('#pixel-palette-mode').inputValue(),'auto');
  assert.equal(await page.locator('#pixel-palette input[type=color][data-pixel-color]').count()>0,true);
  await setRangeByKeyboard('pixelCount',64);
  await waitGrid('64 × 32');

  await fs.mkdir(path.join(root,'.tools','validation-pixel'),{recursive:true});
  const darkBackground=await page.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor);
  await page.screenshot({path:path.join(root,'.tools','validation-pixel','pixel-dark.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();
  const lightBackground=await page.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor);
  assert.notEqual(lightBackground,darkBackground,'dark and light themes render distinct surfaces');
  await page.screenshot({path:path.join(root,'.tools','validation-pixel','pixel-light.png'),fullPage:true});
  await page.locator('[data-action="theme"]').click();

  const importedProject=await save();
  const importedPixel=getLayer(importedProject,'pixel');
  const importedImage=importedProject.layers.find(layer=>layer.type==='imageMask'&&layer.mode==='color');
  assert.ok(importedImage,'Pixel image import creates a color source layer');
  assert.deepEqual([importedImage.imageWidth,importedImage.imageHeight],[640,320],'original PNG dimensions are preserved');
  assert.ok(Math.max(importedImage.colorMap.width,importedImage.colorMap.height)>256,'source color map keeps resolution above 256 pixels');
  const sourceMap=Buffer.from(importedImage.colorMap.rgba,'base64');
  assert.ok(uniqueOpaqueColors(sourceMap).size>256,'saved source color map retains more than 256 opaque RGB colors');
  assert.equal(importedPixel.params.pixelCount,64);

  await setOutput('grid');
  assert.equal((await page.locator('#pixel-output-size').textContent()).trim(),'64 × 32 px');
  for(const count of [2,8,256]){
   await setColorCount(count);
   const output=await exportAsset('png',{transparent:true});
   const image=inspectPNG(output.bytes);
   assert.equal(output.size.replace(/\s/g,''),'64×32','native grid PNG uses the pixel grid dimensions');
   assert.ok(output.scaleDisabled,'native grid PNG disables the resolution multiplier');
   assert.deepEqual([image.png.width,image.png.height],[64,32]);
   assertPixelLimit(image,count,'transparent imported PNG at '+count+' colors');
   assert.deepEqual(image.alphas,[0,255],'transparent source produces binary transparent and opaque pixels');
  }
  await setColorCount(8);
  await setPaletteMode('auto');
  const autoOutput=inspectPNG((await exportAsset('png',{transparent:true})).bytes);
  assertPixelLimit(autoOutput,8,'auto palette output');
  assert.deepEqual(autoOutput.alphas,[0,255]);

  const apiProject=await save(),apiPixel=getLayer(apiProject,'pixel');
  const pixelGrid=engine.getPixelGrid(apiProject,apiPixel);
  const pixelData=engine.getPixelData(apiProject,apiPixel);
  assert.deepEqual(pixelGrid,{width:64,height:32});
  assert.equal(pixelData.width,pixelGrid.width);
  assert.equal(pixelData.height,pixelGrid.height);
  assert.ok(Array.isArray(pixelData.palette));
  assert.ok(pixelData.palette.length<=8);
  assert.equal(pixelData.indices.length,pixelGrid.width*pixelGrid.height);
  assert.equal(pixelData.pixels.length,pixelGrid.width*pixelGrid.height*4);
  const alphaValues=new Set();
  for(let offset=3;offset<pixelData.pixels.length;offset+=4)alphaValues.add(pixelData.pixels[offset]);
  assert.deepEqual([...alphaValues].sort((a,b)=>a-b),[0,255],'Pixel API data keeps source alpha binary');

  await setPaletteMode('grayscale');
  const grayscale=inspectPNG((await exportAsset('png',{transparent:true})).bytes);
  assertPixelLimit(grayscale,8,'grayscale palette output');
  assert.ok([...grayscale.colors].every(color=>{const rgb=color.split(',').map(Number);return rgb[0]===rgb[1]&&rgb[1]===rgb[2]}),'grayscale palette exports only gray RGB values');
  await setPaletteMode('retro');
  const retro=inspectPNG((await exportAsset('png',{transparent:true})).bytes);
  assertPixelLimit(retro,8,'retro palette output');
  await setPaletteMode('auto');
  const beforeCustom=inspectPNG((await exportAsset('png',{transparent:true})).bytes);
  const replacement=['#ff00ff','#00ff7f','#ff8000','#00bfff','#e600ff'].find(color=>!beforeCustom.colors.has(rgbKeyFromHex(color)));
  assert.ok(replacement,'test fixture leaves a distinct custom palette color available');

  await setPaletteMode('custom');
  const customProject=await save(),customPixel=getLayer(customProject,'pixel');
  const customData=engine.getPixelData(customProject,customPixel),paletteIndex=mostUsedPaletteIndex(customData);
  const swatch=page.locator('#pixel-palette input[type=color][data-pixel-color="'+paletteIndex+'"]');
  await swatch.waitFor({state:'visible'});
  await swatch.evaluate((element,color)=>{
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
   setter.call(element,color);
   element.dispatchEvent(new Event('input',{bubbles:true}));
   element.dispatchEvent(new Event('change',{bubbles:true}));
  },replacement);
  await page.waitForFunction(()=>document.querySelector('#pixel-palette-mode')?.value==='custom');
  assert.equal((await swatch.inputValue()).toLowerCase(),replacement);
  const customImage=inspectPNG((await exportAsset('png',{transparent:true})).bytes);
  assertPixelLimit(customImage,8,'custom palette output');
  assert.ok(customImage.colors.has(rgbKeyFromHex(replacement)),'editing a palette swatch changes exported PNG pixels');
  assert.deepEqual(customImage.alphas,[0,255]);

  const localeLabels=[];
  for(const locale of ['zh','en','ja']){
   await page.locator('.language-select').selectOption(locale);
   await page.waitForFunction(expected=>document.querySelector('.language-select')?.value===expected,locale);
   localeLabels.push(await page.locator('#inspector input[type=range][data-key="pixelCount"]').getAttribute('aria-label'));
   assert.equal(await page.locator('#pixel-palette-mode option[value="custom"]').count(),1);
  }
  assert.equal(new Set(localeLabels).size,3,'Pixel controls are localized in Chinese, English and Japanese');
  await page.locator('.language-select').selectOption('zh');
  await page.waitForFunction(()=>document.querySelector('.language-select')?.value==='zh');

  const gridPNG=await exportAsset('png',{transparent:true});
  const gridImage=inspectPNG(gridPNG.bytes);
  assert.equal(gridPNG.size.replace(/\s/g,''),'64×32');
  assert.ok(gridPNG.scaleDisabled);
  assert.deepEqual([gridImage.png.width,gridImage.png.height],[64,32]);
  assertPixelLimit(gridImage,8,'native grid PNG after custom palette edit');
  const gridSVG=await exportAsset('svg',{transparent:true});
  const svgText=gridSVG.bytes.toString('utf8'),svgTag=svgText.match(/<svg\b[^>]*>/)?.[0];
  assert.ok(svgTag,'native grid SVG has an SVG root');
  const svgAttribute=name=>new RegExp('\\b'+name+'="([^"]*)"').exec(svgTag)?.[1];
  assert.equal(gridSVG.size.replace(/\s/g,''),'64×32');
  assert.equal(svgAttribute('width'),'64','native SVG outer width follows the pixel grid');
  assert.equal(svgAttribute('height'),'32','native SVG outer height follows the pixel grid');
  assert.equal(svgAttribute('viewBox'),'0 0 512 256','native SVG retains the source canvas viewBox');

  await setOutput('canvas');
  assert.equal((await page.locator('#pixel-output-size').textContent()).trim(),'512 × 256 px');
  const canvasPNG=await exportAsset('png',{transparent:true,scale:2});
  const canvasImage=inspectPNG(canvasPNG.bytes);
  assert.equal(canvasPNG.size.replace(/\s/g,''),'1024×512','2× canvas PNG uses document dimensions and multiplier');
  assert.equal(canvasPNG.scaleDisabled,false,'canvas PNG keeps the resolution multiplier enabled');
  assert.deepEqual([canvasImage.png.width,canvasImage.png.height],[1024,512]);
  assertPixelLimit(canvasImage,8,'2x canvas PNG after custom palette edit');
  assertNearestNeighbor(canvasImage.png,64,32,'2x canvas PNG');
  assert.deepEqual(canvasImage.alphas,[0,255]);

  const projectToReload=await save(),savedPixel=getLayer(projectToReload,'pixel');
  assert.equal(savedPixel.params.pixelCount,64);
  assert.equal(savedPixel.params.colorCount,8);
  assert.equal(savedPixel.params.paletteMode,'custom');
  assert.equal(savedPixel.params.outputSize,'canvas');
  assert.ok(savedPixel.pixelPalette.includes(replacement));
  assert.deepEqual([getLayer(projectToReload,'imageMask').imageWidth,getLayer(projectToReload,'imageMask').imageHeight],[640,320]);
  await setOutput('grid');
  await setColorCount(2);
  assert.equal(await load(projectToReload),true,'loading over edits presents and uses the unsaved-changes discard guard');
  assert.equal((await page.locator('#pixel-grid-size').textContent()).trim(),'64 × 32');
  assert.equal(await page.locator('#pixel-palette-mode').inputValue(),'custom');
  assert.equal(Number(await numeric('colorCount').inputValue()),8);
  await page.locator('[data-pattern="dots"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pattern="dots"]')?.getAttribute('aria-pressed')==='true');
  await page.locator('[data-pattern="pixel"]').click();
  await page.waitForFunction(()=>document.querySelector('#pixel-palette-mode')?.value==='custom');
  const preserved=await save(),preservedPixel=getLayer(preserved,'pixel');
  assert.equal(preservedPixel.params.pixelCount,64);
  assert.equal(preservedPixel.params.colorCount,8);
  assert.equal(preservedPixel.params.paletteMode,'custom');
  assert.equal(preservedPixel.params.outputSize,'canvas');
  assert.ok(preservedPixel.pixelPalette.includes(replacement),'switching away from and back to Pixel preserves its custom palette');
  assert.deepEqual([getLayer(preserved,'imageMask').imageWidth,getLayer(preserved,'imageMask').imageHeight],[640,320]);

  assert.deepEqual(errors,[]);
  console.log('PASS Pixel import, >256-color source preservation, binary transparency, palette modes, custom swatches, native/canvas exports, nearest-neighbor scaling, save/load and pattern switching');
  console.log('Screenshots:',path.join(root,'.tools','validation-pixel','pixel-dark.png'),'and',path.join(root,'.tools','validation-pixel','pixel-light.png'));
  await context.close();
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
