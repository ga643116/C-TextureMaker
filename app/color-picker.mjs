/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
let activePicker=null;
const HEX=/^#[0-9a-f]{6}$/i;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function hsv(hex){
 const [r,g,b]=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 let h=0;if(d)h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;
 return {h,s:max?d/max:0,v:max};
}
function rgb({h,s,v}){
 const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
function styles(){
 if(document.getElementById('ctm-color-picker-style'))return;
 const style=document.createElement('style');style.id='ctm-color-picker-style';
 style.textContent=`.ctm-color-picker{position:fixed;z-index:80;width:256px;max-width:calc(100vw - 16px);padding:12px;background:var(--panel,#fff);color:var(--ink,#222);border:1px solid var(--line,#ccc);border-radius:8px;box-shadow:0 8px 30px #0004;font:inherit;font-size:12px;line-height:1.5}.ctm-color-picker .cp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.ctm-color-picker button{padding:5px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:var(--bg,#eee);font-size:12px}.ctm-color-picker .cp-sv{height:144px;position:relative;cursor:crosshair;border-radius:4px;touch-action:none;overflow:hidden}.ctm-color-picker .cp-marker{position:absolute;width:10px;height:10px;border:2px solid white;border-radius:50%;box-shadow:0 0 0 1px #222;transform:translate(-50%,-50%);pointer-events:none}.ctm-color-picker .cp-hue{appearance:none;width:100%;height:12px;border-radius:4px;background:linear-gradient(to right,red,#ff0,#0f0,#0ff,#00f,#f0f,red);margin:14px 0}.ctm-color-picker .cp-hue::-webkit-slider-thumb{appearance:none;width:12px;height:18px;border:2px solid white;border-radius:4px;background:transparent;box-shadow:0 0 0 1px #333}.ctm-color-picker .cp-bottom{display:flex;gap:7px;align-items:center}.ctm-color-picker .cp-sample{width:26px;height:26px;flex:0 0 26px;border:1px solid var(--line,#ccc);border-radius:4px}.ctm-color-picker .cp-hex{width:0;min-width:0;flex:1;height:29px;padding:4px;background:var(--bg,#eee);color:inherit;border:1px solid var(--line,#ccc);border-radius:4px;font:12px Consolas,monospace}.ctm-color-picker .cp-status{margin:5px 0 0;min-height:0;color:var(--muted,#666);font-size:11px}`;
 document.head.append(style);
}
export function openColorPicker({anchor,value,onInput,onChange,onPick,labels={}}){
 activePicker?.close();if(!HEX.test(value))throw new TypeError('Invalid picker color');styles();
 const text={title:'Color',done:'Done',hue:'Hue',area:'Saturation and brightness',hex:'HEX color',pick:'Pick',picking:'Choose a screen color; Esc cancels.',pickError:'Screen color selection failed.',...labels};
 const root=document.createElement('div');root.className='ctm-color-picker';root.setAttribute('role','dialog');root.setAttribute('aria-label',text.title);
 root.innerHTML='<div class="cp-head"><strong></strong><button type="button" class="cp-done"></button></div><div class="cp-sv" tabindex="0" role="group"><span class="cp-marker"></span></div><input class="cp-hue" type="range" min="0" max="360" step="1"><div class="cp-bottom"><span class="cp-sample"></span><input class="cp-hex" type="text" maxlength="7"><button type="button" class="cp-pick"></button></div><p class="cp-status" role="status"></p>';
 const $=selector=>root.querySelector(selector),area=$('.cp-sv'),marker=$('.cp-marker'),hue=$('.cp-hue'),hex=$('.cp-hex'),sample=$('.cp-sample'),pick=$('.cp-pick'),status=$('.cp-status');
 $('.cp-head strong').textContent=text.title;$('.cp-done').textContent=text.done;pick.textContent=text.pick;
 area.setAttribute('aria-label',text.area);hue.setAttribute('aria-label',text.hue);hex.setAttribute('aria-label',text.hex);
 let color=value.toLowerCase(),state=hsv(color),closed=false,dragging=false,changed=false;
 function position(){const a=anchor.getBoundingClientRect(),box=root.getBoundingClientRect();root.style.left=clamp(a.right-box.width,8,Math.max(8,innerWidth-box.width-8))+'px';root.style.top=clamp(a.bottom+6+box.height>innerHeight?a.top-box.height-6:a.bottom+6,8,Math.max(8,innerHeight-box.height-8))+'px';}
 function draw(){area.style.background='linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),hsl('+state.h+',100%,50%)';marker.style.left=state.s*100+'%';marker.style.top=(1-state.v)*100+'%';hue.value=state.h;hex.value=color;sample.style.background=color;hex.removeAttribute('aria-invalid');}
 function notify(){changed=true;onInput?.(color);}
 function emit(){const next=rgb(state);if(next===color){draw();return;}color=next;draw();notify();}
 function setHex(next){if(!HEX.test(next)){hex.setAttribute('aria-invalid','true');return false;}const previous=color;color=next.toLowerCase();state=hsv(color);draw();if(color!==previous)notify();return true;}
 function point(event){const box=area.getBoundingClientRect();state.s=clamp((event.clientX-box.left)/box.width,0,1);state.v=1-clamp((event.clientY-box.top)/box.height,0,1);emit();}
 function outside(event){if(!root.contains(event.target)&&event.target!==anchor)controller.close();}
 function key(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();controller.close();}}
 const controller={close(){if(closed)return;closed=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',position);root.remove();if(activePicker===controller)activePicker=null;if(changed)onChange?.(color);}};
 activePicker=controller;document.body.append(root);draw();position();
 document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);window.addEventListener('resize',position);
 $('.cp-done').onclick=()=>controller.close();
 root.addEventListener('keydown',event=>{if(event.target!==area)return;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();state.s=clamp(state.s+(event.key==='ArrowRight'?.01:event.key==='ArrowLeft'?-.01:0),0,1);state.v=clamp(state.v+(event.key==='ArrowUp'?.01:event.key==='ArrowDown'?-.01:0),0,1);emit();});
 area.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();area.focus();dragging=true;area.setPointerCapture(event.pointerId);point(event);};
 area.onpointermove=event=>{if(dragging)point(event);};
 area.onpointerup=area.onpointercancel=()=>{dragging=false;};
 hue.oninput=()=>{state.h=Number(hue.value);emit();};
 hex.onchange=()=>setHex(hex.value);hex.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(setHex(hex.value))controller.close();}};
 pick.onclick=async()=>{if(closed)return;pick.disabled=true;status.textContent=text.picking;try{if(typeof onPick!=='function')throw new Error('Unavailable');const selected=await onPick();if(closed)return;if(selected!==null&&selected!==undefined&&!setHex(selected))throw new Error('Invalid screen color');status.textContent='';}catch{if(!closed)status.textContent=text.pickError;}finally{if(!closed)pick.disabled=false;}};
 return controller;
}
