/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { contours } from 'd3-contour';

// Keep analysis independent of canvas/export size. Tone and line paths are
// cached separately, so changing the screen never repeats image analysis.
const MAX_EDGE = 768;
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

function trace(values, width, height, threshold) {
  // Extend edge samples before tracing. The source alpha mask clips them back
  // to the image, keeping uniform dark corners (including tiny images) filled.
  const paddedWidth=width+2,paddedHeight=height+2,padded=new Float32Array(paddedWidth*paddedHeight);
  for(let y=0;y<paddedHeight;y++)for(let x=0;x<paddedWidth;x++)padded[y*paddedWidth+x]=values[Math.max(0,Math.min(height-1,y-1))*width+Math.max(0,Math.min(width-1,x-1))];
  const geometry = contours().size([paddedWidth, paddedHeight]).smooth(true).contour(padded, threshold), paths = [];
  for (const polygon of geometry.coordinates) for (const ring of polygon) {
    const points = simplify(ring);
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
  // A separate gentle RGB blur is used for color-aware contour detection.
  const darkness = new Float32Array(count), smooth = new Float32Array(count * 3), range = new Float32Array(256);
  for (let i = 0; i < 256; i++) range[i] = Math.exp(-i*i/(2*24*24));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y*width+x;
    let tone = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx));
      const spatial = (dx===0?2:1)*(dy===0?2:1);
      const w = spatial*range[Math.min(255,Math.round(Math.abs(luminance[i]-luminance[j])))];
      tone += luminance[j]*w; weight += w;
      for (let c = 0; c < 3; c++) smooth[i*3+c] += rgb[j*3+c]*spatial/16;
    }
    darkness[i] = alpha[i] ? 255-tone/weight : -1;
  }
  const magnitude = new Float32Array(count), direction = new Uint8Array(count);
  for (let y = 1; y < height-1; y++) for (let x = 1; x < width-1; x++) {
    const i = y*width+x;
    let best = 0, gx = 0, gy = 0;
    for (let c = 0; c < 4; c++) {
      const at = offset => c===3 ? .2126*smooth[offset*3]+.7152*smooth[offset*3+1]+.0722*smooth[offset*3+2] : smooth[offset*3+c];
      const sx = -at(i-width-1)+at(i-width+1)-2*at(i-1)+2*at(i+1)-at(i+width-1)+at(i+width+1);
      const sy = -at(i-width-1)-2*at(i-width)-at(i-width+1)+at(i+width-1)+2*at(i+width)+at(i+width+1);
      const strength = Math.hypot(sx,sy)/4*(c===3?1:.65);
      if (strength > best) { best = strength; gx = sx; gy = sy; }
    }
    magnitude[i] = best;
    const angle = (Math.atan2(gy,gx)*180/Math.PI+180)%180;
    direction[i] = angle<22.5||angle>=157.5 ? 0 : angle<67.5 ? 1 : angle<112.5 ? 2 : 3;
  }
  const edges = new Float32Array(count);
  for (let y = 1; y < height-1; y++) for (let x = 1; x < width-1; x++) {
    const i = y*width+x, offset = [1,width+1,width,width-1][direction[i]], m = magnitude[i];
    // Strict on one side suppresses doubled lines on flat gradient plateaus.
    if (alpha[i] && m>magnitude[i-offset] && m>=magnitude[i+offset]) edges[i] = m;
  }
  return { width, height, darkness, edges, outline:alpha.some(a=>a<255)?trace(alpha,width,height,127.5):'' };
}

function lineMask(analysis, strength) {
  const {width,height,edges} = analysis, high = 72-.64*strength, low = high*.45;
  const selected = new Uint8Array(edges.length), queue = new Int32Array(edges.length);
  let end = 0;
  for (let i = 0; i < edges.length; i++) if (edges[i]>=high) { selected[i] = 1; queue[end++] = i; }
  for (let head = 0; head < end; head++) {
    const i = queue[head], x = i%width, y = Math.floor(i/width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx=x+dx, ny=y+dy, j=ny*width+nx;
      if (nx<0||nx>=width||ny<0||ny>=height||selected[j]||edges[j]<low) continue;
      selected[j]=1; queue[end++]=j;
    }
  }
  return selected;
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

export function createMangaEngine({ resolveColorSources, imageMaskGeometry, createCompositeColorSampler, createImageColorSampler }) {
  const cache = [];
  function prepare(doc, layer) {
    const sources = resolveColorSources(doc, layer).filter(source => source.colorMap);
    if (!sources.length) return null;
    // A single image is traced in its own coordinates. Moving, scaling or
    // flipping the source then only changes an SVG transform.
    const single=sources.length===1?sources[0]:null;
    const extentWidth=single?single.colorMap.width:doc.width, extentHeight=single?single.colorMap.height:doc.height;
    const ratio=Math.min(1,MAX_EDGE/Math.max(extentWidth,extentHeight));
    const width=Math.max(1,Math.round(extentWidth*ratio)),height=Math.max(1,Math.round(extentHeight*ratio));
    const maps=sources.map(source=>source.colorMap.rgba);
    const key=JSON.stringify(single?['single',extentWidth,extentHeight]:[doc.width,doc.height,sources.map(source=>[source.id,source.colorMap.width,source.colorMap.height,imageMaskGeometry(source,doc),source.rotation,source.flipX,source.flipY])]);
    let entry=cache.find(item=>item.key===key&&item.maps.length===maps.length&&maps.every((map,i)=>map===item.maps[i]));
    if(entry)return {entry,single};
    const sample=single?createImageColorSampler({...single,rotation:0,flipX:false,flipY:false},{cx:extentWidth/2,cy:extentHeight/2,width:extentWidth,height:extentHeight}):createCompositeColorSampler(doc,layer);
    entry={key,maps,analysis:analyze(sample,width,height,extentWidth/width,extentHeight/height),tones:new Map(),lines:new Map()};
    cache.unshift(entry);
    if (cache.length>2) cache.pop();
    return {entry,single};
  }
  function render(doc, layer, sourceGroupId) {
    const prepared=prepare(doc,layer);
    if(!prepared)return '';
    const {entry,single}=prepared;
    const {analysis,tones,lines} = entry, {width,height,darkness} = analysis, p=layer.params;
    const black = cachedPath(tones,'b'+p.blackLevel,()=>trace(darkness,width,height,255-p.blackLevel));
    const gray = cachedPath(tones,'g'+p.whiteLevel,()=>trace(darkness,width,height,255-p.whiteLevel+.0001));
    const geometry=single?imageMaskGeometry(single,doc):null;
    const id='manga-'+esc(layer.id),sx=(geometry?.width??doc.width)/width,sy=(geometry?.height??doc.height)/height;
    const transform=(geometry?geometry.transform+` translate(${fmt(-geometry.width/2)} ${fmt(-geometry.height/2)}) `:'')+`scale(${fmt(sx)} ${fmt(sy)})`;
    const spacing=Math.max(doc.width,doc.height)/p.toneDensity;
    const defs=`<mask id="${id}-alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" mask-type="alpha"><use href="#${esc(sourceGroupId)}"/></mask>`+
      (p.screentone?`<pattern id="${id}-screen" patternUnits="userSpaceOnUse" width="${fmt(spacing/sx)}" height="${fmt(spacing/sy)}" viewBox="0 0 1 1" preserveAspectRatio="none"><rect width="1" height="1" fill="#ffffff"/><g fill="#000000">${screenGlyph(p.toneShape,p.toneSize/100)}</g></pattern>`:'');
    let line='';
    if (p.lineArt) {
      const path=cachedPath(lines,p.lineStrength+':'+Math.min(1,p.lineWidth),()=>trace(lineMask(analysis,p.lineStrength),width,height,1-Math.min(1,p.lineWidth)/2));
      line=`<path data-manga-lines="true" d="${path}" fill="#000000" fill-rule="evenodd" stroke="#000000" stroke-width="${fmt(Math.max(0,p.lineWidth-1))}" stroke-linejoin="round"/>`+(analysis.outline?`<path d="${analysis.outline}" fill="none" stroke="#000000" stroke-width="${fmt(p.lineWidth)}" stroke-linejoin="round"/>`:'');
    }
    return `<defs>${defs}</defs><g data-manga="true" mask="url(#${id}-alpha)"><rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/><g transform="${transform}"><path data-manga-gray="true" d="${gray}" fill="${p.screentone?'url(#'+id+'-screen)':'#888888'}" fill-rule="evenodd"/><path data-manga-black="true" d="${black}" fill="#000000" fill-rule="evenodd"/>${line}</g></g>`;
  }
  return { render };
}
