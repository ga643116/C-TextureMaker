/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';
import {PNG} from 'pngjs';
import {PATTERNS,createDocument,createLayer,createImageMaskLayer,renderSVG,normalizeDocument} from '../app/engine.mjs';

const mangaPixel=new PNG({width:1,height:1});mangaPixel.data.set([128,128,128,255]);
const mangaSource='data:image/png;base64,'+PNG.sync.write(mangaPixel).toString('base64');
const linePixel=new PNG({width:32,height:32});
for(let y=0;y<32;y++)for(let x=0;x<32;x++){const v=x>=14&&x<=17?20:255;linePixel.data.set([v,v,v,255],(y*32+x)*4);}
const lineSource='data:image/png;base64,'+PNG.sync.write(linePixel).toString('base64');
const setup=type=>{const d=createDocument();d.width=384;d.height=320;d.seamless=true;d.layers=[createLayer(type,'seamless-test')];d.layers[0].color='#111111';if(type==='redraw')d.layers[0].redrawData={version:1,width:128,height:128,detail:55,regions:[{id:'r0',color:'#111111',role:2,rings:[[16,16,112,16,112,112,16,112]]}],lines:[]};if(type==='manga')d.layers.push(createImageMaskLayer({id:'manga-source',name:'Manga source',image:mangaSource,imageWidth:1,imageHeight:1,mode:'color',colorMap:{width:1,height:1,rgba:Buffer.from([128,128,128,255]).toString('base64')}}));if(type==='lineart')d.layers.push(createImageMaskLayer({id:'line-source',name:'Line source',image:lineSource,imageWidth:32,imageHeight:32,mode:'color',colorMap:{width:32,height:32,rgba:linePixel.data.toString('base64')}}));return d;};
const raster=svg=>PNG.sync.read(new Resvg(svg).render().asPng());
const centers=svg=>[...svg.matchAll(/<g transform="rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)">/g)].map(m=>[Number(m[1]),Number(m[2])]);
const source=svg=>svg.slice(svg.indexOf('<g id="source-seamless-test"'),svg.indexOf('</defs>'));
function components(image){
  const {width:w,height:h,data}=image,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let count=0;
  for(let start=0;start<seen.length;start++){
    if(seen[start]||data[start*4+3]<16)continue;
    count++;let read=0,write=1;queue[0]=start;seen[start]=1;
    while(read<write){const at=queue[read++],x=at%w,y=Math.floor(at/w);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const next=((y+dy+h)%h)*w+(x+dx+w)%w;
        if(!seen[next]&&data[next*4+3]>=16){seen[next]=1;queue[write++]=next;}
      }
    }
  }
  return count;
}

test('symbol array fits a fractional number of rows and columns without doubled edge spacing',()=>{
  const d=setup('symbols');d.width=d.height=1024;
  const before=JSON.stringify(d),points=centers(source(renderSVG(d,{repeat:3})));
  assert.equal(points.length,196,'72px requested spacing fits fourteen rows and columns into 1024px');
  for(const axis of [0,1]){
    const coordinates=[...new Set(points.map(p=>p[axis]))].sort((a,b)=>a-b);
    assert.equal(coordinates.length,14);
    const gaps=coordinates.map((v,i)=>(coordinates[(i+1)%coordinates.length]-v+1024)%1024);
    assert.ok(Math.max(...gaps)-Math.min(...gaps)<.003,'edge gap must equal interior spacing');
  }
  assert.equal(JSON.stringify(d),before,'automatic fitting must not overwrite the saved parameter values');
  assert.deepEqual(normalizeDocument(d),d);
});

test('every dot, halftone and symbol shape stays separate on the torus with oversized dimensions',()=>{
  const cases=[
    ['dots',['circle','square','diamond'],['grid','staggered','diagonal']],
    ['halftone',['circle','square','diamond','triangle','star'],['grid','staggered','diagonal']],
    ['symbols',['arrow','slashes','chevron','bracket','cross','star'],['uniform','focus','radial','cycle']],
  ];
  const examples=[],columns=8;
  for(const [type,shapes,arrangements] of cases)for(const shape of shapes)for(const arrangement of arrangements){
    const d=setup(type),layer=d.layers[0];layer.rotation=23;layer.scale=.7;layer.offsetX=97;layer.offsetY=-79;
    Object.assign(layer.params,{shape,arrangement,spacing:92});
    if(type==='halftone')Object.assign(layer.params,{maxDot:512,minDot:512,angle:17});
    else layer.params.size=512;
    if(type==='symbols')Object.assign(layer.params,{strokeWidth:64,filled:true});
    const points=centers(source(renderSVG(d,{repeat:3})));
    assert.ok(points.length>1&&points.every(([x,y])=>x>=0&&x<d.width&&y>=0&&y<d.height),`${type}/${shape}/${arrangement}: one canonical center per cell`);
    assert.equal(new Set(points.map(p=>p.join(','))).size,points.length,'centers must be unique');
    examples.push({d,points,label:`${type}/${shape}/${arrangement}`});
  }
  const {width:w,height:h}=examples[0].d;
  const atlas=raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*w}" height="${Math.ceil(examples.length/columns)*h}">${examples.map(({d},i)=>`<g transform="translate(${i%columns*w} ${Math.floor(i/columns)*h})">${renderSVG(d)}</g>`).join('')}</svg>`);
  for(const [{points,label},i] of examples.map((entry,i)=>[entry,i])){
    const data=new Uint8Array(w*h*4),ox=i%columns*w,oy=Math.floor(i/columns)*h;
    for(let y=0;y<h;y++)data.set(atlas.data.subarray(((oy+y)*atlas.width+ox)*4,((oy+y)*atlas.width+ox+w)*4),y*w*4);
    assert.equal(components({width:w,height:h,data}),points.length,`${label}: adjacent glyphs must not touch, even across an offset tile boundary`);
  }
});

test('large rotated standalone motifs fit inside one tile without colliding with adjacent repeats',()=>{
  for(const type of ['concentric','hud','ticks','barcode','nested','globe','rays']){
    const d=setup(type),layer=d.layers[0];layer.rotation=37;layer.scale=2;
    if('radius' in layer.params)layer.params.radius=1600;
    if('maxRadius' in layer.params)layer.params.maxRadius=2048;
    if(type==='globe')Object.assign(layer.params,{radiusX:2048,radiusY:1600,tilt:23});
    if(type==='rays')Object.assign(layer.params,{innerRadius:1800,outerRadius:2048});
    const original=JSON.stringify(d),image=raster(renderSVG(d));let painted=0;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
      const value=image.data[(y*image.width+x)*4+3];painted+=value>0?1:0;
      if(x===0||y===0||x===image.width-1||y===image.height-1)assert.equal(value,0,`${type}: centered motif must leave room at the tile border`);
    }
    assert.ok(painted>30,`${type}: fitting must keep visible artwork`);
    assert.equal(JSON.stringify(d),original);
  }
});

test('seamless polygon outlines auto-fit oversized strokes without touching neighboring cells',()=>{
  for(const shape of ['triangle','hexagon']){
    const d=setup('polygons'),layer=d.layers[0];layer.rotation=23;layer.scale=.7;layer.offsetX=97;layer.offsetY=-79;
    Object.assign(layer.params,{shape,cellSize:84,shapeScale:1,strokeWidth:256,showGrid:false});
    const svg=renderSVG(d,{preview:true,repeat:3}),count=(source(svg).match(/<polygon /g)??[]).length;
    assert.ok(count>1);
    assert.equal(components(raster(renderSVG(d))),count,`${shape}: stroke extent must fit within the owning cell`);
  }
});

test('all generated patterns preserve single-layer opacity and export the same repeated tile',()=>{
  const width=192,height=224,parts=[],columns=5;
  for(const [i,pattern] of PATTERNS.entries()){
    const d=setup(pattern.id);d.width=width;d.height=height;d.layers[0].id=`opacity-${pattern.id}`;
    Object.assign(d.layers[0],{opacity:.5,rotation:23,scale:.7,offsetX:47,offsetY:-31});
    const x=i%columns*width*4,y=Math.floor(i/columns)*height*3;
    parts.push(`<g transform="translate(${x} ${y})">${renderSVG(d)}<g transform="translate(${width} 0)">${renderSVG(d,{repeat:3})}</g></g>`);
  }
  const image=raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*width*4}" height="${Math.ceil(PATTERNS.length/columns)*height*3}">${parts.join('')}</svg>`);
  const alpha=(x,y)=>image.data[(y*image.width+x)*4+3];
  for(const [i,pattern] of PATTERNS.entries()){
    const ox=i%columns*width*4,oy=Math.floor(i/columns)*height*3;let painted=0,difference=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const expected=alpha(ox+x,oy+y);if(expected>0)painted++;
      assert.ok(expected<=128,`${pattern.id}: wrapping must not apply layer opacity multiple times at a seam`);
      for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)difference+=Math.abs(expected-alpha(ox+width+tx*width+x,oy+ty*height+y));
    }
    assert.ok(painted>20,`${pattern.id}: seamless export must stay visible`);
    assert.ok(difference/(9*width*height)<.2,`${pattern.id}: every preview tile must match its export`);
  }
});
