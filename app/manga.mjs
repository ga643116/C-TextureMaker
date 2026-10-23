/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { contours } from 'd3-contour';

// Keep analysis independent of canvas/export size. Tone and line paths are
// cached separately, so changing the screen never repeats image analysis.
const MAX_EDGE = 1024;
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

// A separable Gaussian keeps the line detector local and dependency-free.
function blurRGB(values, width, height, sigma) {
  const radius=Math.ceil(sigma*3),kernel=new Float32Array(radius*2+1);
  let sum=0;
  for(let x=-radius;x<=radius;x++){const weight=Math.exp(-x*x/(2*sigma*sigma));kernel[x+radius]=weight;sum+=weight;}
  for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
  const horizontal=new Float32Array(values.length),result=new Float32Array(values.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*3;
    for(let k=-radius;k<=radius;k++){
      const j=(y*width+Math.max(0,Math.min(width-1,x+k)))*3,w=kernel[k+radius];
      for(let c=0;c<3;c++)horizontal[i+c]+=values[j+c]*w;
    }
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*3;
    for(let k=-radius;k<=radius;k++){
      const j=(Math.max(0,Math.min(height-1,y+k))*width+x)*3,w=kernel[k+radius];
      for(let c=0;c<3;c++)result[i+c]+=horizontal[j+c]*w;
    }
  }
  return result;
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
  // Line extraction uses a continuous difference-of-Gaussians response below.
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
  // Detect dark strokes, rather than outlining both sides of every pixel edge.
  // Keep the response continuous so contour interpolation can follow subpixels.
  // DoG stylization background: https://www.kyprianidis.com/p/cag2012/
  const fine=blurRGB(rgb,width,height,.45),broad=blurRGB(rgb,width,height,1.0),edges=new Float32Array(count);
  for(let i=0;i<count;i++){
    const r=broad[i*3]-fine[i*3],g=broad[i*3+1]-fine[i*3+1],b=broad[i*3+2]-fine[i*3+2];
    if(alpha[i])edges[i]=Math.max(0,.2126*r+.7152*g+.0722*b,Math.max(r,g,b)*.55);
  }
  return { width, height, darkness, cleanTones:openTones(darkness,width,height), edges, outline:alpha.some(a=>a<255)?trace(alpha,width,height,127.5):'' };
}

function lineMask(analysis, strength) {
  const {width,height,edges} = analysis, high = 16-.14*strength, low = high*.45;
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
  return Float32Array.from(edges,(value,i)=>selected[i]?value:0);
}

// Remove narrow ink from tonal fills when line art is enabled. Otherwise a
// correctly thinned stroke would still sit on its original thick black/gray band.
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

// Two-pass topology-preserving thinning (Zhang & Suen, 1984), followed by
// subpixel ridge fitting. Width is applied only to the resulting SVG strokes.
// https://doi.org/10.1145/357994.358023
const thinningTables=[0,1].map(pass=>Uint8Array.from({length:256},(_,bits)=>{
  const p=Array.from({length:8},(_,i)=>(bits>>i)&1),count=p.reduce((a,b)=>a+b,0);
  const transitions=p.reduce((sum,value,i)=>sum+(!value&&p[(i+1)%8]?1:0),0);
  return count>=2&&count<=6&&transitions===1&&(pass?!p[0]||!p[2]||!p[6]:!p[0]||!p[2]||!p[4])&&(pass?!p[0]||!p[4]||!p[6]:!p[2]||!p[4]||!p[6])?1:0;
}));

// Fit continuous cubics within a subpixel error bound instead of following
// every raster step with a short straight segment. Endpoints and junctions
// remain fixed; sharp turns are fitted as separate curves.
function smoothLinePath(points, closed) {
  const last=points.length-1,unit=(x,y)=>{const length=Math.hypot(x,y)||1;return [x/length,y/length];};
  const pair=p=>fmt(p[0])+','+fmt(p[1]);
  if(last===0)return `M${pair(points[0])}h0`;
  const corner=new Uint8Array(points.length),turns=new Float32Array(points.length);
  if(last>20)for(let i=2;i<last-2;i++){
    const a=points[i-2],p=points[i],b=points[i+2],u=unit(p[0]-a[0],p[1]-a[1]),v=unit(b[0]-p[0],b[1]-p[1]);
    turns[i]=1-u[0]*v[0]-u[1]*v[1];
  }
  for(let i=2;i<last-2;i++)if(turns[i]>.7&&turns[i]>turns[i-1]&&turns[i]>=turns[i+1])corner[i]=1;
  points=points.map((p,i)=>{
    if(corner[i]||(!closed&&(i===0||i===last)))return p;
    const a=points[closed?(i+last-1)%last:i-1],b=points[closed?(i+1)%last:i+1];
    return [(a[0]+2*p[0]+b[0])/4,(a[1]+2*p[1]+b[1])/4];
  });
  if(closed)points[last]=points[0];
  const cuts=[0];for(let i=1;i<last;i++)if(corner[i])cuts.push(i);cuts.push(last);
  const distances=[0];
  for(let i=1;i<=last;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const total=distances[last];
  if(total<.00001)return `M${pair(points[0])}h0`;
  function at(distance) {
    if(closed)distance=((distance%total)+total)%total;
    distance=Math.max(0,Math.min(total,distance));
    let low=0,high=last;
    while(high-low>1){const middle=(low+high)>>1;if(distances[middle]<=distance)low=middle;else high=middle;}
    const t=(distance-distances[low])/(distances[high]-distances[low]||1);
    return [points[low][0]*(1-t)+points[high][0]*t,points[low][1]*(1-t)+points[high][1]*t];
  }
  // Quadratic-preserving smoothing on equal arc-length samples removes raster
  // wobble without the shrinking caused by repeated neighbor averaging.
  const weights=[-21,14,39,54,59,54,39,14,-21];let section=1;
  const smooth=points.map((p,i)=>{
    while(section<cuts.length-1&&i>cuts[section])section++;
    const from=distances[cuts[section-1]],to=distances[cuts[section]],distance=distances[i];
    const periodic=closed&&cuts.length===2;
    const radius=Math.min(4,(to-from)/10,periodic?Infinity:Math.min(distance-from,to-distance));
    if(corner[i]||radius<.1)return p;
    let x=0,y=0;
    for(let k=0;k<9;k++){const q=at(distance+(k-4)*radius/4);x+=weights[k]*q[0]/231;y+=weights[k]*q[1]/231;}
    const displacement=Math.hypot(x-p[0],y-p[1]),limit=Math.min(1,.6/(displacement||1));
    return [p[0]+(x-p[0])*limit,p[1]+(y-p[1])*limit];
  });
  if(closed)smooth[last]=smooth[0];
  const commands=[`M${pair(smooth[0])}`],tolerance=.2;
  function fit(first,end,left,right) {
    const pending=[[first,end,left,right]];
    while(pending.length){
      const [first,end,left,right]=pending.pop();
      const a=smooth[first],b=smooth[end],parameters=[0];let length=0;
      for(let i=first+1;i<=end;i++){length+=Math.hypot(smooth[i][0]-smooth[i-1][0],smooth[i][1]-smooth[i-1][1]);parameters.push(length);}
      if(length<.00001)continue;
      for(let i=1;i<parameters.length;i++)parameters[i]/=length;
      let c11=0,c12=0,c22=0,d1=0,d2=0;
      for(let i=first+1;i<end;i++){
        const t=parameters[i-first],s=1-t,b1=3*s*s*t,b2=3*s*t*t,b0=s*s*s,b3=t*t*t;
        const x=smooth[i][0]-a[0]*(b0+b1)-b[0]*(b2+b3),y=smooth[i][1]-a[1]*(b0+b1)-b[1]*(b2+b3);
        c11+=b1*b1;c12+=b1*b2*(left[0]*right[0]+left[1]*right[1]);c22+=b2*b2;
        d1+=b1*(left[0]*x+left[1]*y);d2+=b2*(right[0]*x+right[1]*y);
      }
      const determinant=c11*c22-c12*c12;
      let l=determinant>1e-9?(d1*c22-d2*c12)/determinant:length/3,r=determinant>1e-9?(d2*c11-d1*c12)/determinant:length/3;
      if(l<length*.0001||r<length*.0001||l>length||r>length)l=r=length/3;
      const c=[a[0]+left[0]*l,a[1]+left[1]*l],d=[b[0]+right[0]*r,b[1]+right[1]*r];
      let error=0,split=Math.floor((first+end)/2);
      for(let i=first+1;i<end;i++){
        const t=parameters[i-first],s=1-t,x=a[0]*s*s*s+3*c[0]*s*s*t+3*d[0]*s*t*t+b[0]*t*t*t,y=a[1]*s*s*s+3*c[1]*s*s*t+3*d[1]*s*t*t+b[1]*t*t*t;
        const distance=(x-smooth[i][0])**2+(y-smooth[i][1])**2;
        if(distance>error){error=distance;split=i;}
      }
      if(error<=tolerance*tolerance||end-first===1){commands.push(`C${pair(c)} ${pair(d)} ${pair(b)}`);continue;}
      const before=smooth[Math.max(first,split-2)],after=smooth[Math.min(end,split+2)],tangent=unit(after[0]-before[0],after[1]-before[1]);
      pending.push([split,end,tangent,right],[first,split,left,[-tangent[0],-tangent[1]]]);
    }
  }
  const seam=closed?unit(smooth[1][0]-smooth[last-1][0],smooth[1][1]-smooth[last-1][1]):null;
  for(let i=1;i<cuts.length;i++){
    const first=cuts[i-1],end=cuts[i],a=smooth[first],b=smooth[end],next=smooth[Math.min(end,first+2)],previous=smooth[Math.max(first,end-2)];
    const left=closed&&first===0?seam:unit(next[0]-a[0],next[1]-a[1]),right=closed&&end===last?[-seam[0],-seam[1]]:unit(previous[0]-b[0],previous[1]-b[1]);
    fit(first,end,left,right);
  }
  return commands.join('')+(closed?'Z':'');
}


function traceLines(analysis,strength) {
  const {width,height,edges}=analysis,mask=lineMask(analysis,strength),stride=width+2;
  const pixels=new Uint8Array(stride*(height+2)),active=[],remove=[];
  const offsets=[-stride,1-stride,1,stride+1,stride,stride-1,-1,-stride-1];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]>0){const i=(y+1)*stride+x+1;pixels[i]=1;active.push(i);}
  let changed=true;
  while(changed){
    changed=false;
    for(const table of thinningTables){
      remove.length=0;
      for(const i of active)if(pixels[i]){
        let bits=0;
        for(let k=0;k<8;k++)bits|=pixels[i+offsets[k]]<<k;
        if(table[bits])remove.push(i);
      }
      for(const i of remove)pixels[i]=0;
      if(remove.length)changed=true;
    }
  }
  const links=new Uint8Array(pixels.length),degrees=new Uint8Array(pixels.length),visited=new Uint8Array(pixels.length);
  for(const i of active)if(pixels[i])for(let k=0;k<8;k++){
    // Prefer orthogonal connections over redundant diagonal shortcuts at bends.
    if(!pixels[i+offsets[k]]||(k%2&&(pixels[i+offsets[(k+7)%8]]||pixels[i+offsets[(k+1)%8]])))continue;
    links[i]|=1<<k;degrees[i]++;
  }
  const sample=(x,y)=>{
    x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),tx=x-x0,ty=y-y0;
    return (edges[y0*width+x0]*(1-tx)+edges[y0*width+x1]*tx)*(1-ty)+(edges[y1*width+x0]*(1-tx)+edges[y1*width+x1]*tx)*ty;
  };
  const paths=[];
  function append(chain) {
    const loop=chain.length>2&&chain[0]===chain.at(-1),last=chain.length-1;
    const points=chain.map(i=>[i%stride-1,Math.floor(i/stride)-1]);
    const fitted=points.map((p,j)=>{
      if(degrees[chain[j]]!==2)return [p[0]+.5,p[1]+.5];
      const a=points[loop?(j+last-2)%last:Math.max(0,j-2)],b=points[loop?(j+2)%last:Math.min(last,j+2)];
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
      const left=sample(p[0]-nx,p[1]-ny),center=sample(...p),right=sample(p[0]+nx,p[1]+ny),curvature=left-2*center+right;
      const shift=curvature<-.001?Math.max(-.6,Math.min(.6,.5*(left-right)/curvature)):0;
      return [p[0]+.5+shift*nx,p[1]+.5+shift*ny];
    });
    if(loop)fitted[last]=fitted[0];
    paths.push(smoothLinePath(fitted,loop));
  }
  function follow(start,direction) {
    const chain=[start];let i=start,k=direction;
    while(true){
      visited[i]|=1<<k;
      const next=i+offsets[k];visited[next]|=1<<((k+4)%8);chain.push(next);
      if(next===start||degrees[next]!==2)break;
      i=next;k=-1;
      for(let d=0;d<8;d++)if((links[i]&(1<<d))&&!(visited[i]&(1<<d))){k=d;break;}
      if(k<0)break;
    }
    append(chain);
  }
  for(const i of active)if(pixels[i]&&degrees[i]!==2){
    if(!degrees[i])append([i]);
    for(let k=0;k<8;k++)if((links[i]&(1<<k))&&!(visited[i]&(1<<k)))follow(i,k);
  }
  for(const i of active)if(pixels[i])for(let k=0;k<8;k++)if((links[i]&(1<<k))&&!(visited[i]&(1<<k)))follow(i,k);
  return paths.join('');
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
    const toneValues=p.lineArt?analysis.cleanTones:darkness;
    const black = cachedPath(tones,'b'+p.blackLevel+':'+p.lineArt,()=>trace(toneValues,width,height,255-p.blackLevel));
    const gray = cachedPath(tones,'g'+p.whiteLevel+':'+p.lineArt,()=>trace(toneValues,width,height,255-p.whiteLevel+.0001));
    const geometry=single?imageMaskGeometry(single,doc):null;
    const id='manga-'+esc(layer.id),sx=(geometry?.width??doc.width)/width,sy=(geometry?.height??doc.height)/height;
    const transform=(geometry?geometry.transform+` translate(${fmt(-geometry.width/2)} ${fmt(-geometry.height/2)}) `:'')+`scale(${fmt(sx)} ${fmt(sy)})`;
    const spacing=Math.max(doc.width,doc.height)/p.toneDensity;
    const defs=`<mask id="${id}-alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" mask-type="alpha"><use href="#${esc(sourceGroupId)}"/></mask><path id="${id}-gray" d="${gray}" fill-rule="evenodd"/>`+
      (p.screentone?`<pattern id="${id}-screen" patternUnits="userSpaceOnUse" width="${Number((spacing/sx).toPrecision(9))}" height="${Number((spacing/sy).toPrecision(9))}" viewBox="0 0 1 1" preserveAspectRatio="none"><g fill="#000000">${screenGlyph(p.toneShape,p.toneSize/100)}</g></pattern>`:'');
    let line='';
    if (p.lineArt) {
      const path=cachedPath(lines,p.lineStrength,()=>traceLines(analysis,p.lineStrength));
      line=`<path data-manga-lines="true" d="${path}" fill="none" stroke="#000000" stroke-width="${fmt(p.lineWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`+(analysis.outline?`<path d="${analysis.outline}" fill="none" stroke="#000000" stroke-width="${fmt(p.lineWidth)}" stroke-linejoin="round"/>`:'');
    }
    return `<defs>${defs}</defs><g data-manga="true" mask="url(#${id}-alpha)"><rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/><g transform="${transform}"><use data-manga-gray="true" href="#${id}-gray" fill="#888888"/>${p.screentone?`<use data-manga-screen="true" href="#${id}-gray" fill="url(#${id}-screen)"/>`:''}<path data-manga-black="true" d="${black}" fill="#000000" fill-rule="evenodd"/>${line}</g></g>`;
  }
  return { render };
}
