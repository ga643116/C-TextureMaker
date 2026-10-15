/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import {getPixelGrid} from './engine.mjs';
export function pixelExportSize(doc,layer,format,multiplier=1){
 const native=layer?.type==='pixel'&&layer.params.outputSize==='grid';
 const base=native?getPixelGrid(doc,layer):doc;
 const scale=format==='png'&&!native?multiplier:1;
 return {width:base.width*scale,height:base.height*scale};
}
export function resizeSVG(svg,width,height){
 return svg.replace(/<svg\b[^>]*>/,tag=>{
  const sized=tag.replace(/\bwidth="[^"]*"/,`width="${width}"`).replace(/\bheight="[^"]*"/,`height="${height}"`);
  // Grid dimensions round to whole pixels: fill them without SVG letterboxing.
  return /\bpreserveAspectRatio=/.test(sized)?sized.replace(/\bpreserveAspectRatio="[^"]*"/,'preserveAspectRatio="none"'):sized.replace(/>$/,' preserveAspectRatio="none">');
 });
}
