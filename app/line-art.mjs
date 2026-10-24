/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import {prepareFlow,extractFlow} from './flow-xdog.mjs';
import {encodeAlphaPNG} from './alpha-png.mjs';

const fmt=n=>String(Number(n.toFixed(6)));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const bound=(v,min,max,fallback)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;

// Width adjusts the coverage around the extracted strokes, without tracing
// another centerline. A fractional pixel radius keeps thin settings continuous.
function lineWeight(alpha,width,height,weight) {
  if(weight===1)return alpha;
  const radius=Math.abs(weight-1)/2,whole=Math.floor(radius),fraction=radius-whole;
  const dilate=weight>1,extreme=(x,y,r)=>{
    let value=dilate?0:255;
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const a=alpha[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))];
      value=dilate?Math.max(value,a):Math.min(value,a);
    }
    return value;
  };
  const out=new Uint8Array(alpha.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const a=extreme(x,y,whole),b=fraction?extreme(x,y,whole+1):a;
    out[y*width+x]=Math.round(a+(b-a)*fraction);
  }
  return out;
}

export function createLineArtEngine({resolveColorSources,imageMaskGeometry,createCompositeColorSampler,createImageColorSampler}) {
  const cache=[];
  function prepare(doc,layer) {
    const sources=resolveColorSources(doc,layer).filter(source=>source.colorMap);
    if(!sources.length)return null;
    const single=sources.length===1?sources[0]:null;
    const extentWidth=single?single.colorMap.width:doc.width,extentHeight=single?single.colorMap.height:doc.height;
    const ratio=Math.min(1,1024/Math.max(extentWidth,extentHeight));
    const width=Math.max(1,Math.round(extentWidth*ratio)),height=Math.max(1,Math.round(extentHeight*ratio));
    const maps=sources.map(source=>source.colorMap.rgba);
    const key=JSON.stringify(single?['single',extentWidth,extentHeight]:[doc.width,doc.height,sources.map(source=>[source.id,source.colorMap.width,source.colorMap.height,imageMaskGeometry(source,doc),source.rotation,source.flipX,source.flipY])]);
    let entry=cache.find(item=>item.key===key&&item.maps.length===maps.length&&maps.every((map,i)=>map===item.maps[i]));
    if(!entry){
      const sample=single?createImageColorSampler({...single,rotation:0,flipX:false,flipY:false},{cx:extentWidth/2,cy:extentHeight/2,width:extentWidth,height:extentHeight}):createCompositeColorSampler(doc,layer);
      const rgba=new Uint8ClampedArray(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(sample((x+.5)*extentWidth/width,(y+.5)*extentHeight/height),(y*width+x)*4);
      entry={key,maps,width,height,rgba,flow:null,ink:new Map(),images:new Map()};
      cache.unshift(entry);if(cache.length>3)cache.pop();
    }
    const geometry=single?imageMaskGeometry(single,doc):null;
    const sx=(geometry?.width??doc.width)/width,sy=(geometry?.height??doc.height)/height;
    const transform=(geometry?geometry.transform+` translate(${fmt(-geometry.width/2)} ${fmt(-geometry.height/2)}) `:'')+`scale(${fmt(sx)} ${fmt(sy)})`;
    return {entry,single,transform,sx,sy};
  }
  function limited(cache,key,compute){
    if(cache.has(key))return cache.get(key);
    const result=compute();if(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  }
  function render(doc,layer,{prepared=prepare(doc,layer),color=layer.params.lineColor??'#000000',preview=false,sourceMaskApplied=false}={}) {
    if(!prepared)return '';
    const {entry,transform}=prepared,{width,height}=entry,p=layer.params;
    const weight=bound(p.lineWidth,0,12,1);if(!weight)return '';
    const detail=bound(p.lineDetail,49,249,99),smooth=bound(p.lineSmooth,1.2,3.6,2.4),scale=bound(p.lineScale,.6,1.2,.8);
    const key=JSON.stringify([detail,smooth,scale]);
    const alpha=limited(entry.ink,key,()=>{
      entry.flow??=prepareFlow(entry.rgba,width,height);
      return extractFlow(entry.flow,{lineDetail:detail,lineSmooth:smooth,lineScale:scale});
    });
    const png=limited(entry.images,key+':'+weight+':'+sourceMaskApplied,()=>{
      const weighted=lineWeight(alpha,width,height,weight).slice();
      // Dilation must not paint over transparent holes in the source.
      for(let i=0;i<weighted.length;i++){
        const opacity=entry.rgba[i*4+3];
        weighted[i]=Math.min(weighted[i],opacity);
        // Manga applies source opacity once to its combined paper and ink.
        if(sourceMaskApplied)weighted[i]=opacity?Math.round(weighted[i]*255/opacity):0;
      }
      return encodeAlphaPNG(weighted,width,height);
    });
    const id='flow-ink-'+esc(layer.id),fill=preview&&layer.type==='redraw'?` data-redraw-line-fill="${esc(layer.id)}"`:'';
    return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" mask-type="alpha"><image href="${png}" width="${width}" height="${height}" preserveAspectRatio="none"/></mask></defs><g data-flow-lines="true" transform="${transform}" pointer-events="none"><rect width="${width}" height="${height}" fill="${esc(color)}" mask="url(#${id})"${fill}/></g>`;
  }
  return {prepare,render};
}
