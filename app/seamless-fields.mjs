/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {emptyBounds,includeBounds,periodicCells,shortestSpacing} from './periodic.mjs';

const MAX_PRIMITIVES=6500;
const MAX_FIELD_CELLS=600;
const fmt=value=>String(Number((Number.isFinite(value)?value:0).toFixed(3)));
const xy=(x,y)=>`${fmt(x)},${fmt(y)}`;
const length=vector=>Math.hypot(vector[0],vector[1]);
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const mul=(a,k)=>[a[0]*k,a[1]*k];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const pointAt=(center,u,v,s,t)=>[center[0]+u[0]*s+v[0]*t,center[1]+u[1]*s+v[1]*t];

function strokePath(d,color,width,extra='') {
  return d?`<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(width)}"${extra?` ${extra}`:''}/>`:'';
}

function includeSegment(bounds,a,b,width) {
  const radius=width/2;
  includeBounds(bounds,a[0],a[1],radius);
  includeBounds(bounds,b[0],b[1],radius);
}

function pointString(point) { return xy(point[0],point[1]); }

function lineAngle(layer,params) {
  const direction=params.direction==='vertical'?Math.PI/2:params.direction==='diagonal'?Math.PI/4:0;
  return (layer.rotation||0)*Math.PI/180+(params.angle||0)*Math.PI/180+direction;
}

function renderWaves(layer,doc) {
  const p=layer.params,w=doc.width,h=doc.height,scale=layer.scale||1,frequency=Math.max(1,Math.round(p.frequency));
  const rowSpacing=Math.max(p.spacing,Math.sqrt(w*h/240));
  const field=periodicCells({width:w,height:h,u:[w/frequency,0],v:[0,rowSpacing],angle:(layer.rotation||0)*Math.PI/180,scale,maxCells:MAX_FIELD_CELLS});
  const {u,v,cells}=field,uLength=length(u),normal=[-u[1]/uLength,u[0]/uLength],rowPitch=Math.abs(cross(u,v))/uLength;
  const strokeWidth=Math.min(p.strokeWidth*scale,rowPitch*.9),amplitude=Math.min(p.amplitude*scale,Math.max(0,(rowPitch-strokeWidth)*.49));
  const phase=p.phase*Math.PI/180,samples=48,bounds=emptyBounds(),paths=[];
  for(const cell of cells){
    const center=[cell.x,cell.y],commands=[];
    for(let sample=0;sample<=samples;sample++){
      const t=sample/samples,signal=Math.sin(t*Math.PI*2+phase),wave=p.style==='zigzag'?2/Math.PI*Math.asin(signal):signal;
      const point=add(add(center,mul(u,t-.5)),mul(normal,amplitude*wave));
      commands.push(`${sample?'L':'M'}${pointString(point)}`);
    }
    paths.push(strokePath(commands.join(''),layer.color,strokeWidth));
    const rx=Math.abs(u[0])/2+Math.abs(normal[0])*amplitude+strokeWidth/2,ry=Math.abs(u[1])/2+Math.abs(normal[1])*amplitude+strokeWidth/2;
    includeBounds(bounds,center[0],center[1],rx,ry);
  }
  return {content:paths.join(''),bounds};
}

function renderLines(layer,doc) {
  const p=layer.params,w=doc.width,h=doc.height,scale=layer.scale||1,dotted=p.direction==='dotted',dashed=dotted||p.dashGap>0;
  const spacing=Math.max(p.spacing,Math.sqrt(w*h/180)),sourcePeriod=dashed?Math.max(1,p.dashLength+p.dashGap):Math.max(1,p.dashLength);
  const field=periodicCells({width:w,height:h,u:[sourcePeriod,0],v:[0,spacing],angle:lineAngle(layer,p),scale,maxCells:MAX_FIELD_CELLS});
  const {u,v,cells}=field,uLength=length(u),alongPitch=uLength,rowPitch=Math.abs(cross(u,v))/uLength;
  const periodRatio=dashed?clamp(p.dashLength/sourcePeriod,0,1):1;
  const strokeWidth=Math.min(p.strokeWidth*scale,rowPitch*.9,dotted?alongPitch*.4:Infinity),markLength=dotted?Math.min(scale,Math.max(.05,alongPitch-strokeWidth*1.25)):uLength*periodRatio;
  const ux=u[0]/uLength,uy=u[1]/uLength,bounds=emptyBounds(),paths=[];
  for(const cell of cells){
    const center=[cell.x,cell.y],start=add(center,mul(u,-.5)),end=add(start,[ux*markLength,uy*markLength]);
    paths.push(strokePath(`M${pointString(start)}L${pointString(end)}`,layer.color,strokeWidth,dotted?'stroke-linecap="round"':''));
    includeSegment(bounds,start,end,strokeWidth);
  }
  return {content:paths.join(''),bounds};
}

function edgeSegments(start,end,endTrim,centerTrim) {
  const distance=length(sub(end,start)),lo=Math.min(distance,Math.max(0,endTrim)),hi=Math.max(lo,distance-lo),middle=distance/2,gap=Math.min(Math.max(0,centerTrim),Math.max(0,hi-lo));
  const ranges=gap?[[lo,Math.min(hi,middle-gap/2)],[Math.max(lo,middle+gap/2),hi]]:[[lo,hi]];
  return ranges.filter(([a,b])=>b-a>1e-6).map(([a,b])=>[add(start,mul(sub(end,start),a/distance)),add(start,mul(sub(end,start),b/distance))]);
}

function pushSegment(paths,bounds,start,end,width) {
  paths.push(`M${pointString(start)}L${pointString(end)}`);
  includeSegment(bounds,start,end,width);
}

function transformedPoint(x,y,w,h,rotation,scale) {
  const cx=w/2,cy=h/2,dx=x-cx,dy=y-cy,ca=Math.cos(rotation),sa=Math.sin(rotation);
  return [cx+scale*(ca*dx-sa*dy),cy+scale*(sa*dx+ca*dy)];
}

function addCornerMarks(layer,doc,rotation,scale,bounds,parts) {
  const p=layer.params,shape=p.cornerShape;if(shape==='none')return 0;
  const w=doc.width,h=doc.height,s=Math.min(w,h),inset=Math.min(p.cornerInset,s*.24/scale),ca=Math.cos(rotation),sa=Math.sin(rotation),entries=[
    [inset,inset,1,1],[w-inset,inset,-1,1],[inset,h-inset,1,-1],[w-inset,h-inset,-1,-1],
  ];
  const wrap=(value,extent)=>((value%extent)+extent)%extent,offset=(x,y)=>[scale*(ca*x-sa*y),scale*(sa*x+ca*y)],markPaths=[],marks=[],seen=new Set();
  for(const [x,y,sx,sy] of entries){
    const raw=transformedPoint(x,y,w,h,rotation,scale),origin=[wrap(raw[0],w),wrap(raw[1],h)],key=`${Math.round(origin[0]*1000)}:${Math.round(origin[1]*1000)}`;
    if(seen.has(key))continue;
    seen.add(key);marks.push({x,y,sx,sy,origin});
  }
  const wrappedDistance=(a,b)=>{
    const dx=Math.abs(a.origin[0]-b.origin[0]),dy=Math.abs(a.origin[1]-b.origin[1]);
    return Math.hypot(Math.min(dx,w-dx),Math.min(dy,h-dy));
  };
  for(const {x,y,sx,sy,origin} of marks){
    const nearest=marks.length>1?Math.min(...marks.filter(mark=>mark.origin!==origin).map(mark=>wrappedDistance({origin},mark))):s*.5;
    const roundMark=shape==='circle'||shape==='ring',sizeLimit=nearest*(roundMark ? .44 : .30),worldSize=Math.min(p.cornerSize*scale,s*.22,sizeLimit),size=worldSize/scale;
    let strokeWidth=Math.min(p.strokeWidth*scale,worldSize*.4,nearest*.08);
    if(!roundMark){const radiusLimit=Math.SQRT2*worldSize,joinFactor=shape==='triangle'?1.4:.75;strokeWidth=Math.min(strokeWidth,Math.max(0,(nearest*.49-radiusLimit)/joinFactor));}
    const fill=shape==='ring'?'none':layer.secondary;
    const mapOffset=(dx,dy)=>add(origin,offset(dx,dy));
    if(shape==='circle'||shape==='ring'){
      const radius=worldSize/2;
      markPaths.push(`<circle cx="${fmt(origin[0])}" cy="${fmt(origin[1])}" r="${fmt(radius)}" fill="${fill}" stroke="${layer.secondary}" stroke-width="${fmt(strokeWidth)}"/>`);
      includeBounds(bounds,origin[0],origin[1],radius+strokeWidth/2);
    }else if(shape==='square'){
      const corners=[[0,0],[sx*size,0],[sx*size,sy*size],[0,sy*size]].map(([dx,dy])=>mapOffset(dx,dy));
      markPaths.push(`<polygon points="${corners.map(pointString).join(' ')}" fill="${fill}" stroke="${layer.secondary}" stroke-width="${fmt(strokeWidth)}"/>`);
      for(const point of corners)includeBounds(bounds,point[0],point[1],strokeWidth*.75);
    }else if(shape==='triangle'){
      const corners=[[0,0],[sx*size,0],[0,sy*size]].map(([dx,dy])=>mapOffset(dx,dy));
      markPaths.push(`<polygon points="${corners.map(pointString).join(' ')}" fill="${layer.secondary}" stroke="${layer.secondary}" stroke-width="${fmt(strokeWidth)}"/>`);
      for(const point of corners)includeBounds(bounds,point[0],point[1],strokeWidth*1.4);
    }else{
      const a=mapOffset(0,sy*size),b=origin,c=mapOffset(sx*size,0);
      markPaths.push(`<path d="M${pointString(a)}L${pointString(b)}L${pointString(c)}" fill="none" stroke="${layer.secondary}" stroke-width="${fmt(strokeWidth)}"/>`);
      includeSegment(bounds,a,b,strokeWidth*1.5);includeSegment(bounds,b,c,strokeWidth*1.5);
    }
  }
  parts.push(markPaths.join(''));
  return entries.length;
}

function renderGrid(layer,doc) {
  const p=layer.params,w=doc.width,h=doc.height,scale=layer.scale||1,rotation=(layer.rotation||0)*Math.PI/180;
  const size=Math.max(p.cellSize,Math.sqrt(w*h/900)),diagonalCount=clamp(Math.floor(p.diagonals||0),0,2),hasJunction=p.junction!=='none',hasDots=!!p.dots,hasHatch=!!p.hatch,cornerCount=p.cornerShape==='none'?0:4;
  const segmentsPerCell=4+diagonalCount+(hasJunction?2:0),extraReserve=(hasDots?900:0)+(hasHatch?900:0)+cornerCount;
  const maxGridCells=Math.max(1,Math.min(MAX_FIELD_CELLS,Math.floor((MAX_PRIMITIVES-extraReserve)/segmentsPerCell)));
  const grid=periodicCells({width:w,height:h,u:[size,0],v:[0,size],angle:rotation,scale,maxCells:maxGridCells}),{u,v,cells}=grid;
  const uLength=length(u),vLength=length(v),determinant=Math.abs(cross(u,v)),minPitch=Math.min(shortestSpacing(u,v),uLength,vLength),parallelPitch=Math.min(determinant/uLength,determinant/vLength),bounds=emptyBounds(),content=[];
  const strokeWidth=Math.min(p.strokeWidth*scale,parallelPitch*.8),diagonalWidth=Math.min(p.diagonalWidth*scale,parallelPitch*.8),cellMinimum=Math.min(uLength,vLength),endTrim=Math.min(p.cornerTrim*cellMinimum,cellMinimum*.49),centerTrim=Math.min(p.centerTrim*cellMinimum,cellMinimum*.98);
  const baseSegments=[],diagonalSegments=[],junctionSegments=[];
  for(const cell of cells){
    const center=[cell.x,cell.y],a=pointAt(center,u,v,-.5,-.5),b=pointAt(center,u,v,.5,-.5),c=pointAt(center,u,v,.5,.5),d=pointAt(center,u,v,-.5,.5);
    for(const [start,end] of [[a,b],[d,a]])for(const [partStart,partEnd] of edgeSegments(start,end,endTrim,centerTrim))pushSegment(baseSegments,bounds,partStart,partEnd,strokeWidth);
    if(diagonalCount>0)pushSegment(diagonalSegments,bounds,a,c,diagonalWidth);
    if(diagonalCount>1)pushSegment(diagonalSegments,bounds,b,d,diagonalWidth);
    if(hasJunction){
      const markSize=Math.min(p.junctionSize*scale,minPitch*.44),markWidth=Math.min(p.junctionWidth*scale,minPitch*.08);
      pushSegment(junctionSegments,bounds,add(a,mul(u,-markSize/uLength)),add(a,mul(u,markSize/uLength)),markWidth);
      pushSegment(junctionSegments,bounds,add(a,mul(v,-markSize/vLength)),add(a,mul(v,markSize/vLength)),markWidth);
    }
  }
  const dashAttr=p.lineStyle==='dashed'?` stroke-dasharray="${fmt(p.dashLength*scale)} ${fmt(p.dashGap*scale)}"`:'';
  content.push(strokePath(baseSegments.join(''),layer.color,strokeWidth,dashAttr));
  if(diagonalSegments.length)content.push(strokePath(diagonalSegments.join(''),layer.secondary,diagonalWidth));
  if(junctionSegments.length)content.push(strokePath(junctionSegments.join(''),layer.secondary,Math.min(p.junctionWidth*scale,minPitch*.08)));
  const primitives=cells.length*segmentsPerCell;
  const remaining=Math.max(0,MAX_PRIMITIVES-primitives-cornerCount),enabledFields=Number(hasDots)+Number(hasHatch),fieldLimit=enabledFields?Math.floor(remaining/enabledFields):0;
  if(hasDots&&fieldLimit>0){
    const spacing=Math.max(p.dotSpacing,Math.sqrt(w*h/1200)),dotField=periodicCells({width:w,height:h,u:[spacing,0],v:[0,spacing],angle:rotation,scale,maxCells:fieldLimit}),radius=Math.min(p.dotSize*scale/2,dotField.spacing*.45);
    for(const cell of dotField.cells){content.push(`<circle cx="${fmt(cell.x)}" cy="${fmt(cell.y)}" r="${fmt(radius)}" fill="${layer.secondary}"/>`);includeBounds(bounds,cell.x,cell.y,radius);}
  }
  if(hasHatch&&fieldLimit>0){
    const spacing=Math.max(p.hatchSpacing,Math.sqrt(w*h/1200)),hatchField=periodicCells({width:w,height:h,u:[spacing,0],v:[0,spacing],angle:rotation,scale,maxCells:fieldLimit}),d=sub(hatchField.u,hatchField.v),hatchParallelPitch=Math.abs(cross(hatchField.u,hatchField.v))/length(d),hatchWidth=Math.min(p.hatchWidth*scale,hatchParallelPitch*.8),hatchSegments=[];
    for(const cell of hatchField.cells){const center=[cell.x,cell.y],start=add(center,mul(d,-.5)),end=add(center,mul(d,.5));pushSegment(hatchSegments,bounds,start,end,hatchWidth);}
    content.push(strokePath(hatchSegments.join(''),layer.secondary,hatchWidth));
  }
  addCornerMarks(layer,doc,rotation,scale,bounds,content);
  return {content:content.join(''),bounds};
}

export function renderSeamlessField(layer,doc) {
  if(!doc.seamless)return null;
  if(layer.type==='waves')return renderWaves(layer,doc);
  if(layer.type==='lines')return renderLines(layer,doc);
  if(layer.type==='grid')return renderGrid(layer,doc);
  return null;
}
