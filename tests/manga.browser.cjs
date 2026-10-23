/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Manga UI and export integration runs against the built app in isolated headless Edge.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
const appRoot=path.join(root,'dist','C-TextureMaker','app');
const output=path.join(root,'.tools','validation-manga');

function makeFixture(){
 const width=320,height=200,png=new PNG({width,height});
 const pixel=(x,y,rgba)=>png.data.set(rgba,(y*width+x)*4);
 const rect=(x0,y0,x1,y1,rgba)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)pixel(x,y,rgba);};
 const ellipse=(cx,cy,rx,ry,rgba)=>{for(let y=Math.max(0,cy-ry);y<Math.min(height,cy+ry);y++)for(let x=Math.max(0,cx-rx);x<Math.min(width,cx+rx);x++){const dx=(x-cx)/rx,dy=(y-cy)/ry;if(dx*dx+dy*dy<=1)pixel(x,y,rgba);}};
 const line=(x0,y0,x1,y1,rgba,thickness=1)=>{
  const dx=x1-x0,dy=y1-y0,steps=Math.max(Math.abs(dx),Math.abs(dy));
  for(let i=0;i<=steps;i++){const x=Math.round(x0+dx*i/Math.max(1,steps)),y=Math.round(y0+dy*i/Math.max(1,steps));for(let oy=-Math.floor(thickness/2);oy<=Math.floor(thickness/2);oy++)for(let ox=-Math.floor(thickness/2);ox<=Math.floor(thickness/2);ox++)if(x+ox>=0&&x+ox<width&&y+oy>=0&&y+oy<height)pixel(x+ox,y+oy,rgba);}
 };
 rect(0,0,width,height,[239,239,239,255]);
 rect(80,0,240,height,[132,132,132,255]);
 rect(240,0,width,height,[24,24,24,255]);
 // Original-color illustration: an outlined face and shoulders over three tonal planes.
 ellipse(150,89,39,54,[22,24,28,255]);
 ellipse(150,86,35,50,[202,67,57,255]);
 ellipse(150,67,25,28,[239,184,136,255]);
 ellipse(150,67,18,21,[248,202,156,255]);
 ellipse(141,64,2,3,[20,22,26,255]);
 ellipse(159,64,2,3,[20,22,26,255]);
 line(145,78,155,79,[64,29,28,255],2);
 line(126,112,174,112,[20,22,26,255],4);
 line(132,118,168,153,[28,49,77,255],10);
 line(169,118,184,153,[28,49,77,255],10);
 line(115,85,103,97,[28,28,28,255],2);
 line(183,87,197,99,[28,28,28,255],2);
 // A clear alpha window lets export validation compare transparent pixels.
 rect(12,12,42,34,[0,0,0,0]);
 return PNG.sync.write(png);
}
function inspectPNG(bytes){
 const png=PNG.sync.read(bytes),alphas=new Set();
 for(let i=3;i<png.data.length;i+=4)alphas.add(png.data[i]);
 return {png,alphas:[...alphas].sort((a,b)=>a-b)};
}
async function revealField(page,field){
 await field.waitFor({state:'attached'});
 const section=await field.evaluate(node=>node.closest('details')?.dataset.section);
 if(section){
  const details=page.locator('#inspector details[data-section="'+section+'"]');
  if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
 }
}
async function setInputValue(page,selector,value){
 const field=page.locator(selector).first();await revealField(page,field);
 await field.evaluate((node,next)=>{
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  setter.call(node,String(next));
  node.dispatchEvent(new Event('input',{bubbles:true}));
  node.dispatchEvent(new Event('change',{bubbles:true}));
 },value);
 await page.waitForFunction(({selector,expected})=>Number(document.querySelector(selector)?.value)===expected,{selector,expected:Number(value)},{timeout:10000});
}
async function setSelect(page,selector,value){
 const field=page.locator(selector);await revealField(page,field);await field.selectOption(value);
 await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.value===expected,{selector,expected:String(value)},{timeout:10000});
}
async function setToggle(page,selector,checked){
 const field=page.locator(selector).first();await revealField(page,field);
 if(await field.isChecked()!==checked){if(checked)await field.check();else await field.uncheck();}
 await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.checked===expected,{selector,expected:checked},{timeout:10000});
}
async function currentSVG(page){
 return page.locator('#artboard svg').evaluate(node=>node.outerHTML);
}
async function waitSVGChange(page,before,label){
 await page.waitForFunction(previous=>document.querySelector('#artboard svg')?.outerHTML!==previous,before,{timeout:20000});
 const next=await currentSVG(page);
 assert.notEqual(next,before,label+' updates the rendered SVG');
 return next;
}
async function clickPattern(page,type){
 await page.locator('#pattern-list [data-pattern="'+type+'"]').click();
 await page.waitForFunction(expected=>document.querySelector('#pattern-list [data-pattern="'+expected+'"]')?.getAttribute('aria-pressed')==='true',type,{timeout:10000});
}
async function selectLayer(page,id){
 await page.locator('#layer-list [data-layer-id="'+id+'"] [data-action="select-layer"]').click();
 await page.waitForFunction(expected=>document.querySelector('#layer-list .layer.selected [data-action="select-layer"]')?.dataset.id===expected,id,{timeout:10000});
}
async function assertNoHorizontalOverflow(page,label){
 const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,inspector:document.querySelector('#inspector').scrollWidth,inspectorClient:document.querySelector('#inspector').clientWidth}));
 assert.ok(sizes.document<=sizes.viewport+1,label+' page overflows horizontally: '+JSON.stringify(sizes));
 assert.ok(sizes.inspector<=sizes.inspectorClient+1,label+' inspector overflows horizontally: '+JSON.stringify(sizes));
}
function readSVGAttribute(svg,name){
 const rootTag=svg.match(/<svg\b[^>]*>/)?.[0];
 assert.ok(rootTag,'export contains an SVG root');
 return new RegExp('\\b'+name+'="([^"]*)"').exec(rootTag)?.[1];
}

(async()=>{
 await fs.mkdir(output,{recursive:true});
 await fs.access(path.join(appRoot,'index.html'));
 await fs.access(path.join(appRoot,'bundle.js'));
 const {Resvg}=await import('@resvg/resvg-js');
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=path.resolve(appRoot,'.'+pathname);
   if(!file.startsWith(appRoot+path.sep))throw Error('outside');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
   res.setHeader('Cache-Control','no-store');
   res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser,context;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false})));
  const origin='http://127.0.0.1:'+server.address().port+'/';
  const blockedRequests=[],pageErrors=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.startsWith(origin)||url.startsWith('data:')||url.startsWith('blob:')||url==='about:blank')return route.continue();
   blockedRequests.push(url);return route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(origin+'index.html');
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');

  const download=async action=>{
   const pending=page.waitForEvent('download');await action();
   const item=await pending,file=await item.path();assert.ok(file,'browser completed the download');
   return fs.readFile(file);
  };
  const saveProject=async()=>{
   const bytes=await download(()=>page.locator('[data-action="save"]').click());
   await fs.writeFile(path.join(output,'manga-roundtrip.ctm'),bytes);
   return JSON.parse(bytes.toString('utf8'));
  };
  const loadProject=async project=>{
   const dirty=await page.locator('html').getAttribute('data-project-dirty')==='true';
   await page.locator('#file-project').setInputFiles({name:'manga-roundtrip.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   if(dirty){await page.locator('#unsaved-discard').waitFor({state:'visible',timeout:10000});await page.locator('#unsaved-discard').click();}
   await page.waitForFunction(()=>Boolean(document.querySelector('#inspector details[data-section="manga-levels"]')),{},{timeout:10000});
  };
  const exportAsset=async(format)=>{
   await page.locator('[data-action="export"]').click();
   const dialog=page.locator('#dialog-root dialog[open]');await dialog.waitFor({state:'visible'});
   await dialog.locator('[data-format="'+format+'"]').click();
   const alpha=dialog.locator('#export-alpha');if(!await alpha.isChecked())await alpha.check();
   const size=(await dialog.locator('#export-size').textContent()).trim();
   const bytes=await download(()=>dialog.locator('#do-export').click());
   await dialog.waitFor({state:'detached'});
   await fs.writeFile(path.join(output,'manga-export.'+format),bytes);
   return {bytes,size};
  };

  await page.locator('#pattern-list [data-pattern="manga"]').waitFor({state:'visible'});
  await clickPattern(page,'manga');
  const mangaCard=page.locator('#pattern-list [data-pattern="manga"]');
  assert.equal(await mangaCard.getAttribute('aria-pressed'),'true','Manga card can be selected');
  const thumbColors=await mangaCard.locator('.manga-thumb [fill],.manga-thumb [stroke]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('fill')||node.getAttribute('stroke')).filter(color=>/^#[0-9a-f]{6}$/i.test(color)));
  assert.ok(thumbColors.length>=3,'Manga has an authored grayscale preview thumbnail');
  assert.ok(thumbColors.every(color=>color.slice(1,3)===color.slice(3,5)&&color.slice(3,5)===color.slice(5,7)),'Manga thumbnail uses only black, gray and white');

  const mangaLayerId=await page.locator('#layer-list .layer.selected [data-action="select-layer"]').getAttribute('data-id');
  assert.ok(mangaLayerId,'Manga is selected on a real pattern layer');
  const missingSource=await page.locator('#inspector .inspector-head > p.helper').innerText();
  assert.match(missingSource,/匯入圖片/,'empty source state asks the user to import an image');

  const chooserEvent=page.waitForEvent('filechooser');
  await page.locator('#inspector [data-action="add-color-image"]').click();
  const chooser=await chooserEvent;await chooser.setFiles({name:'manga-synthetic-illustration.png',mimeType:'image/png',buffer:makeFixture()});
  await page.waitForFunction(()=>Boolean(document.querySelector('#layer-list .layer[data-layer-type="imageMask"].selected')),{},{timeout:20000});
  const sourceId=await page.locator('#layer-list .layer[data-layer-type="imageMask"].selected [data-action="select-layer"]').getAttribute('data-id');
  assert.ok(sourceId,'UI import creates an image source layer');
  assert.equal(await page.locator('#inspector [data-action="image-mode"]').inputValue(),'color','Manga import uses a color image source');
  await clickPattern(page,'manga');
  await page.waitForFunction(()=>document.querySelector('#artboard svg')?.outerHTML.includes('data-manga="true"'),{},{timeout:20000});
  const initialSVG=await currentSVG(page);
  assert.ok(initialSVG.includes('data-manga="true"'),'imported image produces visible Manga output');

  const numberField=key=>'#inspector input[type="number"][data-target="params"][data-key="'+key+'"]';
  const rangeField=key=>'#inspector input[type="range"][data-target="params"][data-key="'+key+'"]';
  const toggleField=key=>'#inspector input[type="checkbox"][data-target="params"][data-key="'+key+'"]';
  const shapeField='#inspector select[data-target="params"][data-key="toneShape"]';
  await setInputValue(page,numberField('blackLevel'),180);
  assert.equal(Number(await page.locator(numberField('blackLevel')).inputValue()),180);
  assert.equal(Number(await page.locator(rangeField('blackLevel')).inputValue()),180,'black number and range inputs stay in sync');
  assert.equal(Number(await page.locator(numberField('whiteLevel')).inputValue()),181,'raising black to the old white threshold pushes white above it');
  assert.equal(Number(await page.locator(rangeField('whiteLevel')).inputValue()),181,'pushed white value updates its range control');
  await setInputValue(page,rangeField('whiteLevel'),65);
  assert.equal(Number(await page.locator(numberField('whiteLevel')).inputValue()),65,'white range and number inputs stay in sync');
  assert.equal(Number(await page.locator(rangeField('whiteLevel')).inputValue()),65);
  assert.equal(Number(await page.locator(numberField('blackLevel')).inputValue()),64,'lowering white to black pushes black below it');
  assert.equal(Number(await page.locator(rangeField('blackLevel')).inputValue()),64,'pushed black value updates its range control');
  assert.ok(Number(await page.locator(numberField('blackLevel')).inputValue())<Number(await page.locator(numberField('whiteLevel')).inputValue()),'black threshold remains below white');
  await setInputValue(page,numberField('blackLevel'),65);
  await setInputValue(page,numberField('whiteLevel'),180);

  const lineToggle=toggleField('lineArt');
  assert.equal(await page.locator(lineToggle).isChecked(),true,'line art is enabled by default');
  const lineBeforeOff=await currentSVG(page);
  await setToggle(page,lineToggle,false);
  const lineOff=await waitSVGChange(page,lineBeforeOff,'disabling line art');
  for(const key of ['lineStrength','lineWidth'])assert.equal(await page.locator(rangeField(key)).isDisabled(),true,'line control '+key+' is disabled when line art is off');
  await setToggle(page,lineToggle,true);
  await waitSVGChange(page,lineOff,'enabling line art');
  let before=await currentSVG(page);
  await setInputValue(page,rangeField('lineStrength'),88);
  let after=await waitSVGChange(page,before,'line strength');
  before=after;await setInputValue(page,rangeField('lineWidth'),2.5);
  after=await waitSVGChange(page,before,'line width');

  const toneToggle=toggleField('screentone');
  assert.equal(await page.locator(toneToggle).isChecked(),true,'screentone is enabled by default');
  before=await currentSVG(page);
  await setToggle(page,toneToggle,false);
  const toneOff=await waitSVGChange(page,before,'disabling screentone');
  for(const key of ['toneSize','toneDensity'])assert.equal(await page.locator(rangeField(key)).isDisabled(),true,'screentone control '+key+' is disabled when screening is off');
  assert.equal(await page.locator(shapeField).isDisabled(),true,'tone shape is disabled when screening is off');
  await setToggle(page,toneToggle,true);
  before=toneOff;after=await waitSVGChange(page,before,'enabling screentone');
  before=after;await setInputValue(page,rangeField('toneSize'),75);
  after=await waitSVGChange(page,before,'tone size');
  before=after;await setInputValue(page,rangeField('toneDensity'),72);
  after=await waitSVGChange(page,before,'tone density');
  before=after;await setSelect(page,shapeField,'square');
  after=await waitSVGChange(page,before,'tone shape');

  before=after;await setInputValue(page,numberField('toneSize'),62);
  const size62SVG=await waitSVGChange(page,before,'tone size before undo');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(()=>Number(document.querySelector('#inspector input[type="number"][data-key="toneSize"]')?.value)===75,{},{timeout:10000});
  await page.waitForFunction(expected=>document.querySelector('#artboard svg')?.outerHTML===expected,after,{timeout:20000});
  assert.equal(Number(await page.locator(numberField('toneSize')).inputValue()),75,'undo restores the prior tone size');
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(()=>Number(document.querySelector('#inspector input[type="number"][data-key="toneSize"]')?.value)===62,{},{timeout:10000});
  await page.waitForFunction(expected=>document.querySelector('#artboard svg')?.outerHTML===expected,size62SVG,{timeout:20000});
  assert.equal(Number(await page.locator(rangeField('toneSize')).inputValue()),62,'redo restores tone size and its range control');

  const sourceBeforeMove=await currentSVG(page);
  await selectLayer(page,sourceId);
  await setInputValue(page,'#inspector input[type="number"][data-target="layer"][data-key="offsetX"]',48);
  const movedSourceSVG=await waitSVGChange(page,sourceBeforeMove,'moving the source image');
  await selectLayer(page,mangaLayerId);
  assert.equal(await currentSVG(page),movedSourceSVG,'Manga output follows the transformed shared image source');

  const savedControls={black:Number(await page.locator(numberField('blackLevel')).inputValue()),white:Number(await page.locator(numberField('whiteLevel')).inputValue()),lineArt:await page.locator(lineToggle).isChecked(),lineStrength:Number(await page.locator(numberField('lineStrength')).inputValue()),lineWidth:Number(await page.locator(numberField('lineWidth')).inputValue()),screentone:await page.locator(toneToggle).isChecked(),toneSize:Number(await page.locator(numberField('toneSize')).inputValue()),toneDensity:Number(await page.locator(numberField('toneDensity')).inputValue()),toneShape:await page.locator(shapeField).inputValue()};
  await clickPattern(page,'dots');
  await clickPattern(page,'manga');
  assert.deepEqual({black:Number(await page.locator(numberField('blackLevel')).inputValue()),white:Number(await page.locator(numberField('whiteLevel')).inputValue()),lineArt:await page.locator(lineToggle).isChecked(),lineStrength:Number(await page.locator(numberField('lineStrength')).inputValue()),lineWidth:Number(await page.locator(numberField('lineWidth')).inputValue()),screentone:await page.locator(toneToggle).isChecked(),toneSize:Number(await page.locator(numberField('toneSize')).inputValue()),toneDensity:Number(await page.locator(numberField('toneDensity')).inputValue()),toneShape:await page.locator(shapeField).inputValue()},savedControls,'switching to another pattern and back preserves Manga controls');

  const savedProject=await saveProject();
  const savedManga=savedProject.layers.find(layer=>layer.id===mangaLayerId&&layer.type==='manga');
  const savedSource=savedProject.layers.find(layer=>layer.id===sourceId&&layer.type==='imageMask');
  assert.ok(savedManga,'UI project download contains the Manga layer');
  assert.deepEqual({black:savedManga.params.blackLevel,white:savedManga.params.whiteLevel,lineArt:savedManga.params.lineArt,lineStrength:savedManga.params.lineStrength,lineWidth:savedManga.params.lineWidth,screentone:savedManga.params.screentone,toneSize:savedManga.params.toneSize,toneDensity:savedManga.params.toneDensity,toneShape:savedManga.params.toneShape},savedControls,'project download serializes the visible Manga controls');
  assert.equal(savedSource?.mode,'color','project download preserves the color source mode');
  assert.equal(savedSource?.offsetX,48,'project download preserves source movement');
  assert.ok(savedSource.image.startsWith('data:image/png;base64,'),'project download embeds the generated illustration PNG');

  await page.locator('#inspector').evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:path.join(output,'manga-dark-zh.png'),fullPage:true});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','capture is from the dark theme');

  for(const locale of ['zh','en','ja']){
   await page.locator('.language-select').selectOption(locale);
   await page.waitForFunction(expected=>document.querySelector('.language-select')?.value===expected,locale,{timeout:10000});
   const headings=await page.locator('#inspector details[data-section^="manga-"] summary').evaluateAll(nodes=>nodes.map(node=>node.textContent.trim()));
   assert.equal(headings.length,3,locale+' displays all three Manga control groups');
   assert.ok(headings.every(text=>text.length>0),locale+' Manga headings are present');
   const labels=await page.locator('#inspector details[data-section^="manga-"] input[type="range"],#inspector details[data-section^="manga-"] input[type="checkbox"],#inspector details[data-section^="manga-"] select[data-target="params"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')||node.labels?.[0]?.textContent.trim()||node.closest('.field')?.querySelector('label')?.textContent.trim()));
   assert.equal(labels.length,9,locale+' labels every Manga setting');
   assert.ok(labels.every(text=>text&&text.length>0),locale+' Manga controls have visible localized labels');
   for(const width of [1440,960,880]){
    await page.setViewportSize({width,height:960});
    await assertNoHorizontalOverflow(page,'Manga '+locale+' '+width);
   }
   await page.setViewportSize({width:1440,height:960});
  }
  await page.locator('.language-select').selectOption('zh');
  await page.waitForFunction(()=>document.querySelector('.language-select')?.value==='zh');

  const svgDownload=await exportAsset('svg');
  const svgText=svgDownload.bytes.toString('utf8');
  assert.ok(svgText.includes('<svg'),'SVG download contains vector markup');
  const svgWidth=Number(readSVGAttribute(svgText,'width')),svgHeight=Number(readSVGAttribute(svgText,'height'));
  assert.deepEqual([svgWidth,svgHeight],[savedProject.width,savedProject.height],'SVG export dimensions match the project canvas');
  assert.equal(readSVGAttribute(svgText,'viewBox'),'0 0 '+savedProject.width+' '+savedProject.height,'SVG viewBox matches project dimensions');
  const svgRasterBytes=new Resvg(svgText,{font:{loadSystemFonts:false}}).render().asPng();
  const svgRaster=inspectPNG(svgRasterBytes);
  assert.deepEqual([svgRaster.png.width,svgRaster.png.height],[savedProject.width,savedProject.height],'Resvg parses the exported SVG at project size');
  assert.ok(svgRaster.alphas.includes(0)&&svgRaster.alphas.includes(255),'SVG output keeps both transparent and opaque pixels');

  const pngDownload=await exportAsset('png');
  const pngImage=inspectPNG(pngDownload.bytes);
  assert.deepEqual([pngImage.png.width,pngImage.png.height],[savedProject.width,savedProject.height],'PNG export dimensions match the project canvas');
  assert.ok(pngImage.alphas.includes(0)&&pngImage.alphas.includes(255),'PNG output keeps both transparent and opaque pixels');
  assert.deepEqual([pngImage.png.width,pngImage.png.height],[svgRaster.png.width,svgRaster.png.height],'PNG and SVG render at the same dimensions');

  await loadProject(savedProject);
  await page.waitForFunction(expected=>document.querySelector('#pattern-list [data-pattern="manga"]')?.getAttribute('aria-pressed')==='true',{}, {timeout:10000});
  const reloadedSVG=await exportAsset('svg');
  assert.deepEqual(reloadedSVG.bytes,svgDownload.bytes,'loading the saved project reproduces the same SVG output');
  await fs.writeFile(path.join(output,'manga-roundtrip.svg'),reloadedSVG.bytes);

  assert.deepEqual(pageErrors,[],'browser produced no uncaught page errors');
  assert.deepEqual(blockedRequests,[],'the built app completed without external network requests');
  console.log('PASS Manga built-app browser integration: thumbnail, color import, threshold coupling, toggles, screentone controls, source transform, undo/redo, pattern persistence, project/SVG/PNG exports, three locales and no overflow.');
  console.log('Artifacts:',path.join(output,'manga-dark-zh.png'),path.join(output,'manga-export.svg'),path.join(output,'manga-export.png'),path.join(output,'manga-roundtrip.svg'));
 }finally{
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
