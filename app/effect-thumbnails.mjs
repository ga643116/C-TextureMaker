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
 }else{
  const curves=[];
  for(let i=0;i<11;i++){
   const y=12+i*10;
   curves.push(`M10 ${y}C34 ${y-18} 49 ${y+19} 70 ${y+1}S99 ${y-13} 118 ${y-2}`);
  }
  if(type==='manga'){
   body='<defs><pattern id="thumb-manga-dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".7" fill="#777777"/></pattern><clipPath id="thumb-manga-field"><rect x="10" y="10" width="108" height="108"/></clipPath></defs><g clip-path="url(#thumb-manga-field)">';
   for(let i=0;i<curves.length;i++)body+=`<path d="${curves[i]}" fill="none" stroke="${i%3===0?'#858585':i%3===1?'#c8c8c8':'url(#thumb-manga-dots)'}" stroke-opacity=".5" stroke-width="7"/>`;
   body+='</g>';
  }else{
   body=curves.map(d=>`<path d="${d}" fill="none" stroke="#858585" stroke-width=".9" stroke-linecap="round"/>`).join('');
  }
 }
 return `<svg class="${type}-thumb" viewBox="0 0 128 128" aria-hidden="true">${body}</svg>`;
}
