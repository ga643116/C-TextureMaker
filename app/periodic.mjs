/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Fit a lattice to the canvas periods so boundary cells have exactly one owner.
export function fitPeriodicBasis(u,v,w,h,angle,scale,maxCells=Infinity) {
  const ca=Math.cos(angle),sa=Math.sin(angle),rotate=([x,y])=>[scale*(ca*x-sa*y),scale*(sa*x+ca*y)],desiredU=rotate(u),desiredV=rotate(v),det=desiredU[0]*desiredV[1]-desiredV[0]*desiredU[1];
  const target=[desiredV[1]*w/det,-desiredV[0]*h/det,-desiredU[1]*w/det,desiredU[0]*h/det].map(Math.round),norm=desiredU[0]**2+desiredU[1]**2+desiredV[0]**2+desiredV[1]**2;
  let best=null;
  for(let da=-2;da<=2;da++)for(let db=-2;db<=2;db++)for(let dc=-2;dc<=2;dc++)for(let dd=-2;dd<=2;dd++){
    const a=target[0]+da,b=target[1]+db,c=target[2]+dc,d=target[3]+dd,count=a*d-b*c;if(count<=0||count>maxCells)continue;
    const fittedU=[w*d/count,-h*c/count],fittedV=[-w*b/count,h*a/count],error=((fittedU[0]-desiredU[0])**2+(fittedU[1]-desiredU[1])**2+(fittedV[0]-desiredV[0])**2+(fittedV[1]-desiredV[1])**2)/norm;
    if(!best||error<best.error)best={u:fittedU,v:fittedV,error,count};
  }
  if(!best)throw new TypeError('Unable to fit seamless lattice');
  return best;
}

export function shortestSpacing(u,v) {
  let a=[...u],b=[...v];
  for(let i=0;i<32;i++){
    if(a[0]**2+a[1]**2>b[0]**2+b[1]**2)[a,b]=[b,a];
    const n=Math.round((a[0]*b[0]+a[1]*b[1])/(a[0]**2+a[1]**2));
    if(n===0)break;
    b=[b[0]-n*a[0],b[1]-n*a[1]];
  }
  return Math.hypot(...a);
}

export function periodicCells({width:w,height:h,u,v,angle=0,scale=1,maxCells=600}) {
  const area=Math.abs(u[0]*v[1]-u[1]*v[0])*scale*scale,fit=Math.max(1,Math.sqrt(w*h/(area*maxCells)));
  const period=fitPeriodicBasis(u.map(x=>x*fit),v.map(x=>x*fit),w,h,angle,scale,maxCells),U=period.u,V=period.v,det=U[0]*V[1]-V[0]*U[1];
  const ca=Math.cos(angle),sa=Math.sin(angle),origin=[w/2-scale*(ca*w/2-sa*h/2),h/2-scale*(sa*w/2+ca*h/2)];
  const inverse=([x,y])=>{const dx=x-origin[0],dy=y-origin[1];return [(V[1]*dx-V[0]*dy)/det,(-U[1]*dx+U[0]*dy)/det];};
  const corners=[[0,0],[w,0],[w,h],[0,h]].map(inverse),minI=Math.floor(Math.min(...corners.map(p=>p[0])))-1,maxI=Math.ceil(Math.max(...corners.map(p=>p[0])))+1,minJ=Math.floor(Math.min(...corners.map(p=>p[1])))-1,maxJ=Math.ceil(Math.max(...corners.map(p=>p[1])))+1,cells=[];
  for(let j=minJ;j<=maxJ;j++)for(let i=minI;i<=maxI;i++){
    let x=origin[0]+(i+.5)*U[0]+(j+.5)*V[0],y=origin[1]+(i+.5)*U[1]+(j+.5)*V[1];
    if(Math.abs(x)<1e-7)x=0;if(Math.abs(y)<1e-7)y=0;
    if(x>=0&&x<w-1e-7&&y>=0&&y<h-1e-7)cells.push({x,y,i,j});
  }
  const rowBase=Math.min(...cells.map(p=>p.j)),colBase=Math.min(...cells.map(p=>p.i));
  for(const cell of cells){cell.row=cell.j-rowBase;cell.col=cell.i-colBase;}
  return {cells,u:U,v:V,spacing:shortestSpacing(U,V)};
}

export function emptyBounds() { return {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity}; }
export function includeBounds(bounds,x,y,rx=0,ry=rx) {
  bounds.minX=Math.min(bounds.minX,x-rx);bounds.maxX=Math.max(bounds.maxX,x+rx);
  bounds.minY=Math.min(bounds.minY,y-ry);bounds.maxY=Math.max(bounds.maxY,y+ry);
}
