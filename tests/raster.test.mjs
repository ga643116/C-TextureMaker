/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';
import {PNG} from 'pngjs';
import {PATTERNS,createDocument,createLayer,renderSVG} from '../app/engine.mjs';

const raster=svg=>PNG.sync.read(new Resvg(svg).render().asPng());
const alpha=(png,x,y)=>png.data[(y*png.width+x)*4+3];
const setup=type=>{const d=createDocument();d.layers=[createLayer(type,'raster-layer')];d.layers[0].color='#253020';return d;};

test('patterns preserve transparency and image-dependent redraw waits for generated regions',()=>{
  for(const p of PATTERNS){
    const image=raster(renderSVG(setup(p.id)));
    let painted=0,empty=0;
    for(let i=3;i<image.data.length;i+=4){if(image.data[i]>0)painted++;else empty++;}
    if(p.id==='redraw'){assert.equal(painted,0,'redraw without generated image regions stays empty');continue;}
    assert.ok(painted>500,`${p.id}: artwork must not be blank`);
    if(['lowpoly','pixel'].includes(p.id)){
      assert.equal(empty,0,'default filled patterns intentionally cover the entire tile');
      const inset=setup(p.id);inset.layers[0].scale=.5;
      const scaled=raster(renderSVG(inset));
      assert.equal(alpha(scaled,0,0),0,'scaling a filled mesh leaves a transparent exterior');
      assert.equal(alpha(scaled,512,512),255,'the scaled mesh remains filled');
    }else assert.ok(empty>500,`${p.id}: transparent export must retain alpha`);
  }
});

test('opaque background fills the full PNG while transparent export retains unpainted areas',()=>{
  const d=setup('contour');d.width=d.height=256;
  const transparent=raster(renderSVG(d));
  d.transparent=false;
  const opaque=raster(renderSVG(d));
  let empty=0;
  for(let i=3;i<opaque.data.length;i+=4){assert.equal(opaque.data[i],255);if(transparent.data[i]===0)empty++;}
  assert.ok(empty>1024);
});

test('3 by 3 preview contains the exact exported tile in all nine positions',()=>{
  const d=setup('contour');d.width=d.height=256;d.seamless=true;
  const tile=raster(renderSVG(d)),sheet=raster(renderSVG(d,{repeat:3}));
  let delta=0,large=0;
  for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)for(let y=0;y<256;y++)for(let x=0;x<256;x++){const diff=Math.abs(alpha(tile,x,y)-alpha(sheet,tx*256+x,ty*256+y));delta+=diff;if(diff>8)large++;}
  // SVG use instances can differ by a few antialiased edge pixels.
  assert.ok(delta/(9*256*256)<.1&&large/(9*256*256)<.001,'preview and export must match apart from isolated antialiasing pixels');
});

test('seamless polygon strokes preserve transparent edges and repeat cleanly with layer transforms',()=>{
  for(const shape of ['triangle','hexagon'])for(const scale of [.1,.7]){
    const d=setup('polygons');d.width=251;d.height=333;d.seamless=true;
    const layer=d.layers[0];layer.rotation=23;layer.scale=scale;layer.offsetX=17;layer.offsetY=-21;
    Object.assign(layer.params,{shape,cellSize:59,shapeScale:.85,filled:false,strokeWidth:2,showGrid:false});
    const tile=raster(renderSVG(d)),sheet=raster(renderSVG(d,{repeat:3}));
    assert.equal(tile.width,251);assert.equal(tile.height,333);
    assert.equal(sheet.width,753);assert.equal(sheet.height,999);
    let painted=0,empty=0,delta=0;
    for(let y=0;y<333;y++)for(let x=0;x<251;x++){
      const value=alpha(tile,x,y);if(value>0)painted++;else empty++;
      for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)delta+=Math.abs(value-alpha(sheet,tx*251+x,ty*333+y));
    }
    assert.ok(painted>1000&&empty>1000,`${shape} should render stroked cells on a transparent background`);
    assert.equal(delta,0,`${shape} repeat3 tiles should exactly match the transformed single-tile export`);

    const sample=image=>image.data[(0*image.width+0)*4+3];
    assert.ok(sample(tile)<255,'the polygon export should retain transparent pixels');
    let seam=0,inside=0,seamCount=0,insideCount=0;
    for(let y=0;y<333;y++){
      seam+=Math.abs(alpha(sheet,250,y)-alpha(sheet,251,y));seamCount++;
      for(let x=24;x<227;x++){inside+=Math.abs(alpha(sheet,x,y)-alpha(sheet,x+1,y));insideCount++;}
    }
    assert.ok(seam/seamCount<=inside/insideCount*1.5+2,`${shape} should not form an unusually dense vertical seam`);
  }
});
