/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// New feature flows run in a fresh headless Edge context, never on the desktop.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const engine=await import(pathToFileURL(path.join(root,'app/engine.mjs')));
 const bundle=require('esbuild').buildSync({entryPoints:[path.join(root,'app/engine.mjs')],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].contents;
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error('outside');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(file===path.join(root,'app/engine.mjs')?bundle:await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'dark',motion:false})));
  const page=await context.newPage(),errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}/app/index.html`;
  await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const load=async doc=>{const discard=await page.locator('html').getAttribute('data-project-dirty')==='true';await page.locator('#file-project').setInputFiles({name:'features.ctm',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});if(discard)await page.locator('#unsaved-discard').click();await page.waitForTimeout(180);};
  const download=async action=>{const pending=page.waitForEvent('download');await action();return fs.readFile(await (await pending).path());};
  const save=async()=>JSON.parse((await download(()=>page.locator('[data-action=save]').click())).toString());
  const field=key=>page.locator(`#inspector input[type=number][data-key="${key}"]`);
  const change=async(key,value)=>{await field(key).fill(String(value));await field(key).press('Tab');await page.waitForTimeout(60);};
  const doc=engine.createDocument();doc.width=doc.height=512;doc.layers=[engine.createLayer('lowpoly','art')];doc.layers[0].color='#e2e5eb';doc.layers[0].secondary='#152052';await load(doc);
  assert.equal(await page.locator('.pattern-card').count(),17);
  const before=await page.locator('#artboard polygon').count();await change('points',360);await page.waitForFunction(before=>document.querySelectorAll('#artboard polygon').length>before*1.5,before);assert.ok(await page.locator('#artboard polygon').count()>before*1.5);
  const png=new PNG({width:96,height:64});
  for(let y=0;y<64;y++)for(let x=0;x<96;x++)png.data.set([x<48?240:20,y>40?230:30,x>=48?240:20,x>78&&y>45?0:255],(y*96+x)*4);
  await page.locator('[data-action=add-color-image]').click();await page.locator('#file-image-mask').setInputFiles({name:'colors.png',mimeType:'image/png',buffer:PNG.sync.write(png)});
  await page.waitForFunction(()=>document.querySelector('#inspector .image-mode')?.value==='color');
  assert.equal(await field('threshold').count(),0);
  await page.locator('#layer-list .image-mode').selectOption('mask');assert.equal(await field('threshold').count(),1);await change('threshold',72);
  await page.locator('#inspector .image-mode').selectOption('color');assert.equal(await field('threshold').count(),0);
  let stored=await save();assert.equal(stored.layers[1].mode,'color');assert.equal(stored.layers[1].threshold,72);assert.ok(stored.layers[1].colorMap.rgba.length);
  await load(stored);await page.locator('[data-pattern=dots]').click();
  assert.ok(await page.locator('#artboard mask[id^=image-color-shape-]').count());
  const cell=await page.locator('#artboard [data-cell]').evaluateAll(nodes=>{for(const el of nodes){if(el.dataset.hidden==='true')continue;const m=el.getScreenCTM(),x=+el.dataset.cx,y=+el.dataset.cy,p={x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};if(p.x>500&&p.x<900&&p.y>300&&p.y<600)return p;}});
  assert.ok(cell);await page.mouse.click(cell.x,cell.y);stored=await save();assert.equal(stored.layers[0].hiddenCells.length,1,'projected color preserves real cell editing');
  for(const locale of ['zh','en','ja']){await page.locator('.language-select').selectOption(locale);await page.locator('[data-action=help]').click();assert.equal(await page.locator('dialog a[data-target=repository]').getAttribute('href'),'https://github.com/ga643116/C-TextureMaker');assert.equal(await page.locator('dialog a[data-target=author]').textContent(),'Ume9 (ga643116)');assert.ok(await page.locator('dialog .motion-credit').textContent());await page.locator('dialog [data-action=close-dialog]').click();}
  console.log('PASS Low Poly controls, image mode switching, embedded colors, editable projected cells and three-language credits');

  const rasterChecks=await page.evaluate(async()=>{
   const {PATTERNS,createDocument,createLayer,createImageMaskLayer,renderSVG}=await import('/app/engine.mjs');
   const source=document.createElement('canvas');source.width=source.height=128;const sc=source.getContext('2d',{willReadFrequently:true});sc.fillStyle='#ff0000';sc.fillRect(0,0,64,128);sc.fillStyle='#0000ff';sc.fillRect(64,0,64,128);
   const bytes=sc.getImageData(0,0,128,128).data;let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
   const colorMap={width:128,height:128,rgba:btoa(binary)},image=source.toDataURL();
   const raster=async (svg,size)=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));await img.decode();const c=document.createElement('canvas');c.width=size||img.width;c.height=size||img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,c.width,c.height);return {data:ctx.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height};};
   const results=[];
   for(const pattern of PATTERNS){const d=createDocument();d.width=d.height=1024;d.layers=[createLayer(pattern.id,'art'),createImageMaskLayer({id:'image',image,imageWidth:128,imageHeight:128,mode:'color',colorMap})];if('strokeWidth' in d.layers[0].params)d.layers[0].params.strokeWidth=8;const r=await raster(renderSVG(d),128);let red=0,blue=0;for(let i=0;i<r.data.length;i+=4){if(r.data[i+3]<30)continue;if(r.data[i]>r.data[i+2]+30)red++;if(r.data[i+2]>r.data[i]+30)blue++;}results.push({type:pattern.id,red,blue});}
   const d=createDocument();d.width=d.height=128;d.seamless=true;d.layers=[createLayer('contour','terrain')];Object.assign(d.layers[0],{color:'#a2ffe4',secondary:'#399e8c'});Object.assign(d.layers[0].params,{depth:true,levels:6,shadowRange:8,shadowOffset:5});
   const outer=await raster(renderSVG(d)),repeat=await raster(renderSVG(d,{repeat:3}));d.layers[0].params.shadowSide='inner';const inner=await raster(renderSVG(d));let different=0,repeatError=0,edge=0,interior=0;
   for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;if(outer.data[i]!==inner.data[i])different++;for(let c=0;c<4;c++){repeatError+=Math.abs(outer.data[i+c]-repeat.data[((y+128)*repeat.width+x+128)*4+c]);if(x===0)edge+=Math.abs(outer.data[i+c]-outer.data[(y*128+127)*4+c]);if(x===63)interior+=Math.abs(outer.data[i+c]-outer.data[(y*128+64)*4+c]);}}
   // A fully transparent color layer must also keep facet output transparent.
   const colorTerrain=createImageMaskLayer({id:'terrain-color',image,imageWidth:128,imageHeight:128,mode:'color',colorMap});d.layers.push(colorTerrain);Object.assign(d.layers[0],{rotation:27,scale:.73,offsetX:19});d.layers[0].params.shadowOpacity=0;const coloredDepth=await raster(renderSVG(d));colorTerrain.flipX=true;const flippedDepth=await raster(renderSVG(d));const at=(r,x,y)=>[...r.data.slice((y*r.width+x)*4,(y*r.width+x)*4+4)];
   const depthColors=[at(coloredDepth,32,64),at(coloredDepth,96,64),at(flippedDepth,32,64),at(flippedDepth,96,64)];
   const clear=createImageMaskLayer({id:'clear',image,imageWidth:128,imageHeight:128,mode:'color',colorMap:{width:1,height:1,rgba:'AAAAAA=='}});const p=createDocument();p.width=p.height=128;p.layers=[createLayer('lowpoly','facets'),clear];const transparent=await raster(renderSVG(p));let alpha=0;for(let i=3;i<transparent.data.length;i+=4)alpha+=transparent.data[i];
   return {results,different,repeatError,edge,interior,alpha,depthColors};
  });
  for(const row of rasterChecks.results)assert.ok(row.red>0&&row.blue>0,`${row.type} receives both image colors`);
  assert.ok(rasterChecks.different>200,'inner and outer shadows must visibly differ');assert.ok(rasterChecks.repeatError<128*128*4*2,'central repeat tile matches single export');assert.equal(rasterChecks.alpha,0);assert.deepEqual(rasterChecks.depthColors,[[255,0,0,255],[0,0,255,255],[0,0,255,255],[255,0,0,255]],'depth paint stays fixed to the image under periodic geometry transforms');assert.ok(rasterChecks.edge<rasterChecks.interior*3+128,'periodic shadows do not introduce an edge stripe');console.log('PASS actual SVG pixels for 17 image-colored patterns, transparent facets and inner/outer repeated contour shadows',JSON.stringify(rasterChecks));

  // Verify real frontend Save/Open wiring against a deterministic native bridge.
  const native=await browser.newContext({viewport:{width:1440,height:960}});
  await native.addInitScript(()=>{
   localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'light',motion:false}));const listeners=[];let sequence=0;
   window.nativeRequests=[];window.nativeNext=null;
   Object.defineProperty(window.chrome,'webview',{value:{addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(msg){window.nativeRequests.push(msg);if(msg.type==='window')return;const next=window.nativeNext;window.nativeNext=null;let reply={id:msg.id,type:msg.type+'-result',ok:true};if(next?.cancelled)reply={...reply,ok:false,cancelled:true};else if(msg.type==='save')reply.projectToken=msg.projectToken&&!msg.saveAs?msg.projectToken:(++sequence).toString(16).padStart(32,'0');else if(msg.type==='open')reply={...reply,name:'opened.ctm',projectToken:'f'.repeat(32),base64:btoa(unescape(encodeURIComponent(JSON.stringify(window.nativeOpenDoc))))};queueMicrotask(()=>listeners.forEach(fn=>fn({data:reply})));}}});
  });
  const np=await native.newPage();np.on('pageerror',e=>errors.push(e.message));await np.goto(url);await np.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const last=()=>np.evaluate(()=>window.nativeRequests.filter(r=>r.intent==='project').at(-1));
  await np.locator('[data-action=save]').click();assert.equal((await last()).projectToken,undefined);
  await np.locator('[data-action=save]').click();const token=(await last()).projectToken;assert.ok(token);
  await np.locator('[data-action=save-menu]').click();await np.evaluate(()=>window.nativeNext={cancelled:true});await np.locator('[data-action=save-as]').click();assert.equal((await last()).saveAs,true);
  await np.locator('[data-action=save]').click();assert.equal((await last()).projectToken,token,'cancelled Save As retains old destination');
  await np.locator('#inspector input[type=number][data-key=peaks]').focus();await np.keyboard.press('Control+Shift+s');assert.equal((await last()).saveAs,true);await np.locator('[data-action=save]').click();assert.notEqual((await last()).projectToken,token,'successful Save As becomes current destination');
  await np.evaluate(doc=>window.nativeOpenDoc=doc,doc);await np.locator('[data-action=open]').click();await np.waitForFunction(()=>document.querySelector('[data-pattern=lowpoly]')?.getAttribute('aria-pressed')==='true');await np.locator('[data-action=save]').click();assert.equal((await last()).projectToken,'f'.repeat(32));
  await np.locator('[data-action=new]').click();await np.waitForFunction(()=>document.querySelector('.document-name span')?.textContent==='未命名圖樣');await np.locator('[data-action=save]').click();assert.equal((await last()).projectToken,undefined,'New clears the previous destination');
  await np.locator('[data-action=help]').click();await np.locator('dialog a[data-target=repository]').click();assert.equal(await np.evaluate(()=>window.nativeRequests.at(-1).target),'repository');
  console.log('PASS frontend Save, Save As cancellation and shortcut, Open destination, New reset and native GitHub link');
  assert.deepEqual(errors,[]);await native.close();await context.close();
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
