/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {PATTERNS,SHAPE_PATTERNS,createDocument,createLayer,switchLayerPattern,resetLayerPattern,createImageMaskLayer,isImageMaskLayer,imageMaskGeometry,normalizeDocument,renderSVG} from './engine.mjs';
import {translator,localized} from './i18n.mjs';
import {generate} from './vendor/ui-generation.js';
import {persistentStorage} from './storage.mjs';
import {normalizeShapeLibrary,addShape,removeShape,renameShape,importShapeFile} from './shape-library.mjs';
import {strokeHits,nearestCell} from './cell-brush.mjs';
import {grayscaleImage,autoThreshold} from './image-threshold.mjs';
import {encodeColorMap} from './image-color.mjs';
import {createProjectFiles} from './project-files.mjs';
import {ratioLabel,resizeCanvas} from './canvas-size.mjs';
import {createUserPreset,applyUserPreset,presetPreview} from './user-presets.mjs';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clone=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const uid=()=>`l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
const MAX_PROJECT_BYTES=96*1024*1024;
const store={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}}};
const prefs=store.get('ctm.preferences',{lang:'zh',theme:'light',motion:true});
let lang=['zh','en','ja'].includes(prefs.lang)?prefs.lang:'zh',t=translator(lang);
let doc=createDocument();doc.layers[0].color='#35392f';doc.layers[0].secondary='#9da58f';doc.name=t('untitled');
let restored=false,storageReady=false,storageAvailable=false,savedPresets=[],saveState='storageLoading';
let selected=doc.layers[0].id, past=[],future=[],pendingBefore=null;
let category='all',query='',repeat=1,tileEdges=true,zoom=1,pan={x:0,y:0},focus=false;
let imageTarget='customMotif',editMode='toggle',connectStart=null,frame=0,saveTimer=0,toastTimer=0,motionRun=null,autosaveSequence=0,autosaveQueue=Promise.resolve(),presetWriteQueue=Promise.resolve();
let canvasTool='cursor',brushSize=clamp(Number(prefs.brushSize)||64,4,4096),sharedShapes=[],shapeLibraryReady=false,shapeWriteQueue=Promise.resolve();
const thumbs=new Map(),nativeSaves=new Map();
const nativeHost=window.chrome?.webview;
const projectFiles=createProjectFiles({host:nativeHost,download:saveFile});
let projectFileBusy=false,navigationBusy=false,closeRequestBusy=false,allowUnload=false;
let savedSnapshot=JSON.stringify(doc),unsavedPrompt=null,projectGeneration=0;
let windowMaximized=false,entranceSequence=0;
document.documentElement.dataset.desktop=String(Boolean(nativeHost));
const active=()=>doc.layers.find(l=>l.id===selected)??doc.layers[0];
let lastPatternId=selected,maskImportTarget=null,maskImportDocument=null,maskImportSequence=0,maskImportMode='mask';
const activePattern=()=>!isImageMaskLayer(active())?active():doc.layers.find(l=>l.id===lastPatternId&&!isImageMaskLayer(l))??doc.layers.find(l=>!isImageMaskLayer(l));
const layerName=layer=>isImageMaskLayer(layer)?layer.name:label(pattern(layer.type).name);
const pattern=id=>PATTERNS.find(p=>p.id===id)??PATTERNS[0];
const label=x=>localized(x,lang);
const glyphs={
 image:'<rect x="1.5" y="2" width="13" height="12" rx="1"/><circle cx="5" cy="5.5" r="1"/><path d="m2 12 4-4 3 3 2-2 3 3"/>',
 pencil:'<path d="m10.5 1.5 4 4-8.5 8.5-5 1 1-5zM8.5 3.5l4 4"/>',
 cursor:'<path d="M3 1.5 13 8l-4.6 1.1L6 13.5zM8.4 9.4l2.2 4.1"/>',hand:'<path d="M5 8V3.5a1 1 0 0 1 2 0V7 2.5a1 1 0 0 1 2 0V7 3.5a1 1 0 0 1 2 0V8 5a1 1 0 0 1 2 0v5c0 3-2 5-5 5-2 0-3-1-4-3L2 8.5a1.2 1.2 0 0 1 1.8-1.4L5 8z"/>',
 windowMaximize:'<rect x="3" y="3" width="10" height="10" rx=".5"/>',windowRestore:'<path d="M5 3V1h10v10h-2M1 5h10v10H1z"/>',
 search:'<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',plus:'<path d="M8 2v12M2 8h12"/>',minus:'<path d="M3 8h10"/>',
 open:'<path d="M1.5 5V3h5l2 2h6v8h-13z"/><path d="M1.5 7h13"/>',save:'<path d="M3 2h9l2 2v10H2V2zM5 2v4h6V2M5 14V9h6v5"/>',export:'<path d="M8 10V1m-3 3 3-3 3 3M2 9v5h12V9"/>',
 undo:'<path d="M5 3 1 6l4 3M1 6h8a4 4 0 0 1 0 8"/>',redo:'<path d="m11 3 4 3-4 3m4-3H7a4 4 0 0 0 0 8"/>',sun:'<circle cx="8" cy="8" r="3"/><path d="M8 0v2m0 12v2M0 8h2m12 0h2M2.3 2.3l1.4 1.4m8.6 8.6 1.4 1.4M2.3 13.7l1.4-1.4m8.6-8.6 1.4-1.4"/>',moon:'<path d="M14 10A6.5 6.5 0 0 1 6 2a6.5 6.5 0 1 0 8 8z"/>',
 help:'<circle cx="8" cy="8" r="6"/><path d="M6.3 5.7a1.8 1.8 0 1 1 2.4 1.7L8 9m0 2h.01"/>',reset:'<path d="M2 6a6 6 0 1 1 0 5M2 2v4h4"/>',random:'<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5h.01M11 5h.01M8 8h.01M5 11h.01M11 11h.01"/>',fit:'<path d="M1 5V1h4m6 0h4v4M1 11v4h4m6 0h4v-4M5 5h6v6H5z"/>',expand:'<path d="M1 6V1h5m4 0h5v5M1 10v5h5m4 0h5v-5"/>',eye:'<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/>',eyeOff:'<path d="m2 2 12 12M6 3.7A9 9 0 0 1 15 8c-.6.9-1.3 1.7-2 2.3M10 12.2A9 9 0 0 1 1 8c.6-.9 1.3-1.7 2-2.3"/>',
 copy:'<path d="M5 1h9v10M2 5h8v10H2z"/>',trash:'<path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10M6 7v4m4-4v4"/>',up:'<path d="m3 10 5-5 5 5"/>',down:'<path d="m3 6 5 5 5-5"/>',star:'<path d="m8 1 2 4.5 5 .6-3.7 3.4 1 5L8 12l-4.3 2.5 1-5L1 6.1l5-.6z"/>',close:'<path d="m3 3 10 10M13 3 3 13"/>',grid:'<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M6 2v12m4-12v12M2 6h12M2 10h12"/>',file:'<path d="M3 1h6l4 4v10H3zM9 1v4h4"/>',chevron:'<path d="m6 3 5 5-5 5"/>',layer:'<path d="m1 5 7-4 7 4-7 4zM1 9l7 4 7-4M1 12l7 4 7-4"/>',check:'<path d="m3 8 3 3 7-7"/>'};
function icon(name){return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${glyphs[name]??glyphs.grid}</svg>`;}
function ib(action,name,key,extra=''){return `<button class="icon-btn" data-action="${action}" title="${esc(t(key))}" aria-label="${esc(t(key))}" ${extra}>${icon(name)}</button>`;}
function tb(action,name,key,extra=''){return `<button class="text-btn" data-action="${action}" ${extra}>${icon(name)}<span>${esc(t(key))}</span></button>`;}
function checkbox(key,text,checked,target='doc'){return `<label class="toggle-row"><span>${esc(text)}</span><input type="checkbox" data-target="${target}" data-key="${key}" ${checked?'checked':''}></label>`;}
function numeric(key,text,value,min,max,step=1,target='params'){return `<div class="field"><div class="field-head"><label for="r-${key}">${esc(text)}</label><input aria-label="${esc(text)}" type="number" data-target="${target}" data-key="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></div><input id="r-${key}" aria-label="${esc(text)}" type="range" data-target="${target}" data-key="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></div>`;}
function colorField(key,text,value,target='layer'){return `<div class="field"><label>${esc(text)}</label><div class="color-field"><input aria-label="${esc(text)}" type="color" data-target="${target}" data-key="${key}" value="${esc(value)}"><input aria-label="${esc(text)} HEX" type="text" data-target="${target}" data-key="${key}" value="${esc(value)}" maxlength="7" pattern="#[a-fA-F0-9]{6}"></div></div>`;}
function details(key,text,content,open=true){return `<details data-section="${key}" ${open?'open':''}><summary>${esc(text)}</summary><div class="detail-content">${content}</div></details>`;}
function defaultThumb(p){if(!thumbs.has(p.id)){const d=createDocument();d.width=d.height=1024;d.transparent=true;d.layers=[createLayer(p.id,`thumb-${p.id}`)];d.layers[0].color='#687354';d.layers[0].secondary='#929e7e';d.layers[0].params={...p.defaults};for(const key of ['strokeWidth','innerWidth','outerWidth'])if(key in d.layers[0].params)d.layers[0].params[key]=Math.min(8,Math.max(5,d.layers[0].params[key]));try{thumbs.set(p.id,`<img src="data:image/svg+xml,${encodeURIComponent(renderSVG(d))}" alt="">`);}catch{thumbs.set(p.id,'');}}return thumbs.get(p.id);}
function renderPatternList(){const items=PATTERNS.filter(p=>(category==='all'||p.category===category)&&(!query||Object.values(p.name).some(n=>n.toLowerCase().includes(query.toLowerCase()))));$('#pattern-list').innerHTML=items.map(p=>`<button class="pattern-card ${active().type===p.id?'active':''}" data-pattern="${p.id}" title="${esc(label(p.description))}" aria-label="${esc(label(p.name))}" aria-pressed="${active().type===p.id}"><div class="thumb" aria-hidden="true">${defaultThumb(p)}</div><span class="name">${esc(label(p.name))}</span></button>`).join('')||`<p class="empty">${esc(t('noResults'))}</p>`;}
function imageModeSelector(layer){return `<select class="image-mode" data-action="image-mode" data-id="${esc(layer.id)}" aria-label="${esc(t('imageMode'))}"><option value="mask" ${layer.mode!=='color'?'selected':''}>${esc(t('imageMaskMode'))}</option><option value="color" ${layer.mode==='color'?'selected':''}>${esc(t('imageColorMode'))}</option></select>`;}
function renderLayers(){
 const current=active();
 $('#layer-list').innerHTML=[...doc.layers].reverse().map((layer,i)=>{
  const mask=isImageMaskLayer(layer),name=layerName(layer),chosen=layer.id===current.id;
  return `<div class="layer ${mask?'image-mask-layer':''} ${chosen?'selected':''}" data-layer-type="${layer.type}"><div class="layer-row"><button class="icon-btn" data-action="visibility" data-id="${esc(layer.id)}" aria-label="${esc(t(layer.visible?'hide':'visible'))}" title="${esc(t(layer.visible?'hide':'visible'))}">${icon(layer.visible?'eye':'eyeOff')}</button><button class="layer-select" data-action="select-layer" data-id="${esc(layer.id)}" title="${esc(name)}">${mask?`<img class="layer-thumbnail" src="${esc(layer.image)}" alt="">`:`<span class="mono">${String(doc.layers.length-i).padStart(2,'0')}</span>`}<span class="layer-name">${esc(name)}</span>${mask?icon('image'):''}</button></div>${mask&&chosen?`<div class="mask-layer-controls">${imageModeSelector(layer)}${layer.mode==='color'?`<p class="helper">${esc(t('colorLayerShort'))}</p>`:`<label for="mask-threshold-mini">${esc(t('threshold'))}<output data-mask-threshold>${layer.threshold}</output></label><input id="mask-threshold-mini" aria-label="${esc(t('threshold'))}" type="range" data-target="layer" data-key="threshold" min="0" max="255" step="1" value="${layer.threshold}"><div class="mask-layer-actions"><button class="text-btn" data-action="mask-auto-threshold">${esc(t('autoThreshold'))}</button><button class="text-btn" data-action="mask-invert" aria-pressed="${layer.invert}">${esc(t('invertShort'))}</button></div>`}</div>`:''}</div>`;
 }).join('');
}
function renderControl(c,l,p){
 const v=l.params[c.key]??p.defaults[c.key];let html;
 if(c.type==='color')html=colorField(c.key,label(c.label),v,'params');
 else if(c.type==='toggle')html=checkbox(c.key,label(c.label),v,'params');
 else if(c.type==='select'){
  const custom=c.key==='shape'&&l.customMotif;
  html=`<div class="field"><div class="field-head"><label for="p-${c.key}">${esc(label(c.label))}</label></div><select id="p-${c.key}" data-target="params" data-key="${c.key}" aria-label="${esc(label(c.label))}">${custom?`<option value="custom" selected disabled>${esc(t('customShape'))}</option>`:''}${c.options.map(o=>`<option value="${esc(o.value)}" ${!custom&&String(v)===String(o.value)?'selected':''}>${esc(label(o.label))}</option>`).join('')}</select>${c.key==='shape'&&SHAPE_PATTERNS.includes(l.type)?`<button class="button shape-library-launch" data-action="shape-library">${icon('grid')}${esc(t('shapeLibrary'))}</button>`:''}</div>`;
 }else html=numeric(c.key,label(c.label),v,c.min,c.max,c.step??1);
 const disabled=(l.type==='contour'&&((c.key.startsWith('shadow')&&!l.params.depth)||(c.key==='strokeWidth'&&l.params.depth)))||l.type==='grid'&&((['dashLength','dashGap'].includes(c.key)&&l.params.lineStyle!=='dashed')||(['diagonalWidth','diagonalStyle','diagonalDashLength','diagonalDashGap'].includes(c.key)&&!l.params.diagonals)||(['diagonalDashLength','diagonalDashGap'].includes(c.key)&&l.params.diagonalStyle!=='dashed'));
 return disabled?`<div class="control-disabled">${html.replace(/<(input|select) /g,'<$1 disabled ')}</div>`:html;
}
function geometryFields(l,p){
 if(l.type==='contour')return `<section class="parameter-group">${p.controls.filter(c=>c.key!=='depth'&&!c.key.startsWith('shadow')).map(c=>renderControl(c,l,p)).join('')}</section><section class="parameter-group"><h2>${esc(t('contourDepth'))}</h2>${p.controls.filter(c=>c.key==='depth'||c.key.startsWith('shadow')).map(c=>renderControl(c,l,p)).join('')}<p class="helper">${esc(t('contourDepthHint'))}</p></section>`;
 if(l.type!=='grid')return p.controls.map(c=>renderControl(c,l,p)).join('');
 const groups=[['mainGrid',['cellSize','strokeWidth','lineStyle','dashLength','dashGap']],['diagonalLines',['diagonals','diagonalWidth','diagonalStyle','diagonalDashLength','diagonalDashGap']],['gapControls',['cornerTrim','centerTrim']],['gridDecorations',['junction','junctionSize','junctionWidth','cornerShape','cornerSize','cornerInset','dots','dotSize','dotSpacing','hatch','hatchWidth','hatchSpacing']]];
 return groups.map(([key,keys])=>`<section class="parameter-group" data-parameter-group="${key}"><h2>${esc(t(key))}</h2>${keys.map(key=>p.controls.find(c=>c.key===key)).filter(Boolean).map(c=>renderControl(c,l,p)).join('')}${key==='gapControls'?`<p class="helper">${esc(t('gapHint'))}</p>`:''}</section>`).join('');
}
function brushControls(){return ['paint','erase'].includes(editMode)?numeric('brushSize',t('brushSize'),brushSize,4,4096,4,'editor'):editMode==='connect'?numeric('linkWidth',t('linkWidth'),active().linkWidth,.25,128,.25,'layer'):'';}
function cellToolbar(){return `<span>${esc(t('editCells'))}</span><select data-action="edit-mode-select" aria-label="${esc(t('editCells'))}">${['toggle','erase','paint','connect'].map(m=>`<option value="${m}" ${m===editMode?'selected':''}>${esc(t(m))}</option>`).join('')}</select>${editMode==='connect'?`<span class="connect-status">${esc(t(connectStart?'connectSecond':'connectFirst'))}</span>`:''}${['paint','erase'].includes(editMode)?`<label class="brush-inline">${esc(t('brushSize'))}<input type="number" data-target="editor" data-key="brushSize" aria-label="${esc(t('brushSize'))}" min="4" max="4096" step="4" value="${brushSize}"></label>`:''}`;}
function setEditMode(mode){finishPointer();editMode=mode;connectStart=null;renderInspector();const bar=$('.cell-edit-bar');if(bar)bar.innerHTML=cellToolbar();updateCanvasCursor();updateConnectGuide();}
function syncCanvasFields(editing=null){for(const key of ['width','height'])for(const input of $$(`[data-target="doc"][data-key="${key}"]`))if(input!==editing)input.value=doc[key];const option=$('#size-preset option[value=custom]');if(option)option.textContent=`${ratioLabel(doc.width,doc.height)} - ${doc.width} × ${doc.height}`;}
function canvasSizeDialog(){
 finishPointer();flush();let draft={width:doc.width,height:doc.height},ratio=doc.aspectRatio?doc.aspectRatio.slice():null;
 const d=dialog(`<div class="eyebrow">C-TextureMaker / Canvas</div><h2>${esc(t('editCanvasSize'))}</h2><p class="helper" id="canvas-ratio">${ratioLabel(draft.width,draft.height)}</p><div class="dimensions">${['width','height'].map(key=>`<label>${esc(t(key))}<input id="canvas-${key}" type="number" min="128" max="4096" step="1" value="${draft[key]}"></label>`).join('')}</div><label class="toggle-row canvas-lock"><span>${esc(t('lockAspect'))}</span><input id="canvas-lock" type="checkbox" ${ratio?'checked':''}></label><div class="modal-footer"><button class="button" data-action="close-dialog">${esc(t('cancel'))}</button><button class="button primary" id="apply-canvas-size">${esc(t('apply'))}</button></div>`);
 const update=(key,finish)=>{const el=$(`#canvas-${key}`,d);if(el.value===''||!Number.isFinite(el.valueAsNumber))return;draft=resizeCanvas(draft.width,draft.height,key,el.valueAsNumber,ratio);for(const axis of ['width','height'])if(axis!==key||finish)$(`#canvas-${axis}`,d).value=draft[axis];$('#canvas-ratio',d).textContent=ratioLabel(draft.width,draft.height);};
 for(const key of ['width','height']){const el=$(`#canvas-${key}`,d);el.oninput=()=>update(key,false);el.onchange=()=>update(key,true);}
 $('#canvas-lock',d).onchange=e=>{ratio=e.target.checked?[draft.width,draft.height]:null;};
 $('#apply-canvas-size',d).onclick=()=>{for(const key of ['width','height']){const el=$(`#canvas-${key}`,d);if(el.value===''||!el.checkValidity()){el.reportValidity();return;}}mutate(()=>{Object.assign(doc,draft,{aspectRatio:ratio});});closeDialog();fit();};
}
function canvasControls(){return details('canvas',t('canvas'),`<div class="field"><label class="field-title" for="size-preset">${esc(t('proportion'))}</label><select class="select-wide" id="size-preset" data-action="size-preset"><option value="custom">${ratioLabel(doc.width,doc.height)} - ${doc.width} × ${doc.height}</option><option value="512,512">1:1 - 512 × 512</option><option value="1024,1024">1:1 - 1024 × 1024</option><option value="2048,2048">1:1 - 2048 × 2048</option><option value="1920,1080">16:9 - 1920 × 1080</option><option value="1080,1920">9:16 - 1080 × 1920</option></select></div><div class="dimensions"><label>${esc(t('width'))}<input type="number" min="128" max="4096" step="1" data-target="doc" data-key="width" value="${doc.width}"></label><label>${esc(t('height'))}<input type="number" min="128" max="4096" step="1" data-target="doc" data-key="height" value="${doc.height}"></label></div><div style="height:15px"></div><label class="toggle-row"><span>${esc(t('lockAspect'))}</span><input type="checkbox" data-action="aspect-lock" ${doc.aspectRatio?'checked':''}></label>${checkbox('transparent',t('transparent'),doc.transparent)}${colorField('background',t('background'),doc.background,'doc')}${checkbox('seamless',t('seamless'),doc.seamless)}<p class="helper">${esc(t('seamlessHint'))}</p>${numeric('seed',t('seed'),doc.seed,1,999999,1,'doc')}`,true);}
function renderMaskInspector(savedSections=null){
 const l=active(),openSections=savedSections??new Map($$('.inspector details').map(el=>[el.dataset.section,el.open]));
 $('#inspector').innerHTML=`<div class="inspector-head"><div class="eyebrow">${esc(t('imageMask'))}</div><h1 class="mask-name">${esc(l.name)}</h1><p>${esc(t('maskScope'))}</p><div class="actions"><button class="button" data-action="mask-replace" title="${esc(t('maskFormats'))}">${icon('image')}${esc(t('replaceImage'))}</button>${ib('mask-rename','pencil','rename')}${ib('save-preset','star','savePreset')}</div></div>${details('mask',t('imageMode'),`<div class="mask-source-preview"><img src="${esc(l.image)}" alt="${esc(l.name)}"></div><p class="helper image-source-size">${esc(t('originalSize'))} <strong class="mono">${l.imageWidth} × ${l.imageHeight} px</strong> · ${ratioLabel(l.imageWidth,l.imageHeight)}</p>${imageModeSelector(l)}${l.mode==='color'?`<p class="helper">${esc(t('imageColorHint'))}</p>`:`${numeric('threshold',t('threshold'),l.threshold,0,255,1,'layer')}<button class="button mask-auto" data-action="mask-auto-threshold">${esc(t('autoThreshold'))}</button>${checkbox('invert',t('invertImage'),l.invert,'layer')}<p class="helper">${esc(t('maskThresholdHint'))}</p>`}`)}${details('mask-transform',t('maskTransform'),`<div class="field"><label for="mask-fit">${esc(t('imageFit'))}</label><select id="mask-fit" class="select-wide" data-target="layer" data-key="fit"><option value="contain" ${l.fit==='contain'?'selected':''}>${esc(t('containImage'))}</option><option value="cover" ${l.fit==='cover'?'selected':''}>${esc(t('coverImage'))}</option></select></div>${numeric('scale',t('scale'),l.scale,.05,8,.01,'layer')}${numeric('rotation',t('rotation'),l.rotation,-180,180,1,'layer')}${numeric('offsetX',t('offsetX'),l.offsetX,-Math.max(doc.width,Math.abs(l.offsetX)),Math.max(doc.width,Math.abs(l.offsetX)),1,'layer')}${numeric('offsetY',t('offsetY'),l.offsetY,-Math.max(doc.height,Math.abs(l.offsetY)),Math.max(doc.height,Math.abs(l.offsetY)),1,'layer')}${checkbox('flipX',t('flipX'),l.flipX,'layer')}${checkbox('flipY',t('flipY'),l.flipY,'layer')}<button class="button" data-action="mask-reset-transform">${icon('reset')}${esc(t('resetImageTransform'))}</button><p class="helper">${esc(t('maskDragHint'))}</p>`)}${canvasControls()}`;
 for(const el of $$('.inspector details'))if(openSections.has(el.dataset.section))el.open=openSections.get(el.dataset.section);
}
function renderInspector(savedSections=null){const l=active();if(isImageMaskLayer(l)){renderMaskInspector(savedSections);return;}const p=pattern(l.type);const openSections=savedSections??new Map($$('.inspector details').map(el=>[el.dataset.section,el.open]));
 const fields=geometryFields(l,p);
 const palettes=[['#34392e','#97a184'],['#151515','#868686'],['#f0ebdd','#9b927e'],['#e3edcd','#839968'],['#66789a','#b7c5df'],['#c16a46','#e6ac83'],['#916b80','#d9b2c7']];
 let extra='';if(['dots','polygons'].includes(l.type))extra=details('cells',t('editCells'),`<div class="cell-modes">${['toggle','erase','paint','connect'].map(m=>`<button data-action="edit-mode" data-mode="${m}" class="${editMode===m?'active':''}">${esc(t(m))}</button>`).join('')}</div>${brushControls()}<p class="helper">${esc(t(editMode==='connect'?'connectHint':'cellHint'))}</p><div class="cell-extra-actions"><button class="button primary" data-action="add-image-mask">${icon('image')}${esc(t('addImageMask'))}</button><button class="button" data-action="restore-cells">${esc(t('restoreCells'))}</button><button class="button" data-action="clear-links" ${l.cellLinks?.length?'':'disabled'}>${esc(t('clearLinks'))}</button></div>`);
 if(l.type==='halftone')extra=details('import',t('uploadMask'),`<div class="import-buttons"><button class="button" data-action="import-mask">${icon('plus')}${esc(t('uploadMask'))}</button>${l.mask?`<button class="button" data-action="clear-mask">${icon('close')}${esc(t('clearMask'))}</button>`:''}</div><p class="helper">${esc(t('importHint'))}</p>`,false);
 $('#inspector').innerHTML=`<div class="inspector-head"><div class="eyebrow">${esc(t('properties'))}<span class="mono" style="float:right">${String(PATTERNS.indexOf(p)+1).padStart(2,'0')} / ${PATTERNS.length}</span></div><h1>${esc(label(p.name))}</h1><p>${esc(label(p.description))}</p><div class="actions"><button class="button" data-action="random">${icon('random')}${esc(t('random'))}</button>${ib('reset','reset','reset')}${ib('save-preset','star','savePreset')}</div></div>${details('geometry',t('geometry'),fields+(l.type==='barcode'?`<p class="helper">${esc(t('decorative'))}</p>`:''))}${extra}${details('appearance',t('appearance'),`<div class="field-pair">${colorField('color',t('color'),l.color)}${colorField('secondary',t('secondary'),l.secondary)}</div>${l.customMotif?`${checkbox('motifTint',t('motifTint'),l.motifTint,'layer')}<p class="helper">${esc(t('motifTintHint'))}</p>`:''}${numeric('opacity',t('opacity'),l.opacity,0,1,.01,'layer')}<div class="swatches">${palettes.map(([a,b])=>`<button class="swatch" data-action="palette" data-color="${a}" data-secondary="${b}" style="background:${a};--swatch-b:${b}" aria-label="${a} / ${b}" title="${a} / ${b}"></button>`).join('')}</div><button class="button image-color-launch" data-action="add-color-image">${icon('image')}${esc(t('importImageColors'))}</button>`)}${details('transform',t('transform'),numeric('rotation',t('rotation'),l.rotation,-180,180,1,'layer')+numeric('scale',t('scale'),l.scale,.1,2,.01,'layer')+numeric('offsetX',t('offsetX'),l.offsetX,-doc.width,doc.width,1,'layer')+numeric('offsetY',t('offsetY'),l.offsetY,-doc.height,doc.height,1,'layer'),false)}${canvasControls()}`;
 for(const el of $$('.inspector details'))if(openSections.has(el.dataset.section))el.open=openSections.get(el.dataset.section);
}
function renderApp(){finishPointer();motionRun?.cancel();const sections=new Map($$('.inspector details').map(el=>[el.dataset.section,el.open]));const listScroll=$('#pattern-list')?.scrollTop??0,inspectorScroll=$('#pattern-list .active')?.dataset.pattern===active().type?($('#inspector')?.scrollTop??0):0;document.documentElement.lang={zh:'zh-Hant',en:'en',ja:'ja'}[lang];document.documentElement.dataset.theme=prefs.theme==='dark'?'dark':'light';$('#app').innerHTML=`<header class="topbar"><div class="brand"><img src="icon.svg" alt=""><span>C-TextureMaker</span><small>1.5.0</small></div><button class="document-name text-btn" data-action="rename" title="${esc(t('rename'))}">${icon('file')}<span>${esc(doc.name)}</span><small id="project-dirty" hidden title="${esc(t('unsaved'))}" aria-label="${esc(t('unsaved'))}">●</small></button><div class="top-actions">${ib('new','plus','newDoc')}${tb('open','open','open')}<div class="save-control">${tb('save','save','save')}<button class="icon-btn save-arrow" data-action="save-menu" aria-label="${esc(t('saveOptions'))}" title="${esc(t('saveOptions'))}" aria-expanded="false" aria-controls="save-menu">${icon('down')}</button><div id="save-menu" class="save-menu" hidden><button class="text-btn" data-action="save-as">${icon('save')}<span>${esc(t('saveAs'))}</span><kbd>Ctrl+Shift+S</kbd></button></div></div><span class="divider"></span>${ib('undo','undo','undo',past.length?'':'disabled')}${ib('redo','redo','redo',future.length?'':'disabled')}<span class="divider"></span>${ib('theme',prefs.theme==='dark'?'sun':'moon','theme')}<select class="language-select" data-action="language" aria-label="${esc(t('language'))}"><option value="zh" ${lang==='zh'?'selected':''}>繁體中文</option><option value="en" ${lang==='en'?'selected':''}>English</option><option value="ja" ${lang==='ja'?'selected':''}>日本語</option></select>${ib('help','help','help')}<button class="button primary export-top" data-action="export">${icon('export')}${esc(t('export'))}</button></div></header><main class="workspace ${focus?'focus':''}"><aside class="library" aria-label="${esc(t('library'))}"><div class="library-head"><div class="section-title">${esc(t('library'))}<span class="mono">${PATTERNS.length}</span></div><label class="search-box">${icon('search')}<input id="pattern-search" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}" value="${esc(query)}"></label><nav class="category-tabs">${['all','radial','pattern','organic','technical'].map(c=>`<button data-action="category" data-category="${c}" class="${category===c?'active':''}">${esc(t(c))}</button>`).join('')}</nav></div><div id="pattern-list" class="pattern-list"></div><div class="library-bottom"><div class="section-title">${esc(t('layers'))}<div class="layer-add-actions">${ib('add-image-mask','image','addImageMask')}${ib('add-layer','plus','addLayer')}</div></div><div id="layer-list" class="layer-list"></div><div class="layer-tools">${ib('layer-up','up','moveUp')}${ib('layer-down','down','moveDown')}${ib('duplicate','copy','duplicate')}${ib('delete','trash','remove')}</div></div><button class="preset-launch" data-action="presets">${icon('star')}<span>${esc(t('presets'))}</span>${icon('chevron')}</button></aside><section class="stage" aria-label="${esc(t('canvas'))}"><div class="stage-header"><span class="art-title" id="art-title">${esc(layerName(active()))}</span><button class="mono canvas-size-button" id="dimensions-label" data-action="canvas-size" title="${esc(t('editCanvasSize'))}" aria-label="${esc(t('editCanvasSize'))}">${doc.width} × ${doc.height}</button><div class="views"><button data-action="view-single" class="${repeat===1?'active':''}">${esc(t('single'))}</button><button data-action="view-repeat" class="${repeat===3?'active':''}">${esc(t('repeat'))}</button></div>${ib('edges','grid','tileEdges')}</div><div class="viewport" id="viewport" data-canvas-tool="${canvasTool}"><div id="brush-cursor" class="brush-cursor" hidden></div><svg id="connect-guide" class="connect-guide" aria-hidden="true" hidden><line/><circle r="6"/></svg><div class="stage-status">${esc(t('live'))}</div><div class="artboard-wrap" id="artboard-wrap"><div class="artboard-label" id="artboard-label"></div><div class="artboard" id="artboard"></div><div id="tile-grid" class="tile-grid" hidden></div><svg id="mask-overlay" class="mask-overlay" aria-label="${esc(t('maskTransform'))}" hidden></svg></div>${['dots','polygons'].includes(active().type)?`<div class="cell-edit-bar">${cellToolbar()}</div>`:''}</div><div class="stage-foot"><span class="stage-caption">${esc(t('vector'))}</span><div class="zoom-controls">${ib('tool-cursor','cursor','cursorTool',`aria-pressed="${canvasTool==='cursor'}"`)}${ib('tool-hand','hand','handTool',`aria-pressed="${canvasTool==='hand'}"`)}<span class="divider"></span>${ib('zoom-out','minus','zoomOut')}<span id="zoom-label" class="mono">100%</span>${ib('zoom-in','plus','zoomIn')}<span class="divider"></span>${ib('fit','fit','fit')}</div><div class="stage-focus">${ib('focus','expand',focus?'showPanel':'hidePanel')}</div></div></section><aside class="inspector" id="inspector" aria-label="${esc(t('properties'))}"></aside></main><footer class="statusbar"><span class="local-dot"></span><span>${esc(t('offline'))}</span><span class="line"></span><span id="save-status">${esc(t(saveState))}</span><span class="right"><span class="canvas-help">${esc(t('canvasHint'))}</span><span id="render-time" class="mono"></span><button type="button" id="alpha-status" class="pill alpha-status-toggle" data-action="toggle-alpha" aria-pressed="${doc.transparent}" aria-label="${esc(t(doc.transparent?'alphaStatusTransparent':'alphaStatusSolid'))}" title="${esc(t(doc.transparent?'alphaStatusTransparent':'alphaStatusSolid'))}">${esc(t(doc.transparent?'alpha':'solid'))}</button></span></footer>`;
 if(nativeHost){$('.topbar').insertAdjacentHTML('beforeend',`<div class="window-controls">${ib('window-minimize','minus','minimize')}${ib('window-maximize','windowMaximize','maximize')}${ib('window-close','close','closeWindow')}</div>`);updateWindowState(windowMaximized);nativeHost.postMessage({type:'window',action:'theme',theme:prefs.theme==='dark'?'dark':'light'});nativeHost.postMessage({type:'window',action:'state'});}
 renderPatternList();renderLayers();renderInspector(sections);renderPreview();syncDirty();bindViewport();updateCanvasCursor();$('#pattern-list').scrollTop=listScroll;$('#inspector').scrollTop=inspectorScroll;
}
function updateWindowState(maximized){windowMaximized=Boolean(maximized);const button=$('[data-action=window-maximize]');if(button){button.innerHTML=icon(windowMaximized?'windowRestore':'windowMaximize');button.title=t(windowMaximized?'restoreWindow':'maximize');button.setAttribute('aria-label',button.title);}}
function isDirty(){return savedSnapshot===null||JSON.stringify(doc)!==savedSnapshot;}
function syncDirty(){const dirty=isDirty(),mark=$('#project-dirty');if(mark)mark.hidden=!dirty;document.documentElement.dataset.projectDirty=String(dirty);}
function syncHistory(){syncDirty();const u=$('[data-action=undo]'),r=$('[data-action=redo]');if(u)u.disabled=!past.length;if(r)r.disabled=!future.length;}
function push(before){if(JSON.stringify(doc)===before)return;past.push(before);let budget=past.reduce((n,s)=>n+s.length,0);while(past.length>1&&(past.length>60||budget>24*1024*1024))budget-=past.shift().length;future=[];syncHistory();autosave();}
function flush(){if(pendingBefore!==null){const b=pendingBefore;pendingBefore=null;push(b);}}
function mutate(fn,render=true){finishPointer();flush();connectStart=null;const before=JSON.stringify(doc);fn();push(before);if(render)renderApp();else schedulePreview();}
function historyMove(direction){finishPointer();flush();connectStart=null;const from=direction==='undo'?past:future,to=direction==='undo'?future:past;if(!from.length)return;to.push(JSON.stringify(doc));doc=JSON.parse(from.pop());if(!doc.layers.some(l=>l.id===selected))selected=doc.layers[0].id;renderApp();autosave();}
function setSaveState(key){saveState=key;const status=$('#save-status');if(status)status.textContent=t(key);}
function queueAutosave(snapshot,version){const write=()=>persistentStorage.setRecord('autosave',snapshot),task=autosaveQueue.then(write,write);autosaveQueue=task.then(()=>undefined,()=>undefined);task.then(okay=>{if(version===autosaveSequence)setSaveState(okay?'autosaved':'autosaveFailed');},()=>{if(version===autosaveSequence)setSaveState('autosaveFailed');});}
function autosave(){syncDirty();if(!storageReady)return;clearTimeout(saveTimer);const version=++autosaveSequence;setSaveState('saving');saveTimer=setTimeout(()=>{saveTimer=0;queueAutosave(clone(doc),version);},350);}
function persistAutosaveNow(){clearTimeout(saveTimer);saveTimer=0;if(!storageReady)return;const version=++autosaveSequence;setSaveState('saving');queueAutosave(clone(doc),version);}
function toast(key,raw=false){clearTimeout(toastTimer);const el=$('#toast');el.textContent=raw?key:t(key);el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function schedulePreview(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;renderPreview();});}
function renderPreview(){const start=performance.now(),rgb=activePattern().color.slice(1).match(/../g).map(v=>parseInt(v,16)),bright=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>160;$('#artboard').style.setProperty('--checker1',bright?'#424242':'#ffffff');$('#artboard').style.setProperty('--checker2',bright?'#373737':'#f0f0f0');try{$('#artboard').innerHTML=renderSVG(doc,{preview:true,repeat});}catch(e){console.error(e);toast('exportError');return;}const elapsed=performance.now()-start;$('#render-time').textContent=`${Math.round(elapsed)} ms`;$('#dimensions-label').textContent=`${doc.width} × ${doc.height}`;$('#artboard-label').textContent=`${doc.width} × ${doc.height}${repeat===3?' / 3 × 3':''} · ${doc.seamless?t('seamless'):t('single')}`;const alphaStatus=$('#alpha-status'),alphaStatusTitle=t(doc.transparent?'alphaStatusTransparent':'alphaStatusSolid');alphaStatus.textContent=t(doc.transparent?'alpha':'solid');alphaStatus.setAttribute('aria-pressed',String(doc.transparent));alphaStatus.setAttribute('aria-label',alphaStatusTitle);alphaStatus.title=alphaStatusTitle;$('#tile-grid').hidden=!(repeat===3&&tileEdges);fitLayout();}
function fitLayout(){const vp=$('#viewport');if(!vp)return;const rect=vp.getBoundingClientRect(),base=Math.min((rect.width-82)/(doc.width*repeat),(rect.height-76)/(doc.height*repeat));const unit=Math.max(.025,base)*zoom;const art=$('#artboard'),wrap=$('#artboard-wrap');art.style.width=`${doc.width*repeat*unit}px`;art.style.height=`${doc.height*repeat*unit}px`;wrap.style.transform=`translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px))`;$('#zoom-label').textContent=`${Math.round(unit*100)}%`;if(lastCanvasPoint)updateBrushCursor(lastCanvasPoint);updateConnectGuide();updateMaskOverlay();}
function fit(){finishPointer();zoom=1;pan={x:0,y:0};fitLayout();}
window.addEventListener('resize',fitLayout);

document.addEventListener('input',e=>{if(!storageReady)return;const el=e.target;if(el.id==='pattern-search'){query=el.value;renderPatternList();return;}if(!el.dataset.target)return;setField(el,false);});
document.addEventListener('change',e=>{if(!storageReady)return;const el=e.target;if(el.dataset.target){setField(el,true);return;}if(el.dataset.action==='language'){lang=el.value;t=translator(lang);prefs.lang=lang;store.set('ctm.preferences',prefs);renderApp();}if(el.dataset.action==='size-preset'&&el.value!=='custom'){const [w,h]=el.value.split(',').map(Number);mutate(()=>{doc.width=w;doc.height=h;if(doc.aspectRatio)doc.aspectRatio=[w,h];});fit();}if(el.dataset.action==='edit-mode-select')setEditMode(el.value);if(el.dataset.action==='image-mode')setImageMode(el.dataset.id,el.value);if(el.dataset.action==='aspect-lock')mutate(()=>{doc.aspectRatio=el.checked?[doc.width,doc.height]:null;});});
function setField(el,finish){
 if(el.dataset.target==='editor'){
  if(el.value===''||!Number.isFinite(el.valueAsNumber))return;
  brushSize=clamp(Math.round(el.valueAsNumber/4)*4,4,4096);
  $$('[data-target="editor"][data-key="brushSize"]').forEach(other=>{if(other!==el||finish)other.value=brushSize;});
  if(finish){prefs.brushSize=brushSize;store.set('ctm.preferences',prefs);}if(lastCanvasPoint)updateBrushCursor(lastCanvasPoint);return;
 }
 const key=el.dataset.key,target=el.dataset.target,obj=target==='doc'?doc:target==='layer'?active():active().params;let v;
 if(el.type==='checkbox')v=el.checked;else if(el.type==='range'||el.type==='number'){if(el.value===''||!Number.isFinite(el.valueAsNumber))return;const step=Number(el.step)||1;v=clamp(Math.round(el.valueAsNumber/step)*step,Number(el.min),Number(el.max));v=Number(v.toFixed(4));}else {v=el.value;if(['color','secondary','background','shadowColor'].includes(key)&&!/^#[0-9a-f]{6}$/i.test(v)){if(finish)el.value=obj[key];return;}if(target==='params'){const c=pattern(active().type).controls.find(c=>c.key===key);const option=c?.options?.find(o=>String(o.value)===v);if(option)v=option.value;}}
 if(pendingBefore===null)pendingBefore=JSON.stringify(doc);connectStart=null;if(target==='params'&&key==='shape')active().customMotif=null;if(target==='doc'&&['width','height'].includes(key)){Object.assign(doc,resizeCanvas(doc.width,doc.height,key,v,doc.aspectRatio));syncCanvasFields(finish?null:el);v=doc[key];}else obj[key]=v;syncDirty();
 if(isImageMaskLayer(active())){for(const output of $$('[data-mask-threshold]'))output.textContent=active().threshold;for(const button of $$('[data-action=mask-invert]'))button.setAttribute('aria-pressed',String(active().invert));}
 $$(`[data-target="${target}"][data-key="${key}"]`).forEach(other=>{if(other!==el){if(other.type==='checkbox')other.checked=v;else other.value=v;}});schedulePreview();if(finish){flush();if(target==='params'&&(el.tagName==='SELECT'||el.type==='checkbox'||key==='diagonals'))renderInspector();if(target==='doc'&&['width','height'].includes(key))fit();}
}

document.addEventListener('click',async e=>{if(!storageReady)return;const card=e.target.closest('[data-pattern]');if(card){const type=card.dataset.pattern;mutate(()=>{const l=activePattern(),fresh=switchLayerPattern(l,type);doc.layers[doc.layers.indexOf(l)]=fresh;selected=fresh.id;lastPatternId=selected;});return;}
 if(!e.target.closest('.save-control'))closeSaveMenu();
 const b=e.target.closest('[data-action]');if(!b||b.tagName==='SELECT')return;const a=b.dataset.action;
 if(a.startsWith('window-')){if(!nativeHost)return;nativeHost.postMessage({type:'window',action:a.slice(7)});}
 else if(a==='category'){category=b.dataset.category;$$('.category-tabs button').forEach(el=>el.classList.toggle('active',el===b));renderPatternList();}
 else if(a==='theme'){prefs.theme=prefs.theme==='dark'?'light':'dark';store.set('ctm.preferences',prefs);renderApp();}
 else if(a==='toggle-alpha'){mutate(()=>{doc.transparent=!doc.transparent;});$('#alpha-status').focus({preventScroll:true});}
 else if(a==='undo'||a==='redo')historyMove(a);
 else if(a==='save'||a==='save-as'){closeSaveMenu();await saveProject(a==='save-as');}
 else if(a==='save-menu'){const menu=$('#save-menu'),show=menu.hidden;menu.hidden=!show;b.setAttribute('aria-expanded',String(show));if(show)$('button',menu).focus();}
 else if(a==='external'&&nativeHost){e.preventDefault();try{await projectFiles.openExternal(b.dataset.target);}catch{toast('externalFailed');}}
 else if(a==='add-color-image')chooseImageMask(null,'color');
 else if(a==='open')await openProject();
 else if(a==='new')await newProject();
 else if(a==='canvas-size')canvasSizeDialog();
 else if(a==='rename')nameDialog('projectName',doc.name,name=>mutate(()=>{doc.name=name;}));
 else if(a==='export')exportDialog();
 else if(a==='help')helpDialog();
 else if(a==='close-dialog')closeDialog();
 else if(a==='random')mutate(()=>{doc.seed=1+Math.floor(Math.random()*999998);const l=active();if(!['contour','barcode','ticks','rays'].includes(l.type)){const cs=pattern(l.type).controls.filter(c=>c.type==='range'&&c.key!=='strokeWidth'&&!/color/i.test(c.key));for(const c of cs.slice(0,3)){const step=c.step??1,base=pattern(l.type).defaults[c.key],randomMax=base>c.min?Math.min(c.max,c.min+(base-c.min)*2.5):c.max,span=randomMax-c.min;l.params[c.key]=clamp(Math.round((c.min+span*(.15+Math.random()*.65))/step)*step,c.min,c.max);}}});
 else if(a==='reset')mutate(()=>{const l=active(),fresh=resetLayerPattern(l);doc.layers[doc.layers.indexOf(l)]=fresh;});
 else if(a==='view-single'||a==='view-repeat'){repeat=a==='view-single'?1:3;fit();renderApp();}
 else if(a==='edges'){tileEdges=!tileEdges;$('#tile-grid').hidden=!(repeat===3&&tileEdges);}
 else if(a==='zoom-in'||a==='zoom-out'){zoom=clamp(zoom*(a==='zoom-in'?1.2:1/1.2),.1,12);fitLayout();}
 else if(a==='fit')fit();
 else if(a==='tool-cursor'||a==='tool-hand'){finishPointer();canvasTool=a==='tool-hand'?'hand':'cursor';updateCanvasCursor();}
 else if(a==='focus'){focus=!focus;renderApp();fit();}
 else if(a==='select-layer'){finishPointer();flush();selected=b.dataset.id;if(!isImageMaskLayer(active()))lastPatternId=selected;connectStart=null;renderApp();}
 else if(a==='visibility')mutate(()=>{const l=doc.layers.find(l=>l.id===b.dataset.id);l.visible=!l.visible;});
 else if(a==='add-layer'||a==='duplicate'){if(doc.layers.length>=16){toast('maxLayers');return;}mutate(()=>{const source=activePattern(),l=a==='duplicate'?clone(active()):createLayer(source.type,uid());l.id=uid();if(!isImageMaskLayer(l)){l.color=source.color;l.secondary=source.secondary;}doc.layers.push(l);selected=l.id;if(!isImageMaskLayer(l))lastPatternId=l.id;});}
 else if(a==='delete'){if(!isImageMaskLayer(active())&&doc.layers.filter(l=>!isImageMaskLayer(l)).length===1){toast('lastLayer');return;}mutate(()=>{doc.layers=doc.layers.filter(l=>l.id!==selected);selected=doc.layers.at(-1).id;});}
 else if(a==='layer-up'||a==='layer-down')mutate(()=>{const i=doc.layers.indexOf(active()),j=i+(a==='layer-up'?1:-1);if(j>=0&&j<doc.layers.length)[doc.layers[i],doc.layers[j]]=[doc.layers[j],doc.layers[i]];});
 else if(a==='palette')mutate(()=>{active().color=b.dataset.color;active().secondary=b.dataset.secondary;});
 else if(a==='presets')presetsDialog();
 else if(a==='save-preset')nameDialog('presetName',layerName(active()),name=>{const arr=[...savedPresets,createUserPreset(doc,selected,{id:uid(),name})].slice(-40);persistPresets(arr).then(okay=>toast(okay?'presetSaved':'saveFailed'));});
 else if(a==='preset'){const p=allPresets().find(p=>p.id===b.dataset.id);if(!p)return;try{const result=applyUserPreset(doc,selected,p,uid());mutate(()=>{doc=result.document;selected=result.selectedId;if(!isImageMaskLayer(active()))lastPatternId=selected;});closeDialog();}catch{toast('presetInvalid');}}
 else if(a==='remove-preset'){e.stopPropagation();const arr=savedPresets.filter(p=>p.id!==b.dataset.id);if(await persistPresets(arr))presetsDialog();else toast('saveFailed');}
 else if(a==='edit-mode')setEditMode(b.dataset.mode);
 else if(a==='restore-cells')mutate(()=>{active().hiddenCells=[];});
 else if(a==='clear-links')mutate(()=>{active().cellLinks=[];});
 else if(a==='add-image-mask'||a==='mask-replace')chooseImageMask(a==='mask-replace'?selected:null);
 else if(a==='mask-auto-threshold')await resetMaskThreshold();
 else if(a==='mask-invert')mutate(()=>{active().invert=!active().invert;});
 else if(a==='mask-rename'){const layer=active();nameDialog('rename',layer.name,name=>{if(doc.layers.includes(layer))mutate(()=>{layer.name=name;});});}
 else if(a==='mask-reset-transform')mutate(()=>{Object.assign(active(),{fit:'contain',scale:1,rotation:0,offsetX:0,offsetY:0,flipX:false,flipY:false});});
 else if(a==='shape-library')shapeLibraryDialog();
 else if(a==='import-shape'||a==='import-mask'){imageTarget=a==='import-shape'?'customMotif':'mask';$('#file-image').click();}
 else if(a==='use-shape'){const shape=sharedShapes.find(s=>s.id===b.dataset.id);if(shape&&SHAPE_PATTERNS.includes(active().type)){mutate(()=>{active().customMotif=shape.data;});closeDialog();}}
 else if(a==='remove-shape'){try{await updateShapeLibrary(library=>({library:removeShape(library,b.dataset.id)}));shapeLibraryDialog();}catch(error){shapeError(error);}}
 else if(a==='rename-shape'){const shape=sharedShapes.find(s=>s.id===b.dataset.id);if(shape)nameDialog('renameShape',shape.name,async name=>{try{await updateShapeLibrary(library=>({library:renameShape(library,shape.id,name)}));shapeLibraryDialog();}catch(error){shapeError(error);}});}
 else if(a==='add-current-shape'){try{const data=active().customMotif;await updateShapeLibrary(library=>addShape(library,{id:uid(),name:t('customShape'),data}));shapeLibraryDialog();}catch(error){shapeError(error);}}
 else if(a==='clear-motif'||a==='clear-mask'){mutate(()=>{active()[a==='clear-motif'?'customMotif':'mask']=null;});if(a==='clear-motif')closeDialog();}
 else if(a==='replay'){closeDialog();playEntrance();}
});

let space=false,pointer=null,lastCanvasPoint=null;
const editableCells=()=>repeat===1&&active().visible&&['dots','polygons'].includes(active().type);
const brushMode=()=>['paint','erase'].includes(editMode);
function canvasUnit(){return $('#artboard').getBoundingClientRect().width/(doc.width*repeat);}
function updateCanvasCursor(){
 const vp=$('#viewport');if(!vp)return;
 vp.dataset.canvasTool=space?'hand':canvasTool;vp.dataset.cellEditing=String(editableCells());vp.dataset.brush=String(brushMode());
 for(const tool of ['cursor','hand'])$(`[data-action="tool-${tool}"]`)?.setAttribute('aria-pressed',String(canvasTool===tool));
 if(lastCanvasPoint)updateBrushCursor(lastCanvasPoint);
 updateConnectGuide();
}
function updateConnectGuide(){
 const guide=$('#connect-guide');if(!guide)return;
 const show=Boolean(connectStart&&editMode==='connect'&&editableCells()&&canvasTool==='cursor'&&!space);
 guide.toggleAttribute('hidden',!show);
 const status=$('.connect-status');if(status)status.textContent=t(connectStart?'connectSecond':'connectFirst');
 if(!show)return;
 const vp=$('#viewport').getBoundingClientRect(),art=$('#artboard').getBoundingClientRect();
 const x=art.left-vp.left+connectStart.x*art.width,y=art.top-vp.top+connectStart.y*art.height;
 const circle=$('circle',guide),line=$('line',guide);
 circle.setAttribute('cx',x);circle.setAttribute('cy',y);
 line.setAttribute('x1',x);line.setAttribute('y1',y);
 line.setAttribute('x2',lastCanvasPoint?lastCanvasPoint.clientX-vp.left:x);line.setAttribute('y2',lastCanvasPoint?lastCanvasPoint.clientY-vp.top:y);
}
function updateBrushCursor(point){
 const ring=$('#brush-cursor'),vp=$('#viewport');if(!ring||!vp)return;
 const art=$('#artboard').getBoundingClientRect(),inside=point.clientX>=art.left&&point.clientX<=art.right&&point.clientY>=art.top&&point.clientY<=art.bottom;
 ring.hidden=!(inside&&editableCells()&&brushMode()&&canvasTool==='cursor'&&!space&&pointer?.mode!=='pan');
 if(ring.hidden)return;
 const rect=vp.getBoundingClientRect(),size=brushSize*canvasUnit();ring.style.width=ring.style.height=`${size}px`;ring.style.left=`${point.clientX-rect.left}px`;ring.style.top=`${point.clientY-rect.top}px`;
}
function finishPointer(){
 const state=pointer;pointer=null;if(!state)return;
 if(state.mode==='cell'||state.mode==='mask')push(state.before);
 state.viewport.classList.remove('panning');if(state.viewport.hasPointerCapture(state.id))state.viewport.releasePointerCapture(state.id);
}
function captureCellCenters(){
 const cells=[],matrices=new Map(),rect=$('#artboard').getBoundingClientRect(),margin=brushSize*canvasUnit()/2+32;
 for(const el of $$('#artboard [data-cell]')){
  if(el.dataset.layer!==selected||!el.hasAttribute('data-cx')||!el.hasAttribute('data-cy'))continue;
  let matrix;
  if(el.hasAttribute('transform'))matrix=el.getScreenCTM();
  else{const parent=el.parentElement;if(!matrices.has(parent))matrices.set(parent,parent.getScreenCTM());matrix=matrices.get(parent);}
  if(!matrix)continue;
  const cx=Number(el.dataset.cx),cy=Number(el.dataset.cy),x=matrix.a*cx+matrix.c*cy+matrix.e,y=matrix.b*cx+matrix.d*cy+matrix.f;
  if(Number.isFinite(x)&&Number.isFinite(y)&&x>=rect.left-margin&&x<=rect.right+margin&&y>=rect.top-margin&&y<=rect.bottom+margin)cells.push({id:el.dataset.cell,x,y});
 }
 return cells;
}
function applyCellIds(ids){
 const l=active(),hidden=new Set(l.hiddenCells),mode=pointer.editMode;
 for(const id of ids){
  if(pointer.seen.has(id))continue;pointer.seen.add(id);
  if(mode==='connect'){
   if(!connectStart){
    const center=pointer.cells.filter(cell=>cell.id===id).sort((a,b)=>Math.hypot(a.x-pointer.last.x,a.y-pointer.last.y)-Math.hypot(b.x-pointer.last.x,b.y-pointer.last.y))[0],rect=$('#artboard').getBoundingClientRect();
    if(center)connectStart={id,x:(center.x-rect.left)/rect.width,y:(center.y-rect.top)/rect.height};
    updateConnectGuide();continue;
   }
   const from=connectStart.id;connectStart=null;
   if(from!==id){
    const index=l.cellLinks.findIndex(link=>(link.from===from&&link.to===id)||(link.from===id&&link.to===from));
    if(index>=0)l.cellLinks.splice(index,1);
    else if(l.cellLinks.length>=2000)toast('linksFull');
    else{l.cellLinks.push({from,to:id});hidden.delete(from);hidden.delete(id);}
    const clear=$('[data-action="clear-links"]');if(clear)clear.disabled=!l.cellLinks.length;
    schedulePreview();
   }
   updateConnectGuide();
  }else if(mode==='erase')hidden.add(id);else if(mode==='paint')hidden.delete(id);else if(hidden.has(id))hidden.delete(id);else hidden.add(id);
 }
 const next=[...hidden];if(next.length!==l.hiddenCells.length||next.some((id,i)=>id!==l.hiddenCells[i])){l.hiddenCells=next;schedulePreview();}
}
function editAt(e,first=false){
 const point={x:e.clientX,y:e.clientY};
 if(['paint','erase'].includes(pointer.editMode))applyCellIds(strokeHits(pointer.cells,pointer.last,point,pointer.radius));
 else if(first||pointer.editMode==='toggle'){
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cell]');
  const id=target?.dataset.layer===selected?target.dataset.cell:nearestCell(pointer.cells,point,pointer.tolerance);if(id)applyCellIds([id]);
 }
 pointer.last=point;
}
window.addEventListener('keydown',e=>{
 if(motionRun||!storageReady||e.isComposing||$('dialog[open]'))return;
 const mod=e.ctrlKey||e.metaKey;
 if(mod&&['s','o','e'].includes(e.key.toLowerCase())){e.preventDefault();finishPointer();if(e.key.toLowerCase()==='s')saveProject(e.shiftKey);else if(e.key.toLowerCase()==='o')openProject();else exportDialog();return;}
 if(e.target.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
 if(e.code==='Space'&&e.target.tagName==='BUTTON'&&!$('#viewport')?.matches(':hover'))return;
 if(mod&&['z','y','s','o','e'].includes(e.key.toLowerCase()))finishPointer();
 if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();historyMove(e.shiftKey?'redo':'undo');}
 else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();historyMove('redo');}

 else if(e.code==='Space'&&!mod){e.preventDefault();if(pointer&&pointer.mode!=='pan')finishPointer();space=true;updateCanvasCursor();}
 else if(e.key==='Escape'&&connectStart){e.preventDefault();connectStart=null;updateConnectGuide();}
 else if(e.key.toLowerCase()==='f')fit();else if(e.key.toLowerCase()==='r')$('[data-action=random]')?.click();
});
window.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;updateCanvasCursor();}});
window.addEventListener('blur',()=>{finishPointer();space=false;lastCanvasPoint=null;const ring=$('#brush-cursor');if(ring)ring.hidden=true;updateCanvasCursor();});
function bindViewport(){
 const vp=$('#viewport');
 vp.addEventListener('wheel',e=>{if(e.target.closest('button,select,input'))return;e.preventDefault();finishPointer();zoom=clamp(zoom*Math.exp(-e.deltaY*.0015),.1,12);fitLayout();if(lastCanvasPoint)updateBrushCursor(lastCanvasPoint);},{passive:false});
 vp.addEventListener('pointerdown',e=>{
  if(![0,1].includes(e.button)||e.target.closest('button,select,input,label')||!storageReady||motionRun)return;
  document.activeElement?.blur();
  finishPointer();flush();const common={viewport:vp,id:e.pointerId};
  if(space||canvasTool==='hand'||e.button===1){pointer={...common,mode:'pan',x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};vp.classList.add('panning');}
  else if(beginMaskGesture(e,common)){/* The selected image moves independently of the artwork. */}
  else if(editableCells()&&e.target.closest('#artboard')){
   const point={x:e.clientX,y:e.clientY};pointer={...common,mode:'cell',editMode,seen:new Set(),before:JSON.stringify(doc),cells:captureCellCenters(),radius:brushSize*canvasUnit()/2,tolerance:Math.max(8,Math.min(24,(active().params.spacing??active().params.cellSize)*canvasUnit()/2)),last:point};editAt(e,true);
  }
  if(pointer){vp.setPointerCapture(e.pointerId);e.preventDefault();}lastCanvasPoint={clientX:e.clientX,clientY:e.clientY};updateBrushCursor(lastCanvasPoint);
 });
 vp.addEventListener('pointermove',e=>{
  lastCanvasPoint={clientX:e.clientX,clientY:e.clientY};updateBrushCursor(lastCanvasPoint);updateConnectGuide();
  if(!pointer||pointer.id!==e.pointerId)return;
  if(pointer.mode==='pan'){pan={x:pointer.px+e.clientX-pointer.x,y:pointer.py+e.clientY-pointer.y};fitLayout();}
  else if(pointer.mode==='mask')dragImageMask(e);
  else editAt(e);
 });
 vp.addEventListener('pointerleave',()=>{lastCanvasPoint=null;$('#brush-cursor').hidden=true;updateConnectGuide();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])vp.addEventListener(event,e=>{if(pointer?.id===e.pointerId)finishPointer();});
}

let lastImageAnalysis=null;
async function analyzeMaskImage(data){
 if(lastImageAnalysis?.image===data)return lastImageAnalysis;
 const image=new Image();image.src=data;await image.decode();
 if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192)throw new Error('Invalid image dimensions');
 const ratio=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),threshold=autoThreshold(grayscaleImage(pixels)),colorMap=encodeColorMap(pixels);
 lastImageAnalysis={image:data,imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,threshold,colorMap};
 return lastImageAnalysis;
}
async function readMaskImage(file){
 if(file.size>16*1024*1024)throw new Error('Image too large');
 if(file.type==='image/svg+xml'||/\.svg$/i.test(file.name))return importShapeFile(file);
 const bytes=new Uint8Array(await file.arrayBuffer()),head=[...bytes.subarray(0,12)];
 const mime=head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':head[0]===255&&head[1]===216&&head[2]===255?'image/jpeg':String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP'?'image/webp':null;
 if(!mime)throw new Error('Invalid image format');
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([bytes],{type:mime}));});
}
function chooseImageMask(id=null,mode=activePattern().type==='lowpoly'?'color':'mask'){
 if(!id&&doc.layers.length>=16){toast('maxLayers');return;}
 maskImportMode=mode;maskImportTarget=id;maskImportDocument=doc;$('#file-image-mask').click();
}
$('#file-image-mask').addEventListener('cancel',()=>{maskImportTarget=null;maskImportDocument=null;});
$('#file-image-mask').addEventListener('change',async e=>{
 const file=e.target.files[0];e.target.value='';const target=maskImportTarget,mode=maskImportMode,originalDoc=maskImportDocument??doc;
 maskImportTarget=null;maskImportDocument=null;if(!file||!storageReady||doc!==originalDoc)return;
 await importImageLayer(file,target,mode);
});
async function importImageLayer(file,target=null,mode=activePattern().type==='lowpoly'?'color':'mask'){
 const generation=projectGeneration,ticket=++maskImportSequence;
 if(!storageReady||navigationBusy||closeRequestBusy)return false;
 toast('maskLoading');
 try{
  const image=await readMaskImage(file),analysis=await analyzeMaskImage(image);
  if(ticket!==maskImportSequence||generation!==projectGeneration||navigationBusy||closeRequestBusy)return false;
  const existing=target?doc.layers.find(l=>l.id===target&&isImageMaskLayer(l)):null;
  if(target&&!existing)return false;if(!target&&doc.layers.length>=16){toast('maxLayers');return false;}
  const name=file.name.replace(/\.[^.]+$/,'').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,80)||t('imageMask');
  const layer=existing?{...existing,image,imageWidth:analysis.imageWidth,imageHeight:analysis.imageHeight,threshold:analysis.threshold}:createImageMaskLayer({id:uid(),name,image,imageWidth:analysis.imageWidth,imageHeight:analysis.imageHeight});
  layer.threshold=analysis.threshold;layer.colorMap=analysis.colorMap;if(!existing)layer.mode=mode;
  const layers=existing?doc.layers.map(l=>l===existing?layer:l):[...doc.layers,layer],next=normalizeDocument({...doc,layers});
  if(new Blob([JSON.stringify(next)]).size>MAX_PROJECT_BYTES){toast('projectTooLarge');return false;}
  lastPatternId=activePattern().id;
  mutate(()=>{doc=next;selected=layer.id;});toast('maskAdded');return true;
 }catch(error){console.error(error);toast('maskInvalid');return false;}
}
let fileDragDepth=0,dropBusy=false;
const fileDrag=e=>Array.from(e.dataTransfer?.types??[]).includes('Files');
function clearFileDrop(){fileDragDepth=0;document.body.classList.remove('file-dropping');}
document.addEventListener('dragenter',e=>{if(!fileDrag(e))return;e.preventDefault();if(++fileDragDepth===1&&storageReady&&!$('dialog[open]')){document.body.dataset.dropHint=t('dropImages');document.body.classList.add('file-dropping');}});
document.addEventListener('dragover',e=>{if(fileDrag(e)){e.preventDefault();e.dataTransfer.dropEffect=storageReady&&!$('dialog[open]')&&!dropBusy?'copy':'none';}});
document.addEventListener('dragleave',e=>{if(fileDrag(e)&&--fileDragDepth<=0)clearFileDrop();});
document.addEventListener('dragend',clearFileDrop);
window.addEventListener('blur',clearFileDrop);
document.addEventListener('drop',async e=>{
 if(!fileDrag(e))return;e.preventDefault();clearFileDrop();
 if(!storageReady||$('dialog[open]')||dropBusy||navigationBusy||closeRequestBusy||motionRun)return;
 const files=Array.from(e.dataTransfer.files);if(!files.length)return;
 dropBusy=true;const generation=projectGeneration,mode=activePattern().type==='lowpoly'?'color':'mask';
 try{for(const file of files){if(generation!==projectGeneration)break;if(!await importImageLayer(file,null,mode))break;}}finally{dropBusy=false;}
});
async function setImageMode(id,mode){
 const layer=doc.layers.find(l=>l.id===id&&isImageMaskLayer(l));if(!layer||!['mask','color'].includes(mode))return;
 const originalDoc=doc,image=layer.image,ticket=++maskImportSequence;
 try{
  const colorMap=mode==='color'&&!layer.colorMap?(await analyzeMaskImage(image)).colorMap:layer.colorMap;
  if(ticket!==maskImportSequence||doc!==originalDoc||!doc.layers.includes(layer)||layer.image!==image)return;
  mutate(()=>{layer.mode=mode;layer.colorMap=colorMap;});
 }catch{toast('maskInvalid');renderApp();}
}
async function resetMaskThreshold(){
 const layer=active();if(!isImageMaskLayer(layer))return;
 const image=layer.image,originalDoc=doc,buttons=$$('[data-action=mask-auto-threshold]');buttons.forEach(b=>b.disabled=true);
 try{
  const analysis=await analyzeMaskImage(image);
  if(doc===originalDoc&&doc.layers.includes(layer)&&layer.image===image)mutate(()=>{layer.threshold=analysis.threshold;});
 }catch{toast('maskInvalid');}
 finally{buttons.forEach(b=>b.disabled=false);}
}
function updateMaskOverlay(){
 const overlay=$('#mask-overlay');if(!overlay)return;
 const layer=active(),show=isImageMaskLayer(layer)&&repeat===1;overlay.toggleAttribute('hidden',!show);
 if(!show){overlay.innerHTML='';return;}
 const g=imageMaskGeometry(layer,doc),unit=canvasUnit(),r=5/unit,stem=26/unit;
 overlay.setAttribute('viewBox',`0 0 ${doc.width} ${doc.height}`);
 overlay.innerHTML=`<g transform="${g.transform}"><rect class="mask-outline" data-mask-action="move" x="${-g.width/2}" y="${-g.height/2}" width="${g.width}" height="${g.height}" vector-effect="non-scaling-stroke"/><line class="mask-stem" x1="0" y1="${-g.height/2}" x2="0" y2="${-g.height/2-stem}" vector-effect="non-scaling-stroke"/><circle class="mask-handle" data-mask-action="rotate" aria-label="${esc(t('rotation'))}" cx="0" cy="${-g.height/2-stem}" r="${r}" vector-effect="non-scaling-stroke"/>${[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>`<rect class="mask-handle" data-mask-action="resize" aria-label="${esc(t('scale'))}" x="${x*g.width/2-r}" y="${y*g.height/2-r}" width="${2*r}" height="${2*r}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
}
function beginMaskGesture(e,common){
 if(!isImageMaskLayer(active())||repeat!==1)return false;
 const handle=e.target.closest('[data-mask-action]');if(!handle)return false;
 const layer=active(),rect=$('#artboard').getBoundingClientRect(),unit=canvasUnit(),point={x:(e.clientX-rect.left)/unit,y:(e.clientY-rect.top)/unit},geometry=imageMaskGeometry(layer,doc);
 pointer={...common,mode:'mask',action:handle.dataset.maskAction,before:JSON.stringify(doc),layer,initial:{scale:layer.scale,rotation:layer.rotation,offsetX:layer.offsetX,offsetY:layer.offsetY},point,geometry,unit,rect};
 return true;
}
function dragImageMask(e){
 const {layer,initial,point,geometry,unit,rect,action}=pointer,current={x:(e.clientX-rect.left)/unit,y:(e.clientY-rect.top)/unit};
 if(action==='move'){layer.offsetX=clamp(Math.round(initial.offsetX+current.x-point.x),-32768,32768);layer.offsetY=clamp(Math.round(initial.offsetY+current.y-point.y),-32768,32768);}
 else if(action==='resize'){const before=Math.hypot(point.x-geometry.cx,point.y-geometry.cy),after=Math.hypot(current.x-geometry.cx,current.y-geometry.cy);layer.scale=Number(clamp(initial.scale*after/Math.max(.01,before),.05,8).toFixed(4));}
 else{const start=Math.atan2(point.y-geometry.cy,point.x-geometry.cx),now=Math.atan2(current.y-geometry.cy,current.x-geometry.cx),angle=initial.rotation+(now-start)*180/Math.PI;layer.rotation=Math.round(((angle+180)%360+360)%360-180);}
 for(const key of ['scale','rotation','offsetX','offsetY'])for(const input of $$(`[data-target=layer][data-key=${key}]`)){
  if(key.startsWith('offset')){input.min=-Math.max(key==='offsetX'?doc.width:doc.height,Math.abs(layer[key]));input.max=-Number(input.min);}
  input.value=layer[key];
 }
 schedulePreview();
}

function dialog(content,cls=''){closeDialog();$('#dialog-root').innerHTML=`<dialog class="${cls}">${ib('close-dialog','close','close')}<div class="modal-content">${content}</div></dialog>`;const d=$('dialog');$('.icon-btn',d).classList.add('modal-close');d.showModal();d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});d.addEventListener('close',()=>d.remove());return d;}
function closeDialog(){const d=$('dialog');if(d)d.close();$('#dialog-root').innerHTML='';}
function updateShapeLibrary(update){
 const write=async()=>{
  if(!shapeLibraryReady)throw new Error('ShapeLibraryReadFailed');
  const result=update(sharedShapes);
  if(!await persistentStorage.setRecord('shapes',result.library))throw new Error('ShapeLibrarySaveFailed');
  sharedShapes=result.library;return result;
 };
 const task=shapeWriteQueue.then(write,write);shapeWriteQueue=task.then(()=>undefined,()=>undefined);return task;
}
function shapeError(error){const keys={ShapeLibraryFull:'shapeLibraryFull',ShapeLibrarySaveFailed:'shapeLibrarySaveFailed',ShapeLibraryReadFailed:'shapeLibraryReadFailed'};toast(keys[error.message]??'invalidImage');}
function shapeLibraryDialog(){
 const current=active().customMotif,disabled=shapeLibraryReady?'':'disabled';
 dialog(`<div class="eyebrow">C-TextureMaker / Shapes</div><h2>${esc(t('shapeLibrary'))}</h2><p class="intro">${esc(t('sharedShapeHint'))}</p><div class="shape-library-actions"><button class="button primary" data-action="import-shape" ${disabled}>${icon('plus')}${esc(t('uploadShape'))}</button><span class="mono">${sharedShapes.length} / 40</span></div>${shapeLibraryReady?'':`<p class="helper" role="alert">${esc(t('shapeLibraryReadFailed'))}</p>`}<div class="shape-grid">${sharedShapes.map(shape=>`<div class="shape-card ${shape.data===current?'active':''}"><button class="shape-apply" data-action="use-shape" data-id="${esc(shape.id)}" title="${esc(t('applyShape'))}: ${esc(shape.name)}"><span class="shape-preview"><img src="${esc(shape.data)}" alt=""></span><span class="shape-name" title="${esc(shape.name)}">${esc(shape.name)}</span></button><div class="shape-tools">${ib('rename-shape','pencil','renameShape',`data-id="${esc(shape.id)}" ${disabled}`)}${ib('remove-shape','trash','removeShape',`data-id="${esc(shape.id)}" ${disabled}`)}</div></div>`).join('')||`<p class="empty">${esc(t('noShapes'))}</p>`}</div>${current?`<div class="shape-current-actions">${!sharedShapes.some(s=>s.data===current)?`<button class="button" data-action="add-current-shape" ${disabled}>${icon('plus')}${esc(t('addCurrentShape'))}</button>`:''}<button class="button" data-action="clear-motif">${esc(t('clearMotif'))}</button></div>`:''}`,'shapes-modal');
}
function nameDialog(key,value,callback){const d=dialog(`<div class="eyebrow">C-TextureMaker</div><h2>${esc(t(key))}</h2><form id="name-form"><input id="name-input" class="text-input" aria-label="${esc(t(key))}" maxlength="80" required value="${esc(value)}"><div class="modal-footer"><button type="button" class="button" data-action="close-dialog">${esc(t('cancel'))}</button><button type="submit" class="button primary">${esc(t('add'))}</button></div></form>`);$('#name-form',d).addEventListener('submit',e=>{e.preventDefault();const name=$('#name-input',d).value.trim();if(!name)return;closeDialog();callback(name);});$('#name-input',d).select();}
function replaceProject(parsed){finishPointer();pendingBefore=null;projectGeneration++;maskImportSequence++;doc=parsed;selected=doc.layers[0].id;lastPatternId=activePattern().id;past=[];future=[];connectStart=null;savedSnapshot=JSON.stringify(doc);renderApp();fit();autosave();}
async function confirmUnsaved(){
 finishPointer();flush();if(!isDirty())return 'clean';if(unsavedPrompt)return unsavedPrompt;
 const d=dialog(`<div class="eyebrow">C-TextureMaker</div><h2>${esc(t('unsavedTitle'))}</h2><p class="intro">${esc(t('unsavedBody'))}</p><p class="unsaved-name">${esc(doc.name)}</p><div class="modal-footer"><button class="button" id="unsaved-cancel">${esc(t('cancel'))}</button><button class="button" id="unsaved-discard">${esc(t('discard'))}</button><button class="button primary" id="unsaved-save">${esc(t('save'))}</button></div>`,'unsaved-modal');
 unsavedPrompt=new Promise(resolve=>{
  let settled=false,saving=false;const finish=result=>{if(settled)return;settled=true;resolve(result);closeDialog();};
  d.addEventListener('close',()=>{if(!settled){settled=true;resolve(false);}});
  $('#unsaved-cancel',d).onclick=()=>finish(false);$('#unsaved-discard',d).onclick=()=>finish('discard');
  $('#unsaved-save',d).onclick=async()=>{if(saving)return;saving=true;$$('button',d).forEach(b=>b.disabled=true);try{if(await saveProject()&&!isDirty())finish('saved');}finally{saving=false;$$('button',d).forEach(b=>b.disabled=false);}};
  d.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 });
 try{return await unsavedPrompt;}finally{unsavedPrompt=null;}
}
async function newProject(){
 if(navigationBusy||projectFileBusy||closeRequestBusy)return;navigationBusy=true;
 try{if(!await confirmUnsaved())return;projectFiles.reset();const fresh=createDocument();fresh.name=t('untitled');fresh.layers[0].color='#35392f';fresh.layers[0].secondary='#9da58f';replaceProject(fresh);}finally{navigationBusy=false;}
}
async function requestWindowClose(){
 if(closeRequestBusy)return;
 if(!storageReady||navigationBusy||projectFileBusy){nativeHost?.postMessage({type:'window',action:'close-cancelled'});return;}
 closeRequestBusy=true;
 try{const decision=await confirmUnsaved();if(!decision){nativeHost?.postMessage({type:'window',action:'close-cancelled'});return;}if(decision==='discard'){clearTimeout(saveTimer);saveTimer=0;const recovery=savedSnapshot?JSON.parse(savedSnapshot):createDocument();if(!savedSnapshot)recovery.name=t('untitled');queueAutosave(recovery,++autosaveSequence);}else persistAutosaveNow();await Promise.all([autosaveQueue,presetWriteQueue,shapeWriteQueue]);allowUnload=true;nativeHost?.postMessage({type:'window',action:'close-confirmed'});}catch{nativeHost?.postMessage({type:'window',action:'close-cancelled'});}finally{closeRequestBusy=false;}
}
function helpDialog(){const d=dialog(`<img class="guide-logo" src="icon.svg" alt=""><h2>${esc(t('guideTitle'))}</h2><p class="intro">${esc(t('guideBody'))}</p><div class="eyebrow">${esc(t('shortcut'))}</div><ul class="guide-list"><li>${esc(t('shortcutsUndo'))}</li><li>${esc(t('shortcutsSave'))}</li><li>${esc(t('shortcutsCanvas'))}</li></ul><p class="helper">${esc(t('helpSeam'))}</p><p class="helper">${esc(t('helpPrivacy'))}</p><label class="toggle-row" style="margin-top:20px"><span>${esc(t('startupMotion'))}</span><input id="motion-setting" type="checkbox" ${prefs.motion!==false?'checked':''}></label><button class="button" data-action="replay">${icon('reset')}${esc(t('replay'))}</button><div class="footnote help-credits"><p>${esc(t('about'))}</p><p>${esc(t('toolAuthor'))} <a href="https://github.com/ga643116" data-action="external" data-target="author" target="_blank" rel="noopener noreferrer">Ume9 (ga643116)</a><br><a href="https://github.com/ga643116/C-TextureMaker" data-action="external" data-target="repository" target="_blank" rel="noopener noreferrer">github.com/ga643116/C-TextureMaker</a></p><p class="motion-credit">${esc(t('motionCredit'))}<br>Transitions.dev / Jakub Antalik</p></div>`);$('#motion-setting',d).onchange=e=>{prefs.motion=e.target.checked;store.set('ctm.preferences',prefs);};}

function curated(){const specs=[['contour',{levels:18,terrainScale:2,strokeWidth:1.75},'#3d4535','#e7e9df',['地形研究','Terrain study','地形の研究']],['concentric',{count:26,innerWidth:2,outerWidth:1,minRadius:60,maxRadius:430,sweep:300},'#333830','#f4f2e9',['軌道 026','Orbit 026','軌道 026']],['halftone',{spacing:32,maxDot:13,minDot:1,gradient:'radial'},'#526249','#ecf0e2',['半調視野','Halftone field','ハーフトーン']],['waves',{spacing:32,amplitude:58,frequency:3,strokeWidth:2},'#6f7194','#edeafa',['漣漪','Undertow','さざ波']],['grid',{cellSize:128,diagonals:2,junction:'cross',junctionSize:12,strokeWidth:1},'#b5c697','#22281f',['訊號網格','Signal grid','シグナル']],['nested',{sides:6,count:30,twist:4,radiusStep:11},'#784737','#f6e3d0',['旋轉練習','Rotational study','回転の研究']]];return specs.map(([type,params,color,bg,names],i)=>{const d=createDocument();d.layers=[createLayer(type,`preset-${i}`)];Object.assign(d.layers[0].params,params);d.layers[0].color=color;d.layers[0].secondary=color;d.background=bg;d.transparent=false;d.name=names[{zh:0,en:1,ja:2}[lang]];return{id:`builtin-${i}`,name:d.name,document:d,builtin:true};});}
function persistPresets(next){const previous=savedPresets;savedPresets=next;const write=()=>persistentStorage.setRecord('presets',next),task=presetWriteQueue.then(write,write);presetWriteQueue=task.then(()=>undefined,()=>undefined);return task.then(okay=>{if(!okay&&savedPresets===next)savedPresets=previous;return okay;},()=>{if(savedPresets===next)savedPresets=previous;return false;});}
function allPresets(){return [...curated(),...savedPresets];}
function presetImage(p){try{return `data:image/svg+xml,${encodeURIComponent(renderSVG(presetPreview(p)))}`;}catch{return 'icon.svg';}}
function presetsDialog(){const items=allPresets();const card=p=>`<div class="preset-card"><button style="padding:0;display:block;width:100%;text-align:left" data-action="preset" data-id="${esc(p.id)}"><div class="preset-art"><img src="${presetImage(p)}" alt=""></div><span>${esc(p.name)}</span></button>${!p.builtin?`<button class="icon-btn preset-delete" data-action="remove-preset" data-id="${esc(p.id)}" title="${esc(t('removePreset'))}" aria-label="${esc(t('removePreset'))}">${icon('trash')}</button>`:''}</div>`;dialog(`<div class="eyebrow">C-TextureMaker / Collection</div><h2>${esc(t('presets'))}</h2><p class="helper">${esc(t('presetScope'))}</p><div class="preset-grid">${items.filter(p=>p.builtin).map(card).join('')}</div><div class="section-title">${esc(t('savedPresets'))}<button class="text-btn" data-action="save-preset">${icon('plus')}${esc(t('savePreset'))}</button></div><div class="preset-grid">${items.filter(p=>!p.builtin).map(card).join('')||`<div class="empty">${esc(t('noPresets'))}</div>`}</div>`,'presets-modal');}

function safeName(name){const clean=name.replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').slice(0,120).replace(/[. ]+$/,'')||'C-TextureMaker';return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(clean)?`_${clean}`:clean;}
async function saveFile(name,mime,blob){if(window.chrome?.webview){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const id=uid();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{nativeSaves.delete(id);reject(new Error('Save dialog timed out'));},600000);nativeSaves.set(id,{resolve,reject,timer});window.chrome.webview.postMessage({type:'save',id,name:safeName(name),mime,lang,base64:btoa(binary)});});}const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=safeName(name);a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;}
window.chrome?.webview?.addEventListener('message',e=>{const r=e.data;if(r?.type==='window-close-request'){requestWindowClose();return;}if(r?.type==='window-state'){updateWindowState(r.maximized);return;}if(r?.type!=='save-result')return;const task=nativeSaves.get(r.id);if(!task)return;clearTimeout(task.timer);nativeSaves.delete(r.id);if(r.cancelled)task.resolve(false);else if(r.ok)task.resolve(true);else task.reject(new Error(r.error||'Save failed'));});
function closeSaveMenu(){const menu=$('#save-menu');if(menu)menu.hidden=true;$('[data-action=save-menu]')?.setAttribute('aria-expanded','false');}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#save-menu')?.hidden){closeSaveMenu();$('[data-action=save-menu]')?.focus();}});
async function saveProject(saveAs=false){
 if(projectFileBusy)return false;finishPointer();flush();const snapshot=JSON.stringify(doc),generation=projectGeneration,text=JSON.stringify(doc,null,2);
 if(new Blob([text]).size>MAX_PROJECT_BYTES){toast('projectTooLarge');return false;}
 projectFileBusy=true;
 try{if(await projectFiles.save({name:safeName(doc.name)+'.ctm',text,lang,saveAs})){if(generation===projectGeneration)savedSnapshot=snapshot;syncDirty();toast('saved');return true;}return false;}catch{toast('saveFailed');return false;}finally{projectFileBusy=false;}
}
async function openProject(){
 if(navigationBusy||projectFileBusy||closeRequestBusy)return;
 if(!nativeHost){$('#file-project').click();return;}
 navigationBusy=true;
 try{
  if(!await confirmUnsaved())return;projectFileBusy=true;
  const result=await projectFiles.open({lang});if(!result)return;
  const parsed=normalizeDocument(JSON.parse(result.text));
  if(!projectFiles.acceptOpened(result))return;
  replaceProject(parsed);toast('imported');
 }catch{toast('invalidProject');}finally{projectFileBusy=false;navigationBusy=false;}
}
$('#file-project').addEventListener('change',async e=>{
 const f=e.target.files[0];e.target.value='';if(!storageReady||!f||navigationBusy||projectFileBusy||closeRequestBusy)return;
 if(f.size>MAX_PROJECT_BYTES){toast('projectTooLarge');return;}navigationBusy=true;
 try{const parsed=normalizeDocument(JSON.parse(await f.text()));if(!await confirmUnsaved())return;projectFiles.reset();replaceProject(parsed);toast('imported');}catch{toast('invalidProject');}finally{navigationBusy=false;}
});
function exportDialog(){let format='svg';const d=dialog(`<div class="eyebrow">C-TextureMaker / Export</div><h2>${esc(t('exportTitle'))}</h2><p class="intro">${esc(t('exportSub'))}</p><label class="form-label">${esc(t('format'))}</label><div class="format-switch"><button class="format-option active" data-format="svg"><b>SVG</b><small>${esc(t('vector'))}</small></button><button class="format-option" data-format="png"><b>PNG</b><small>RGBA · 8 bit</small></button></div><p class="helper format-note" id="format-note">${esc(t('svgNote'))}</p><label class="form-label" for="export-name">${esc(t('filename'))}</label><input class="text-input" id="export-name" maxlength="80" value="${esc(safeName(doc.name))}"><div id="png-scale"><label class="form-label" for="export-scale">${esc(t('resolution'))}</label><select id="export-scale" class="select-wide" disabled><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div><div style="height:18px"></div><label class="toggle-row"><span>${esc(t('transparent'))}</span><input id="export-alpha" type="checkbox" ${doc.transparent?'checked':''}></label><div class="export-meta"><span id="export-size" class="mono">${doc.width} × ${doc.height}</span><span>${esc(t(doc.seamless?'seamless':'single'))}</span></div>${doc.layers.some(l=>l.customMotif||l.mask||isImageMaskLayer(l))?`<p class="helper">${esc(t('rasterNote'))}</p>`:''}<div class="modal-footer"><button class="button" data-action="close-dialog">${esc(t('cancel'))}</button><button class="button primary" id="do-export">${icon('export')}${esc(t('download'))}</button></div>`);
 const update=()=>{const mult=format==='png'?Number($('#export-scale',d).value):1;$('#export-size',d).textContent=`${doc.width*mult} × ${doc.height*mult}`;};$$('[data-format]',d).forEach(b=>b.onclick=()=>{format=b.dataset.format;$$('[data-format]',d).forEach(x=>x.classList.toggle('active',x===b));$('#export-scale',d).disabled=format!=='png';$('#format-note',d).textContent=t(format==='svg'?'svgNote':'pngNote');update();});$('#export-scale',d).onchange=update;
 $('#do-export',d).onclick=async()=>{flush();const mult=format==='png'?Number($('#export-scale',d).value):1,w=doc.width*mult,h=doc.height*mult;if(format==='png'&&(w>8192||h>8192||w*h>33554432)){toast('tooLarge');return;}const button=$('#do-export',d);button.disabled=true;button.textContent=t('exporting');try{const output=clone(doc);output.transparent=$('#export-alpha',d).checked;const svg=renderSVG(output);let blob;if(format==='svg')blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});else blob=await rasterize(svg,w,h);const name=safeName($('#export-name',d).value)+'.'+format;if(await saveFile(name,blob.type,blob)){closeDialog();toast('exported');}}catch(err){console.error(err);toast('exportError');}finally{if(button.isConnected){button.disabled=false;button.innerHTML=icon('export')+esc(t('download'));}}};
}
async function rasterize(svg,w,h){const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No canvas');ctx.drawImage(img,0,0,w,h);return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));}finally{URL.revokeObjectURL(url);}}
$('#file-image').addEventListener('change',async e=>{
 const file=e.target.files[0],target=imageTarget,layerId=selected;e.target.value='';if(!storageReady||!file)return;
 try{
  const data=await importShapeFile(file);
  if(target==='customMotif'){
   const name=file.name.replace(/\.(png|svg)$/i,'').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').slice(0,80)||t('customShape');
   await updateShapeLibrary(library=>addShape(library,{id:uid(),name,data}));
  }
  const layer=doc.layers.find(l=>l.id===layerId&&(target==='mask'?l.type==='halftone':SHAPE_PATTERNS.includes(l.type)));
  if(layer)mutate(()=>{layer[target]=data;});
  closeDialog();toast('motifLoaded');
 }catch(error){shapeError(error);}
});

async function playEntrance(){
 const sequence=++entranceSequence;motionRun?.cancel();await document.fonts.ready;if(sequence!==entranceSequence)return;
 const app=$('#app');if(!app)return;
 const run=generate(app,{mode:'skeleton',maxParts:180,keys:8});motionRun=run;app.inert=true;app.dataset.entering='true';
 const skip=document.createElement('button');skip.className='motion-skip';skip.textContent=t('skipIntro');skip.onclick=()=>run.cancel();document.body.append(skip);
 const stopOnResize=()=>run.cancel(),stopOnEscape=e=>{if(e.key==='Escape')run.cancel();};
 window.addEventListener('resize',stopOnResize);window.addEventListener('keydown',stopOnEscape);
 await run.finished;skip.remove();window.removeEventListener('resize',stopOnResize);window.removeEventListener('keydown',stopOnEscape);
 if(motionRun===run){motionRun=null;app.inert=false;delete app.dataset.entering;}
}
async function initializeApp(){
 storageAvailable=await persistentStorage.initialize();
 try{const saved=await persistentStorage.getRecord('autosave',null);if(saved){doc=normalizeDocument(saved);restored=true;}}catch{/* Keep the legacy or IndexedDB record intact if it cannot be restored. */}
 selected=doc.layers[0].id;
 try{const presets=await persistentStorage.getRecord('presets',[]);if(Array.isArray(presets))savedPresets=presets;}catch{/* Presets remain available in legacy storage when IndexedDB is unavailable. */}
 try{sharedShapes=normalizeShapeLibrary(await persistentStorage.getRecord('shapes',[]));shapeLibraryReady=true;}catch{/* Keep an unreadable library intact; show its error when opened. */}
 savedSnapshot=restored?null:JSON.stringify(doc);storageReady=true;saveState=storageAvailable?(restored?'autosaved':'saveReady'):'storageUnavailable';
 $('#app').inert=false;$('#app').setAttribute('aria-busy','false');renderApp();
  document.documentElement.dataset.appReady='true';nativeHost?.postMessage({type:'window',action:'close-guard-ready'});
 if(restored)toast('restored');if(prefs.motion!==false)playEntrance();
}
renderApp();$('#app').inert=true;$('#app').setAttribute('aria-busy','true');
 // A read-only readiness signal for host smoke checks. No production test controls.
 initializeApp().catch(error=>{console.error(error);storageReady=true;storageAvailable=false;saveState='storageUnavailable';$('#app').inert=false;$('#app').setAttribute('aria-busy','false');renderApp();document.documentElement.dataset.appReady='true';nativeHost?.postMessage({type:'window',action:'close-guard-ready'});});
window.addEventListener('beforeunload',e=>{if(allowUnload)return;finishPointer();flush();persistAutosaveNow();if(!nativeHost&&!allowUnload&&isDirty()){e.preventDefault();e.returnValue='';}});
