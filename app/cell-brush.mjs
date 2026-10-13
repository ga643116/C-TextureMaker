/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Screen-space centers keep the brush circular after layer rotation and scaling.
export function strokeHits(cells, start, end, radius) {
  const dx=end.x-start.x,dy=end.y-start.y,lengthSquared=dx*dx+dy*dy;
  const minX=Math.min(start.x,end.x)-radius,maxX=Math.max(start.x,end.x)+radius;
  const minY=Math.min(start.y,end.y)-radius,maxY=Math.max(start.y,end.y)+radius;
  const hits=new Set();
  for(const cell of cells){
    if(cell.x<minX||cell.x>maxX||cell.y<minY||cell.y>maxY)continue;
    const t=lengthSquared?Math.max(0,Math.min(1,((cell.x-start.x)*dx+(cell.y-start.y)*dy)/lengthSquared)):0;
    const x=cell.x-start.x-t*dx,y=cell.y-start.y-t*dy;
    if(x*x+y*y<=radius*radius)hits.add(cell.id);
  }
  return [...hits];
}

export function nearestCell(cells, point, tolerance) {
  let result=null,best=tolerance*tolerance;
  for(const cell of cells){
    const distance=(cell.x-point.x)**2+(cell.y-point.y)**2;
    if(distance<=best){result=cell.id;best=distance;}
  }
  return result;
}
