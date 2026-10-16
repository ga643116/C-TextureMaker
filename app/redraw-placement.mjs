/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const ID=/^[A-Za-z0-9_-]{1,48}$/;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
export function multiplyMatrix(a,b){
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
function inverse(m){const d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
function sourceMatrix(source,geometry){
 const angle=source.rotation*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle),sx=source.flipX?-1:1,sy=source.flipY?-1:1;
 return [ca*geometry.width*sx,sa*geometry.width*sx,-sa*geometry.height*sy,ca*geometry.height*sy,geometry.cx,geometry.cy];
}
function normalized(m,width,height){return [m[0]/width,m[1]/height,m[2]/width,m[3]/height,m[4]/width,m[5]/height];}
export function normalizeRedrawPlacement(value){
 if(value===null||value===undefined)return null;
 if(!keys(value,['version','width','height','sources'])||value.version!==1||![value.width,value.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=8192)||!Array.isArray(value.sources)||!value.sources.length||value.sources.length>16)throw new TypeError('Invalid redraw placement');
 const seen=new Set();
 const sources=value.sources.map(item=>{
  if(!keys(item,['id','matrix'])||!ID.test(item.id)||seen.has(item.id)||!Array.isArray(item.matrix)||item.matrix.length!==6||!item.matrix.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7)||Math.abs(item.matrix[0]*item.matrix[3]-item.matrix[1]*item.matrix[2])<1e-10)throw new TypeError('Invalid redraw source transform');
  seen.add(item.id);return {id:item.id,matrix:item.matrix.map(n=>n===0?0:n)};
 });
 return {version:1,width:value.width,height:value.height,sources};
}
export function capturePlacement(doc,sources,geometryFor){
 if(!sources.length)return null;
 return normalizeRedrawPlacement({version:1,width:doc.width,height:doc.height,sources:sources.map(source=>({id:source.id,matrix:sourceMatrix(source,geometryFor(source,doc))}))});
}
function sourceDelta(value,doc,sources,geometryFor){
 const saved=normalizeRedrawPlacement(value);if(!saved||sources.length!==saved.sources.length)return null;
 let delta=null;
 for(const old of saved.sources){
  const current=sources.find(source=>source.id===old.id);if(!current)return null;
  const next=multiplyMatrix(normalized(sourceMatrix(current,geometryFor(current,doc)),doc.width,doc.height),inverse(normalized(old.matrix,saved.width,saved.height)));
  if(delta&&next.some((n,index)=>Math.abs(n-delta[index])>1e-7))return null;
  delta=next;
 }
 return delta;
}
export const canFollowPlacement=(value,doc,sources,geometryFor)=>Boolean(sourceDelta(value,doc,sources,geometryFor));
export function placementMatrix(value,doc,sources,geometryFor){
 const delta=sourceDelta(value,doc,sources,geometryFor);if(!delta)return null;
 const actual=multiplyMatrix([doc.width,0,0,doc.height,0,0],multiplyMatrix(delta,[1/doc.width,0,0,1/doc.height,0,0]));
 return actual.every((n,index)=>Math.abs(n-[1,0,0,1,0,0][index])<1e-8)?null:actual;
}
export function layerMatrix(layer,doc){
 const angle=layer.rotation*Math.PI/180,a=Math.cos(angle)*layer.scale,b=Math.sin(angle)*layer.scale,c=-b,d=a,cx=doc.width/2,cy=doc.height/2;
 return [a,b,c,d,cx+layer.offsetX-a*cx-c*cy,cy+layer.offsetY-b*cx-d*cy];
}
export function matrixBounds(m,width,height){
 const points=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
 return {minX:Math.min(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxX:Math.max(...points.map(p=>p[0])),maxY:Math.max(...points.map(p=>p[1]))};
}
export const matrixAttribute=m=>'matrix('+m.map(n=>Math.round(n*1e6)/1e6).join(' ')+')';
