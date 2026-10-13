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
 const {createDocument,createLayer}=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const server=http.createServer(async(req,res)=>{
  try{
   const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
   if(!file.startsWith(root+path.sep))throw new Error('Outside fixture root');
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>{if(!localStorage.getItem('ctm.preferences'))localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false}));});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}/app/index.html`;
  await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const field=key=>page.locator(`#inspector input[type=number][data-key="${key}"]`);
  const change=async(key,value)=>{await field(key).fill(String(value));await field(key).press('Tab');await page.waitForTimeout(40);};
  const load=async(type,params={},layerExtra={},docExtra={})=>{
   const doc=createDocument();Object.assign(doc,{width:512,height:512},docExtra);doc.layers=[createLayer(type,'fixture')];Object.assign(doc.layers[0],{color:'#252525',secondary:'#787878'},layerExtra);Object.assign(doc.layers[0].params,params);
   await page.locator('#file-project').setInputFiles({name:'fixture.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
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

  await load('dots',{finite:true,rows:5,columns:5,size:60});
  const styledSvg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop stop-color="#ffcc00"/><stop offset="1" stop-color="#ff5500"/></linearGradient><clipPath id="clip"><circle cx="32" cy="32" r="27"/></clipPath><clipPath id="full"><rect width="64" height="64"/></clipPath><mask id="mask" style="mask-type:luminance"><rect width="64" height="64" fill="white"/><circle cx="32" cy="32" r="9" fill="black"/></mask><mask id="full-mask"><rect width="64" height="64" fill="white"/></mask></defs><rect width="64" height="64" style="fill:url(\'#g\');stroke:#fff;stroke-width:2;clip-path:url(\'#clip\');mask:url(\'#mask\')" fill="#00ff00" clip-path="url(\'#full\')" mask="url(\'#full-mask\')"/></svg>';
  await page.locator('[data-action=shape-library]').click();await page.locator('#file-image').setInputFiles({name:'Sun ring.svg',mimeType:'image/svg+xml',buffer:Buffer.from(styledSvg)});
  await page.waitForFunction(()=>document.querySelector('#artboard image')?.getAttribute('href')?.startsWith('data:image/svg+xml'));assert.equal(await page.locator('#p-shape').inputValue(),'custom');
  const data=await page.locator('#artboard image').first().getAttribute('href'),xml=Buffer.from(data.split(',')[1],'base64').toString();assert.match(xml,/fill="url\(#g\)"/);assert.match(xml,/clip-path="url\(#clip\)"/);assert.match(xml,/mask="url\(#mask\)"/);assert.match(xml,/mask-type="luminance"/);assert.doesNotMatch(xml,/style=/);
  const pixels=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [[0,0],[32,32],[32,12]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);},data);
  assert.equal(pixels[0][3],0,'clip must preserve transparent corners');assert.equal(pixels[1][3],0,'mask must keep the hole transparent');assert.ok(pixels[2][0]>200&&pixels[2][2]<30&&pixels[2][3]>200,'inline style gradient must survive import');
  for(const type of ['halftone','polygons','symbols','dots']){
   await page.locator(`[data-pattern=${type}]`).click();await page.locator('[data-action=shape-library]').click();await page.locator('[data-action=use-shape]').click();await page.waitForTimeout(40);assert.ok(await page.locator('#artboard image').count()>0,`${type} should use shared SVG`);
  }
  const saved=JSON.parse((await save()).toString());assert.equal(saved.layers[0].customMotif,data);
  const svg=(await exported('svg')).toString();assert.match(svg,/<image /);assert.ok(svg.includes(data));const png=await exported('png');assert.equal(png.subarray(1,4).toString(),'PNG');
  const raster=PNG.sync.read(png);let colored=0,transparent=0;for(let i=0;i<raster.data.length;i+=4){if(raster.data[i+3]===0)transparent++;if(raster.data[i]>180&&raster.data[i+2]<60&&raster.data[i+3]>80)colored++;}assert.ok(colored>100&&transparent>10000,'nested SVG shapes must really appear with colors and transparency in the exported PNG');
  await page.waitForTimeout(450);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');await page.locator('[data-action=shape-library]').click();assert.equal(await page.locator('[data-action=use-shape]').count(),1,'library persists across reload');
  await page.locator('[data-action=remove-shape]').click();await page.waitForFunction(()=>!document.querySelector('[data-action=use-shape]'));await page.locator('[data-action=close-dialog]').click();assert.ok(await page.locator('#artboard image').count()>0,'removing library asset preserves embedded project shape');
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
  assert.deepEqual(errors,[],'app must not emit unhandled browser errors');
  console.log('PASS editor browser integration');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
