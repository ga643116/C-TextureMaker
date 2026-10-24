/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Small material samples, using the same square field and quiet gray strokes
// as the generated pattern previews. No pictogram frames or illustrations.
export function effectThumbnail(type){
 if(!['redraw','manga','lineart'].includes(type))return null;
 let body='';
 if(type==='redraw'){
  const points=Array.from({length:7},(_,y)=>Array.from({length:7},(_,x)=>[10+x*18+(x&&x<6?Math.sin(x*7+y*3)*5:0),10+y*18+(y&&y<6?Math.cos(x*3+y*5)*5:0)]));
  const shades=['#c8c8c8','#b7b7b7','#a5a5a5','#969696','#838383'];
  for(let y=0;y<6;y++)for(let x=0;x<6;x++){
   const ring=[points[y][x],points[y][x+1],points[y+1][x+1],points[y+1][x]];
   body+=`<polygon points="${ring.map(p=>p.join(',')).join(' ')}" fill="${shades[(x+y*2)%shades.length]}" fill-opacity=".35" stroke="#777777" stroke-opacity=".65" stroke-width=".6"/>`;
  }
 }else if(type==='manga'){
  body='<defs><pattern id="thumb-manga-dots" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#aaaaaa"/><circle cx="4" cy="4" r="1.6" fill="#353535"/></pattern></defs><g stroke="#777777" stroke-width="1.2" stroke-linejoin="round"><path d="M64 16 108 40 64 64 20 40Z" fill="#f5f5f5"/><path d="M20 40 64 64V112L20 88Z" fill="#353535"/><path d="M64 64 108 40V88L64 112Z" fill="url(#thumb-manga-dots)"/></g>';
 }else{
  const cube=(x,filled)=>`<g transform="translate(${x} 38)" stroke="#777777" stroke-width="2" stroke-linejoin="round"><path d="M20 0 40 12 20 24 0 12Z" fill="${filled?'#cccccc':'none'}"/><path d="M0 12 20 24V52L0 40Z" fill="${filled?'#999999':'none'}"/><path d="M20 24 40 12V40L20 52Z" fill="${filled?'#aaaaaa':'none'}"/></g>`;
  body=cube(10,true)+'<path d="M58 64h12m-5-5 5 5-5 5" fill="none" stroke="#999999" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'+cube(78,false);
 }
 return `<svg class="${type}-thumb" viewBox="0 0 128 128" aria-hidden="true">${body}</svg>`;
}
