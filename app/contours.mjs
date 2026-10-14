/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { contours as makeContours } from 'd3-contour';
import { fitPeriodicBasis } from './periodic.mjs';

const fmt = value => {
  const v = Number.isFinite(value) ? Math.max(-1e7, Math.min(1e7, value)) : 0;
  return String(Number(v.toFixed(3)));
};
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const xy = (x,y) => fmt(x)+','+fmt(y);
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function hashSeed(seed, id) { let h=seed>>>0; for (const c of id) h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0; }

function stitchContourSegments(segments,w,h,periodic) {
  if(!segments.length)return [];
  const epsX=w*1e-7,epsY=h*1e-7,qx=Math.max(1,Math.round(w/epsX)),qy=Math.max(1,Math.round(h/epsY));
  const key=([x,y])=>{let ix=Math.round(x/epsX),iy=Math.round(y/epsY);if(periodic){ix=((ix%qx)+qx)%qx;iy=((iy%qy)+qy)%qy;}return ix+':'+iy;};
  const links=new Map(),visited=new Uint8Array(segments.length);
  for(let i=0;i<segments.length;i++)for(let end=0;end<2;end++){const k=key(segments[i][end]),list=links.get(k)??[];list.push([i,end]);links.set(k,list);}
  const unwrap=(p,near)=>periodic?[p[0]+Math.round((near[0]-p[0])/w)*w,p[1]+Math.round((near[1]-p[1])/h)*h]:p;
  const chains=[];
  const walk=(firstId,firstEnd)=>{
    let id=firstId,end=firstEnd,start=segments[id][end],current=start,closed=false,used=0;const startKey=key(start),points=[start];
    while(id!==undefined&&!visited[id]&&used<=segments.length){visited[id]=1;used++;const raw=segments[id][1-end],next=unwrap(raw,current);if(Math.hypot(next[0]-current[0],next[1]-current[1])>1e-7)points.push(next);current=next;const k=key(raw);if(k===startKey&&points.length>2){closed=true;break;}const candidate=(links.get(k)??[]).find(([edge])=>!visited[edge]);if(!candidate)break;[id,end]=candidate;}
    if(points.length>1)chains.push({points,closed});
  };
  for(let id=0;id<segments.length;id++)if(!visited[id])for(let end=0;end<2;end++){if((links.get(key(segments[id][end]))??[]).length===1){walk(id,end);break;}}
  for(let id=0;id<segments.length;id++)if(!visited[id])walk(id,0);
  return chains;
}
function contourCurve(chain,bounds) {
  const points=chain.points,closed=chain.closed,unique=closed?points.slice(0,-1):points,n=unique.length;
  if(n<2)return '';
  const delta=closed?[points.at(-1)[0]-points[0][0],points.at(-1)[1]-points[0][1]]:[0,0];
  const at=i=>{
    if(closed){const cycle=Math.floor(i/n),index=i-cycle*n,p=unique[index];return [p[0]+cycle*delta[0],p[1]+cycle*delta[1]];}
    if(i<0)return [unique[0][0]+i*(unique[0][0]-unique[1][0]),unique[0][1]+i*(unique[0][1]-unique[1][1])];
    if(i>=n)return [unique[n-1][0]+(i-n+1)*(unique[n-1][0]-unique[n-2][0]),unique[n-1][1]+(i-n+1)*(unique[n-1][1]-unique[n-2][1])];
    return unique[i];
  };
  const interval=(a,b)=>Math.max(1e-5,Math.sqrt(Math.hypot(b[0]-a[0],b[1]-a[1])));
  const include=p=>{bounds.minX=Math.min(bounds.minX,p[0]);bounds.maxX=Math.max(bounds.maxX,p[0]);bounds.minY=Math.min(bounds.minY,p[1]);bounds.maxY=Math.max(bounds.maxY,p[1]);};
  const count=closed?n:n-1;let d='M'+xy(...unique[0]);include(unique[0]);
  for(let i=0;i<count;i++){
    const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2),h1=interval(p0,p1),h2=interval(p1,p2),h3=interval(p2,p3);
    const dx1=(p1[0]-p0[0])/h1,dy1=(p1[1]-p0[1])/h1,dx2=(p2[0]-p1[0])/h2,dy2=(p2[1]-p1[1])/h2,dx3=(p3[0]-p2[0])/h3,dy3=(p3[1]-p2[1])/h3;
    const m1x=(dx1*h2+dx2*h1)/(h1+h2)*h2,m1y=(dy1*h2+dy2*h1)/(h1+h2)*h2,m2x=(dx2*h3+dx3*h2)/(h2+h3)*h2,m2y=(dy2*h3+dy3*h2)/(h2+h3)*h2;
    const c1=[p1[0]+m1x/3,p1[1]+m1y/3],c2=[p2[0]-m2x/3,p2[1]-m2y/3];d+='C'+xy(...c1)+' '+xy(...c2)+' '+xy(...p2);include(c1);include(c2);include(p2);
  }
  if(closed&&Math.hypot(...delta)<1e-7)d+='Z';
  return d;
}

function clamp(value,min,max,fallback) {
  return Number.isFinite(value) ? Math.max(min,Math.min(max,value)) : fallback;
}
function wrapPeriodicOffset(value,extent) {
  const half=extent/2;
  return ((value+half)%extent+extent)%extent-half;
}
function colorAt(a,b,t) {
  if(t<=0)return a;
  if(t>=1)return b;
  const parse=value=>{
    const match=/^#([\da-f]{6})$/i.exec(value);
    if(!match)return [0,0,0];
    return [parseInt(match[1].slice(0,2),16),parseInt(match[1].slice(2,4),16),parseInt(match[1].slice(4,6),16)];
  };
  const left=parse(a),right=parse(b);
  return '#'+left.map((value,index)=>Math.round(value+(right[index]-value)*t).toString(16).padStart(2,'0')).join('');
}
function finiteBounds(bounds) {
  return Number.isFinite(bounds.minX)&&Number.isFinite(bounds.minY)&&Number.isFinite(bounds.maxX)&&Number.isFinite(bounds.maxY);
}
function shadowMarkup(id,region,shadow) {
  const common=' x="'+fmt(region.minX)+'" y="'+fmt(region.minY)+'" width="'+fmt(region.maxX-region.minX)+'" height="'+fmt(region.maxY-region.minY)+'"';
  const sigma=shadow.range/3;
  const flood='<feFlood flood-color="'+esc(shadow.color)+'" flood-opacity="'+fmt(shadow.opacity)+'" result="contour-shadow-color"/>';
  const offset='<feOffset in="contour-shadow-blur" dx="'+fmt(shadow.dx)+'" dy="'+fmt(shadow.dy)+'" result="contour-shadow-offset"/>';
  let primitives;
  if(shadow.side==='inner'){
    primitives='<feComponentTransfer in="SourceAlpha" result="contour-outside"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
      +'<feGaussianBlur in="contour-outside" stdDeviation="'+fmt(sigma)+'" result="contour-shadow-blur"/>'
      +offset
      +'<feComposite in="contour-shadow-offset" in2="SourceAlpha" operator="in" result="contour-shadow-mask"/>'
      +flood
      +'<feComposite in="contour-shadow-color" in2="contour-shadow-mask" operator="in" result="contour-shadow"/>'
      +'<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="contour-shadow"/></feMerge>';
  } else {
    primitives='<feGaussianBlur in="SourceAlpha" stdDeviation="'+fmt(sigma)+'" result="contour-shadow-blur"/>'
      +offset
      +flood
      +'<feComposite in="contour-shadow-color" in2="contour-shadow-offset" operator="in" result="contour-shadow"/>'
      +'<feMerge><feMergeNode in="contour-shadow"/><feMergeNode in="SourceGraphic"/></feMerge>';
  }
  return '<filter id="'+id+'" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"'+common+'>'+primitives+'</filter>';
}

export function renderContours(layer,doc,{fillPaint=null}={}) {
  const {width:w,height:h,seamless=false}=doc,p=layer.params,c=layer.color,s=layer.secondary;
  const angle=layer.rotation*Math.PI/180,period=seamless?fitPeriodicBasis([w,0],[0,h],w,h,angle,layer.scale):null;
  const n=Math.min(256,Math.max(72,p.sampling)*Math.max(1,Math.ceil(Math.sqrt(period?.count??1)))),rand=rng(hashSeed(doc.seed,layer.id)),scale=Math.sqrt(p.terrainScale),peaks=Array.from({length:p.peaks},()=>({x:rand(),y:rand(),sx:(.12+rand()*.08)/scale,sy:(.12+rand()*.08)/scale,amp:(rand()>.35?1:-1)*(.42+rand()*.38)})),detailCount=Math.min(24,p.peaks*Math.max(0,p.octaves-1));
  for(let i=0;i<detailCount;i++)peaks.push({x:rand(),y:rand(),sx:(.025+rand()*.035)/scale,sy:(.025+rand()*.035)/scale,amp:(rand()>.5?1:-1)*(.08+rand()*.12)});
  const terms=[];
  for(let i=0;i<p.octaves;i++){const k=Math.min(10,Math.max(1,Math.round(p.peaks*(.35+i*.35)*scale))),kx=k,ky=Math.max(1,Math.min(10,Math.round(k*(.75+rand()*.5)))),phaseX=rand()*Math.PI*2,phaseY=rand()*Math.PI*2,phase=rand()*Math.PI*2,amp=.26*Math.pow(p.roughness,i);terms.push([kx,ky,phaseX,phaseY,phase,amp]);}
  const field=(u,v)=>{let z=0;for(const peak of peaks){const dx=Math.sin(Math.PI*(u-peak.x))/peak.sx,dy=Math.sin(Math.PI*(v-peak.y))/peak.sy;z+=peak.amp*Math.exp(-.5*(dx*dx+dy*dy));}for(const [kx,ky,px,py,ph,amp] of terms)z+=amp*(Math.sin(2*Math.PI*kx*u+px)*Math.cos(2*Math.PI*ky*v+py)+.35*Math.sin(2*Math.PI*(ky*u-kx*v)+ph));return z;};
  const sample=(u,v)=>{
    if(!period)return field(u,v);
    const ca=Math.cos(angle),sa=Math.sin(angle),ox=w/2-layer.scale*(ca*w/2-sa*h/2),oy=h/2-layer.scale*(sa*w/2+ca*h/2),dx=u*w-ox,dy=v*h-oy,U=period.u,V=period.v,det=U[0]*V[1]-V[0]*U[1];
    return field((V[1]*dx-V[0]*dy)/det,(-U[1]*dx+U[0]*dy)/det);
  };
  const grid=Array.from({length:n+1},(_,j)=>Array.from({length:n+1},(_,i)=>sample(i/n,j/n)));let lo=Infinity,hi=-Infinity;for(const row of grid)for(const v of row){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  const curveBounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  if(p.depth!==true){
    const edge=(x1,y1,v1,x2,y2,v2,level)=>{const t=(level-v1)/(v2-v1||1e-9);return [x1+(x2-x1)*t,y1+(y2-y1)*t];};
    const out=[];
    for(let levelIndex=1;levelIndex<=p.levels;levelIndex++){
      const level=lo+(hi-lo)*levelIndex/(p.levels+1),segments=[];
      for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        const x0=w*i/n,x1=w*(i+1)/n,y0=h*j/n,y1=h*(j+1)/n,v=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]],pts=[];
        if((v[0]<level)!==(v[1]<level))pts.push(edge(x0,y0,v[0],x1,y0,v[1],level));
        if((v[1]<level)!==(v[2]<level))pts.push(edge(x1,y0,v[1],x1,y1,v[2],level));
        if((v[2]<level)!==(v[3]<level))pts.push(edge(x1,y1,v[2],x0,y1,v[3],level));
        if((v[3]<level)!==(v[0]<level))pts.push(edge(x0,y1,v[3],x0,y0,v[0],level));
        if(pts.length===2)segments.push(pts);
        else if(pts.length===4){const center=(v[0]+v[1]+v[2]+v[3])/4,high=center>=level,pairs=(v[0]>=level)===high?[[0,1],[2,3]]:[[0,3],[1,2]];for(const [a,b] of pairs)segments.push([pts[a],pts[b]]);}
      }
      const chains=stitchContourSegments(segments,w,h,seamless),paths=chains.map(chain=>contourCurve(chain,curveBounds)).filter(Boolean);
      if(paths.length)out.push('<path d="'+paths.join('')+'" fill="none" stroke="'+c+'" stroke-width="'+fmt(p.strokeWidth*(seamless?layer.scale:1))+'" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    return {content:out.join(''),bounds:finiteBounds(curveBounds)?curveBounds:null,world:!!seamless};
  }

  const levelCount=Math.max(1,Math.round(p.levels)),thresholds=[];
  for(let i=0;i<levelCount;i++)thresholds.push(lo+(hi-lo)*(i+1)/(levelCount+1));
  const features=makeContours().size([n+1,n+1]).thresholds(thresholds)(grid.flat());
  const shapes=[];
  for(let index=0;index<features.length;index++){
    const feature=features[index],polygonPaths=[];
    for(const polygon of feature.coordinates){
      const rings=[];
      for(const ring of polygon){
        const points=ring.map(([x,y])=>[(x-.5)*w/n,(y-.5)*h/n]);
        const d=contourCurve({points,closed:true},curveBounds);
        if(d)rings.push(d);
      }
      if(rings.length)polygonPaths.push(rings.join(''));
    }
    if(polygonPaths.length)shapes.push({index,paths:polygonPaths,fill:colorAt(s,c,levelCount===1?1:index/(levelCount-1))});
  }
  if(!shapes.length||!finiteBounds(curveBounds))return {content:'',bounds:null,world:!!seamless};

  const shadowRange=clamp(p.shadowRange,0,128,16),shadowOffset=clamp(p.shadowOffset,0,256,10),shadowAngle=clamp(p.shadowAngle,-180,180,45),shadowColor=typeof p.shadowColor==='string'?p.shadowColor:'#123e3b',shadowOpacity=clamp(p.shadowOpacity,0,1,.35),shadowSide=p.shadowSide==='inner'?'inner':'outer',radians=shadowAngle*Math.PI/180;
  const rawDx=Math.cos(radians)*shadowOffset,rawDy=Math.sin(radians)*shadowOffset;
  const shadow={range:shadowRange,dx:seamless?wrapPeriodicOffset(rawDx,w):rawDx,dy:seamless?wrapPeriodicOffset(rawDy,h):rawDy,color:shadowColor,opacity:shadowOpacity,side:shadowSide};
  const blurReach=seamless?3*Number(fmt(shadowRange/3)):shadowRange,padX=blurReach+Math.abs(shadow.dx)+1,padY=blurReach+Math.abs(shadow.dy)+1;
  const copyRadiusX=seamless?Math.max(1,Math.ceil(padX/w)):0,copyRadiusY=seamless?Math.max(1,Math.ceil(padY/h)):0;
  const region=seamless
    ?{minX:-padX,minY:-padY,maxX:w+padX,maxY:h+padY}
    :{minX:curveBounds.minX-padX,minY:curveBounds.minY-padY,maxX:curveBounds.maxX+padX,maxY:curveBounds.maxY+padY};
  const defs=[],body=[],clipId='contour-depth-'+esc(layer.id)+'-tile';
  if(seamless)defs.push('<clipPath id="'+clipId+'" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="'+fmt(w)+'" height="'+fmt(h)+'"/></clipPath>');
  const bottomFill=fillPaint===null?s:String(fillPaint);
  body.push('<rect x="0" y="0" width="'+fmt(w)+'" height="'+fmt(h)+'" fill="'+esc(bottomFill)+'"/>');
  for(const shape of shapes){
    const filterId='contour-depth-'+esc(layer.id)+'-shadow-'+shape.index,levelId='contour-depth-'+esc(layer.id)+'-level-'+shape.index,fill=fillPaint===null?shape.fill:String(fillPaint);
    const levelMarkup=shape.paths.map(d=>'<path d="'+d+'" fill="'+esc(fill)+'" fill-rule="evenodd"/>').join('');
    if(seamless)defs.push('<g id="'+levelId+'">'+levelMarkup+'</g>');
    defs.push(shadowMarkup(filterId,region,shadow));
    const copies=[];
    for(let ty=-copyRadiusY;ty<=copyRadiusY;ty++)for(let tx=-copyRadiusX;tx<=copyRadiusX;tx++){
      copies.push(seamless?'<use href="#'+levelId+'" x="'+fmt(tx*w)+'" y="'+fmt(ty*h)+'"/>':levelMarkup);
    }
    const filtered='<g filter="url(#'+filterId+')">'+copies.join('')+'</g>';
    body.push(seamless?'<g clip-path="url(#'+clipId+')">'+filtered+'</g>':filtered);
  }
  const content='<defs>'+defs.join('')+'</defs>'+body.join('');
  const bounds=seamless
    ?{minX:0,minY:0,maxX:w,maxY:h}
    :{minX:Math.min(0,curveBounds.minX-padX),minY:Math.min(0,curveBounds.minY-padY),maxX:Math.max(w,curveBounds.maxX+padX),maxY:Math.max(h,curveBounds.maxY+padY)};
  return {content,bounds,world:!!seamless};
}
