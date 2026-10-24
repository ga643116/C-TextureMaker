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
    const pixels=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)pixels[i]=binary.charCodeAt(i);
    decoded.set(rgba,pixels);
  } else if(decoded.get(rgba).length!==width*height*4) throw new TypeError('Invalid image color map length');
  return {width,height,rgba};
}
export function encodeColorMap({width,height,data}) {
  if (!(data instanceof Uint8ClampedArray) || data.length!==width*height*4) throw new TypeError('Invalid image pixels');
  let binary='';
  for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
  const rgba=btoa(binary);
  if(Number.isInteger(width)&&Number.isInteger(height)&&width>=1&&height>=1&&width<=1024&&height<=1024&&!decoded.has(rgba)){
    if(decoded.size>=8)decoded.delete(decoded.keys().next().value);
    decoded.set(rgba,new Uint8Array(data));
  }
  return normalizeColorMap({width,height,rgba});
}
export function createImageColorSampler(layer,geometry,{nearest=false}={}) {
  const map=normalizeColorMap(layer.colorMap);
  if(!map)return null;
  const pixels=decoded.get(map.rgba),angle=-layer.rotation*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle);
  return (x,y)=>{
    const dx=x-geometry.cx,dy=y-geometry.cy;
    const u=((ca*dx-sa*dy)*(layer.flipX?-1:1))/geometry.width+.5;
    const v=((sa*dx+ca*dy)*(layer.flipY?-1:1))/geometry.height+.5;
    if(u<0||u>1||v<0||v>1)return [0,0,0,0];
    if(nearest){
      const px=Math.max(0,Math.min(map.width-1,Math.floor(u*map.width))),py=Math.max(0,Math.min(map.height-1,Math.floor(v*map.height))),i=(py*map.width+px)*4;
      return [pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]];
    }
    const px=Math.max(0,Math.min(map.width-1,u*map.width-.5)),py=Math.max(0,Math.min(map.height-1,v*map.height-.5));
    const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(map.width-1,x0+1),y1=Math.min(map.height-1,y0+1),fx=px-x0,fy=py-y0;
    // Four scalar taps avoid allocating nested arrays for every sampled pixel.
    const i00=(y0*map.width+x0)*4,i10=(y0*map.width+x1)*4,i01=(y1*map.width+x0)*4,i11=(y1*map.width+x1)*4;
    const a00=pixels[i00+3]*((1-fx)*(1-fy)),a10=pixels[i10+3]*(fx*(1-fy)),a01=pixels[i01+3]*((1-fx)*fy),a11=pixels[i11+3]*(fx*fy);
    const alpha=a00+a10+a01+a11;
    if(!alpha)return [0,0,0,0];
    return [Math.round((pixels[i00]*a00+pixels[i10]*a10+pixels[i01]*a01+pixels[i11]*a11)/alpha),
      Math.round((pixels[i00+1]*a00+pixels[i10+1]*a10+pixels[i01+1]*a01+pixels[i11+1]*a11)/alpha),
      Math.round((pixels[i00+2]*a00+pixels[i10+2]*a10+pixels[i01+2]*a01+pixels[i11+2]*a11)/alpha),Math.round(alpha)];
  };
}
