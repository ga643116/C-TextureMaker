/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { contours } from 'd3-contour';
import { createLineArtEngine } from './line-art.mjs';

// Keep analysis independent of canvas/export size. Tone and line paths are
// cached separately, so changing the screen never repeats image analysis.
const fmt = value => String(Number(value.toFixed(3)));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function simplify(points, tolerance = .22) {
  const keep = new Uint8Array(points.length), last = points.length - 1, stack = [[0, last]];
  keep[0] = keep[last] = 1;
  while (stack.length) {
    const [first, end] = stack.pop(), a = points[first], b = points[end];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    let maximum = tolerance * tolerance, selected = -1;
    for (let i = first + 1; i < end; i++) {
      const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0;
      const distance = (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2;
      if (distance > maximum) { maximum = distance; selected = i; }
    }
    if (selected >= 0) { keep[selected] = 1; stack.push([first, selected], [selected, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

function trace(values, width, height, threshold, tolerance = .22) {
  // Extend edge samples before tracing. The source alpha mask clips them back
  // to the image, keeping uniform dark corners (including tiny images) filled.
  const paddedWidth=width+2,paddedHeight=height+2,padded=new Float32Array(paddedWidth*paddedHeight);
  for(let y=0;y<paddedHeight;y++)for(let x=0;x<paddedWidth;x++)padded[y*paddedWidth+x]=values[Math.max(0,Math.min(height-1,y-1))*width+Math.max(0,Math.min(width-1,x-1))];
  const geometry = contours().size([paddedWidth, paddedHeight]).smooth(true).contour(padded, threshold), paths = [];
  for (const polygon of geometry.coordinates) for (const ring of polygon) {
    const points = simplify(ring, tolerance);
    if (points.length < 4) continue;
    paths.push(points.slice(0, -1).map((p, i) => (i ? 'L' : 'M') + fmt(Math.max(0,Math.min(width,p[0]-1))) + ',' + fmt(Math.max(0,Math.min(height,p[1]-1)))).join('') + 'Z');
  }
  return paths.join('');
}

function analyze(sample, width, height, scaleX, scaleY) {
  const count = width * height, rgb = new Float32Array(count * 3), luminance = new Float32Array(count), alpha = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, rgba = sample((x + .5) * scaleX, (y + .5) * scaleY);
    alpha[i] = rgba[3];
    for (let channel = 0; channel < 3; channel++) rgb[i*3+channel] = rgba[3] ? rgba[channel] : 255;
    luminance[i] = .2126*rgb[i*3] + .7152*rgb[i*3+1] + .0722*rgb[i*3+2];
  }
  // An edge-preserving blur removes small color noise from tonal regions.
  // Flow-XDoG line extraction is shared with redraw and standalone line art.
  const darkness = new Float32Array(count), range = new Float32Array(256);
  for (let i = 0; i < 256; i++) range[i] = Math.exp(-i*i/(2*24*24));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y*width+x;
    let tone = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx));
      const spatial = (dx===0?2:1)*(dy===0?2:1);
      const w = spatial*range[Math.min(255,Math.round(Math.abs(luminance[i]-luminance[j])))];
      tone += luminance[j]*w; weight += w;
    }
    darkness[i] = alpha[i] ? 255-tone/weight : -1;
  }
  return { width, height, darkness, cleanTones:openTones(darkness,width,height) };
}

// Remove narrow ink from tonal fills when line art is enabled. Otherwise a
// extracted stroke would still sit on its original thick black/gray band.
function openTones(values, width, height) {
  const eroded=new Float32Array(values.length),opened=new Float32Array(values.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=255;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)value=Math.min(value,values[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))]);
    eroded[y*width+x]=value;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=-1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)value=Math.max(value,eroded[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))]);
    opened[y*width+x]=value;
  }
  return opened;
}

function cachedPath(cache, key, compute) {
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const value = compute();
  if (cache.size >= 3) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function screenGlyph(shape, size) {
  const r=size/2, start=.5-r;
  if (shape==='square') return `<rect x="${fmt(start)}" y="${fmt(start)}" width="${fmt(size)}" height="${fmt(size)}"/>`;
  if (shape==='diamond') return `<path d="M.5 ${fmt(start)}L${fmt(.5+r)} .5 .5 ${fmt(.5+r)} ${fmt(start)} .5Z"/>`;
  if (shape==='line') return `<rect x="0" y="${fmt(start)}" width="1" height="${fmt(size)}"/>`;
  return `<circle cx=".5" cy=".5" r="${fmt(r)}"/>`;
}

export function createMangaEngine(deps) {
  const lineArtEngine=deps.lineArtEngine??createLineArtEngine(deps);
  const cache=new WeakMap();
  function render(doc, layer, sourceGroupId) {
    const prepared=lineArtEngine.prepare(doc,layer);
    if(!prepared)return '';
    const {entry,transform,sx,sy}=prepared;
    let cached=cache.get(entry);
    if(!cached){
      const sample=(x,y)=>entry.rgba.subarray((Math.floor(y)*entry.width+Math.floor(x))*4,(Math.floor(y)*entry.width+Math.floor(x))*4+4);
      cached={analysis:analyze(sample,entry.width,entry.height,1,1),tones:new Map()};
      cache.set(entry,cached);
    }
    const {analysis,tones}=cached,{width,height,darkness}=analysis,p=layer.params;
    const toneValues=p.lineArt?analysis.cleanTones:darkness;
    const black = cachedPath(tones,'b'+p.blackLevel+':'+p.lineArt,()=>trace(toneValues,width,height,255-p.blackLevel));
    const gray = cachedPath(tones,'g'+p.whiteLevel+':'+p.lineArt,()=>trace(toneValues,width,height,255-p.whiteLevel+.0001));
    const id='manga-'+esc(layer.id);
    const spacing=Math.max(doc.width,doc.height)/p.toneDensity;
    const defs=`<mask id="${id}-alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" mask-type="alpha"><use href="#${esc(sourceGroupId)}"/></mask><path id="${id}-gray" d="${gray}" fill-rule="evenodd"/>`+
      (p.screentone?`<pattern id="${id}-screen" patternUnits="userSpaceOnUse" width="${Number((spacing/sx).toPrecision(9))}" height="${Number((spacing/sy).toPrecision(9))}" viewBox="0 0 1 1" preserveAspectRatio="none"><g fill="#000000">${screenGlyph(p.toneShape,p.toneSize/100)}</g></pattern>`:'');
    const line=p.lineArt?lineArtEngine.render(doc,layer,{prepared,color:'#000000',sourceMaskApplied:true}):'';
    return `<defs>${defs}</defs><g data-manga="true" mask="url(#${id}-alpha)"><rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/><g transform="${transform}"><use data-manga-gray="true" href="#${id}-gray" fill="#888888"/>${p.screentone?`<use data-manga-screen="true" href="#${id}-gray" fill="url(#${id}-screen)"/>`:''}<path data-manga-black="true" d="${black}" fill="#000000" fill-rule="evenodd"/></g>${line}</g>`;
  }
  return { render };
}
