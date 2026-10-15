/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// A small embedded raster makes facet colors reproducible in synchronous SVG
// exports, including after reopening a project without decoding its source.
const decoded = new Map();
export function normalizeColorMap(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'height,rgba,width') throw new TypeError('Invalid image color map');
  const {width,height,rgba}=value;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>1024 || height>1024 || typeof rgba!=='string' || rgba.length!==Math.ceil(width*height*4/3)*4) throw new TypeError('Invalid image color map size');
  if (!decoded.has(rgba)) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(rgba)) throw new TypeError('Invalid image color map data');
    let binary;
    try { binary=atob(rgba); } catch { throw new TypeError('Invalid image color map data'); }
    if (binary.length!==width*height*4) throw new TypeError('Invalid image color map length');
    if (decoded.size>=8) decoded.delete(decoded.keys().next().value);
    decoded.set(rgba,Uint8Array.from(binary,c=>c.charCodeAt(0)));
  } else if(decoded.get(rgba).length!==width*height*4) throw new TypeError('Invalid image color map length');
  return {width,height,rgba};
}
export function encodeColorMap({width,height,data}) {
  if (!(data instanceof Uint8ClampedArray) || data.length!==width*height*4) throw new TypeError('Invalid image pixels');
  let binary='';
  for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
  return normalizeColorMap({width,height,rgba:btoa(binary)});
}
export function createImageColorSampler(layer,geometry) {
  const map=normalizeColorMap(layer.colorMap);
  if(!map)return null;
  const pixels=decoded.get(map.rgba),angle=-layer.rotation*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle);
  return (x,y)=>{
    const dx=x-geometry.cx,dy=y-geometry.cy;
    const u=((ca*dx-sa*dy)*(layer.flipX?-1:1))/geometry.width+.5;
    const v=((sa*dx+ca*dy)*(layer.flipY?-1:1))/geometry.height+.5;
    if(u<0||u>1||v<0||v>1)return [0,0,0,0];
    const px=Math.max(0,Math.min(map.width-1,u*map.width-.5)),py=Math.max(0,Math.min(map.height-1,v*map.height-.5));
    const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(map.width-1,x0+1),y1=Math.min(map.height-1,y0+1),fx=px-x0,fy=py-y0;
    let alpha=0,r=0,g=0,b=0;
    for(const [sx,sy,weight] of [[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]]){
      const i=(sy*map.width+sx)*4,a=pixels[i+3]*weight;
      alpha+=a;r+=pixels[i]*a;g+=pixels[i+1]*a;b+=pixels[i+2]*a;
    }
    return alpha>0?[Math.round(r/alpha),Math.round(g/alpha),Math.round(b/alpha),Math.round(alpha)]:[0,0,0,0];
  };
}
