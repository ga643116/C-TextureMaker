/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..'),appRoot=path.join(root,'dist/C-TextureMaker/app');

async function main(){
 const server=http.createServer(async(req,res)=>{try{
  const file=path.resolve(appRoot,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(appRoot+path.sep))throw Error('outside app');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const origin='http://127.0.0.1:'+server.address().port+'/',contexts=[];
  const open=async({motion=true,reduced=false,holdFonts=false}={})=>{
   const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:reduced?'reduce':'no-preference'});contexts.push(context);
   await context.addInitScript(({motion,holdFonts})=>{
    localStorage.setItem('ctm.preferences',JSON.stringify({lang:'zh',theme:'light',motion}));
    window.__startupSamples=[];window.__fontReadyRequested=false;window.__fontsReleased=false;
    if(holdFonts){
     let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
     Object.defineProperty(document.fonts,'ready',{configurable:true,get(){window.__fontReadyRequested=true;return pending;}});
     window.__releaseStartupFonts=()=>{window.__fontsReleased=true;resolve(document.fonts);};
     window.__rejectStartupFonts=()=>{window.__fontsReleased=true;reject(new Error('mock font failure'));};
    }
    const sample=()=>{
     const app=document.querySelector('#app');
     if(app){
      const style=getComputedStyle(app),opacity=Number(style.opacity);
      window.__startupSamples.push({time:performance.now(),appReady:document.documentElement.dataset.appReady==='true',booting:app.dataset.booting==='true',entering:app.dataset.entering==='true',fontsRequested:window.__fontReadyRequested,fontsReleased:window.__fontsReleased,opacity,visibility:style.visibility,display:style.display,inert:app.inert});
     }
     requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
   },{motion,holdFonts});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'index.html');
   return{context,page,errors};
  };
  const state=page=>page.locator('#app');
  const waitReady=page=>page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const assertRevealed=async page=>{
   await page.waitForFunction(()=>{const app=document.querySelector('#app');return app&&!app.hasAttribute('data-booting')&&!app.hasAttribute('data-entering')&&!app.inert&&Number(getComputedStyle(app).opacity)>.99;});
   assert.equal(await page.locator('.motion-skip').count(),0);
   assert.ok(await page.locator('#app .topbar').isVisible());
  };
  const assertNoPageErrors=errors=>assert.deepEqual(errors,[]);

  // Hold fonts after the complete UI has rendered. Every recorded frame must keep the root hidden.
  {
   const{page,errors}=await open({holdFonts:true});await waitReady(page);
   await page.waitForFunction(()=>window.__fontReadyRequested===true&&document.querySelector('#app .topbar')&&document.querySelector('#app .workspace')&&document.querySelector('#app .statusbar'));
   await page.waitForTimeout(160);
   const duringWait=await page.evaluate(()=>window.__startupSamples.filter(sample=>sample.fontsRequested&&!sample.fontsReleased));
   assert.ok(duringWait.length>=5,'sampled multiple frames while fonts.ready was pending');
   assert.ok(duringWait.every(sample=>sample.booting&&sample.opacity<0.05&&(sample.visibility==='hidden'||sample.display==='none'||sample.opacity<0.05)),JSON.stringify(duringWait));
   assert.equal(await state(page).evaluate(app=>app.inert),true,'app remains non-interactive during font wait');
   await page.evaluate(()=>window.__releaseStartupFonts());
   await page.waitForFunction(()=>document.querySelector('#app')?.dataset.entering==='true');
   const animationStart=await page.evaluate(()=>({opacity:getComputedStyle(document.querySelector('#app')).opacity,inert:document.querySelector('#app').inert,booting:document.querySelector('#app').dataset.booting,skip:!!document.querySelector('.motion-skip')}));
   assert.equal(animationStart.opacity,'0','generate synchronously hides the app before booting is removed');
   assert.equal(animationStart.booting,undefined);assert.equal(animationStart.inert,true);assert.equal(animationStart.skip,true);
   await page.locator('.t-gen').waitFor({state:'attached',timeout:3000});
   assert.ok(await page.locator('.t-gen').count()>0,'normal intro adds its overlay to the document');
   await page.waitForFunction(()=>!document.querySelector('#app')?.hasAttribute('data-entering'),undefined,{timeout:8000});
   await assertRevealed(page);assertNoPageErrors(errors);
   const duringAnimation=await page.evaluate(()=>window.__startupSamples.filter(sample=>sample.entering));
   assert.ok(duringAnimation.length>0,'sampled animation frames');
   assert.ok(duringAnimation.some(sample=>sample.opacity<0.05),'animation begins before the complete UI is revealed');
  }

  // A rejected font readiness promise must fall back to an interactive visible app.
  {
   const{page}=await open({holdFonts:true});await waitReady(page);
   await page.waitForFunction(()=>window.__fontReadyRequested===true);
   await page.evaluate(()=>window.__rejectStartupFonts());await assertRevealed(page);
  }

  // Skip control and Escape both cancel an active intro and restore interaction.
  for(const route of ['skip','escape']){
   const{page,errors}=await open();await waitReady(page);
   await page.locator('.motion-skip').waitFor({state:'visible'});
   assert.equal(await state(page).evaluate(app=>app.inert),true);
   if(route==='skip')await page.locator('.motion-skip').click();else await page.keyboard.press('Escape');
   await assertRevealed(page);assertNoPageErrors(errors);
  }

  // Disabling startup motion reveals the initialized app without waiting for fonts or entering.
  {
   const{page,errors}=await open({motion:false,holdFonts:true});await waitReady(page);await assertRevealed(page);
   assert.equal(await page.evaluate(()=>window.__fontReadyRequested),false,'motion=false does not wait for fonts');
   assert.equal(await page.locator('#app').getAttribute('data-entering'),null);
   assertNoPageErrors(errors);
  }

  // Reduced motion skips the skeleton but still completes the short fade and unlocks the app.
  {
   const{page,errors}=await open({reduced:true});await waitReady(page);
   await page.waitForFunction(()=>document.querySelector('#app')?.dataset.entering==='true',undefined,{timeout:4000});
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
   assert.equal(await page.locator('.t-gen').count(),0,'reduced motion uses the fade instead of the skeleton overlay');
   await page.waitForFunction(()=>!document.querySelector('#app')?.hasAttribute('data-entering'),undefined,{timeout:4000});
   await assertRevealed(page);assert.equal(await page.locator('.t-gen').count(),0);assertNoPageErrors(errors);
  }

  for(const context of contexts)await context.close();
  console.log('PASS startup font-wait frame sampling, hidden animation start, natural reveal, font-error fallback, skip/Escape recovery, motion=false, and reduced motion.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
