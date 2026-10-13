/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';
import {PNG} from 'pngjs';
import {createDocument,createLayer} from '../app/engine.mjs';
import {periodicCells} from '../app/periodic.mjs';
import {renderSeamlessField} from '../app/seamless-fields.mjs';

const raster=svg=>PNG.sync.read(new Resvg(svg).render().asPng());

function repeatedSvg(field,doc,repeat) {
  const {width,height}=doc,b=field.bounds;
  const x0=Math.ceil(-b.maxX/width-1e-10),x1=Math.floor((width-b.minX)/width+1e-10);
  const y0=Math.ceil(-b.maxY/height-1e-10),y1=Math.floor((height-b.minY)/height+1e-10);
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width*repeat}" height="${height*repeat}" viewBox="0 0 ${width*repeat} ${height*repeat}"><defs><clipPath id="tile"><rect width="${width}" height="${height}"/></clipPath></defs>`];
  for(let ty=0;ty<repeat;ty++)for(let tx=0;tx<repeat;tx++){
    parts.push(`<g clip-path="url(#tile)" transform="translate(${tx*width} ${ty*height})">`);
    for(let oy=y0;oy<=y1;oy++)for(let ox=x0;ox<=x1;ox++)parts.push(`<g transform="translate(${ox*width} ${oy*height})">${field.content}</g>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

function documentFor(type) {
  const doc=createDocument();doc.width=173;doc.height=229;doc.seamless=true;
  const layer=createLayer(type,`seamless-${type}`);layer.rotation=27;layer.scale=.73;
  doc.layers=[layer];
  return {doc,layer};
}

function compareRepeatedTiles(doc,field,label) {
  const tile=raster(repeatedSvg(field,doc,1)),sheet=raster(repeatedSvg(field,doc,3));
  let differences=0;
  for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++){
    const sheetOffset=((ty*doc.height+y)*sheet.width+tx*doc.width+x)*4,tileOffset=(y*doc.width+x)*4;
    for(let channel=0;channel<4;channel++)if(sheet.data[sheetOffset+channel]!==tile.data[tileOffset+channel])differences++;
  }
  assert.equal(differences,0,`${label} should repeat without changing any tile pixel`);
}

function segmentKey(segment,width,height) {
  const wrap=(value,extent)=>((value%extent)+extent)%extent;
  const points=[[wrap(segment[0],width),wrap(segment[1],height)],[wrap(segment[2],width),wrap(segment[3],height)]]
    .map(point=>point.map(value=>Math.round(value*100)/100));
  const [a,b]=points.map(point=>point.join(',')).sort();
  return `${a}|${b}`;
}

test('seamless waves and parallel lines have one source path per fitted periodic cell',()=>{
  for(const type of ['waves','lines']){
    const {doc,layer}=documentFor(type);
    if(type==='waves')Object.assign(layer.params,{frequency:5,spacing:28,amplitude:18,phase:37,style:'zigzag'});
    else Object.assign(layer.params,{direction:'diagonal',angle:11,spacing:21,dashLength:13,dashGap:7});
    const field=renderSeamlessField(layer,doc);
    const pathCount=(field.content.match(/<path\b/g)??[]).length;
    const p=layer.params,scale=layer.scale,rotation=layer.rotation*Math.PI/180;
    const frequency=Math.max(1,Math.round(p.frequency??1));
    const baseAngle=(type==='lines'?(p.direction==='vertical'?Math.PI/2:p.direction==='diagonal'?Math.PI/4:0)+(p.angle||0)*Math.PI/180:0)+rotation;
    const spacing=Math.max(p.spacing,Math.sqrt(doc.width*doc.height/(type==='waves'?240:180)));
    const period=type==='waves'?doc.width/frequency:(p.direction==='dotted'||p.dashGap>0?Math.max(1,p.dashLength+p.dashGap):Math.max(1,p.dashLength));
    const fitted=periodicCells({width:doc.width,height:doc.height,u:[period,0],v:[0,spacing],angle:baseAngle,scale,maxCells:600});
    assert.equal(pathCount,fitted.cells.length,`${type} should emit one path for each canonical periodic cell`);
    assert.ok(Object.values(field.bounds).every(Number.isFinite));
    compareRepeatedTiles(doc,field,type);
  }
});

test('dotted and solid seamless lines preserve round dots and full-period strokes',()=>{
  for(const direction of ['dotted','horizontal']){
    const {doc,layer}=documentFor('lines');
    Object.assign(layer.params,{direction,dashLength:17,dashGap:direction==='dotted'?9:0,strokeWidth:3,spacing:26});
    const field=renderSeamlessField(layer,doc);
    if(direction==='dotted')assert.match(field.content,/stroke-linecap="round"/);
    else {
      assert.doesNotMatch(field.content,/stroke-linecap="round"/);
      assert.doesNotMatch(field.content,/stroke-dasharray=/,'zero dash gap should connect each complete periodic segment');
    }
  }
});

test('seamless grid assigns each shared edge once and retains its decorations',()=>{
  const {doc,layer}=documentFor('grid');
  Object.assign(layer.params,{cellSize:43,strokeWidth:2,lineStyle:'dashed',dashLength:7,dashGap:5,cornerTrim:.04,centerTrim:.08,diagonals:2,diagonalWidth:3,junction:'cross',junctionSize:9,junctionWidth:1.5,cornerShape:'bracket',cornerSize:18,cornerInset:11,dots:true,dotSize:4,dotSpacing:23,hatch:true,hatchWidth:1,hatchSpacing:13});
  const field=renderSeamlessField(layer,doc);
  const basePath=field.content.match(/<path d="([^"]+)" fill="none" stroke="#e9e6df"/);
  assert.ok(basePath,'the primary grid path should be present');
  const segments=[...basePath[1].matchAll(/M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/g)].map(match=>match.slice(1).map(Number));
  assert.ok(segments.length>0);
  const canonical=segments.map(segment=>segmentKey(segment,doc.width,doc.height));
  assert.equal(new Set(canonical).size,canonical.length,'no shared cell edge is emitted twice in the canonical source');
  assert.match(field.content,/<circle\b/,'dots should remain available');
  assert.match(field.content,/stroke-dasharray=/,'dashed grid lines should remain available');
  assert.match(field.content,/stroke="#77736d"/,'secondary junction, corner, dot, and hatch styling should remain available');
  const diagonalPath=field.content.match(/<path d="[^"]+" fill="none" stroke="#77736d" stroke-width="([\d.]+)"/);
  assert.ok(diagonalPath,'diagonal lines should use the secondary color');
  assert.equal(Number(diagonalPath[1]),Number((layer.params.diagonalWidth*layer.scale).toFixed(3)),'diagonal width should remain unchanged when it is below the fitted lattice cap');
  assert.ok(Object.values(field.bounds).every(Number.isFinite));
  compareRepeatedTiles(doc,field,'grid decorations');
});

test('grid and hatch line widths respect their actual parallel lattice pitches',()=>{
  const {doc,layer}=documentFor('grid'),p=layer.params,scale=layer.scale,rotation=layer.rotation*Math.PI/180;
  Object.assign(p,{cellSize:47,strokeWidth:80,diagonals:2,diagonalWidth:80,junction:'none',dots:false,hatch:true,hatchSpacing:11,hatchWidth:80,cornerShape:'none'});
  const size=Math.max(p.cellSize,Math.sqrt(doc.width*doc.height/900)),segmentsPerCell=6,extraReserve=900;
  const maxGridCells=Math.max(1,Math.min(600,Math.floor((6500-extraReserve)/segmentsPerCell)));
  const grid=periodicCells({width:doc.width,height:doc.height,u:[size,0],v:[0,size],angle:rotation,scale,maxCells:maxGridCells});
  const gridPitch=Math.min(Math.abs(grid.u[0]*grid.v[1]-grid.u[1]*grid.v[0])/Math.hypot(...grid.u),Math.abs(grid.u[0]*grid.v[1]-grid.u[1]*grid.v[0])/Math.hypot(...grid.v));
  const fieldLimit=Math.floor((6500-grid.cells.length*segmentsPerCell)/1),hatchSpacing=Math.max(p.hatchSpacing,Math.sqrt(doc.width*doc.height/1200));
  const hatch=periodicCells({width:doc.width,height:doc.height,u:[hatchSpacing,0],v:[0,hatchSpacing],angle:rotation,scale,maxCells:fieldLimit});
  const hatchDirection=[hatch.u[0]-hatch.v[0],hatch.u[1]-hatch.v[1]],hatchPitch=Math.abs(hatch.u[0]*hatch.v[1]-hatch.u[1]*hatch.v[0])/Math.hypot(...hatchDirection);
  const field=renderSeamlessField(layer,doc),paths=[...field.content.matchAll(/<path d="[^"]+" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)"/g)];
  assert.equal(paths.length,3,'the base grid, diagonals, and hatch should each have one path');
  assert.equal(paths[0][1],'#e9e6df');
  assert.equal(paths[1][1],'#77736d','diagonals should retain secondary color');
  assert.equal(paths[2][1],'#77736d');
  assert.ok(Number(paths[0][2])<=gridPitch*.8+0.001,'base line width should fit the closest parallel grid spacing');
  assert.ok(Number(paths[1][2])<=gridPitch*.8+0.001,'diagonal width should fit the closest parallel grid spacing');
  assert.ok(Number(paths[2][2])<=hatchPitch*.8+0.001,'hatch width should fit the hatch lines\' perpendicular spacing');
});

test('non-seamless documents and unrelated pattern types are not handled by this field renderer',()=>{
  const {doc,layer}=documentFor('waves');
  doc.seamless=false;
  assert.equal(renderSeamlessField(layer,doc),null);
  doc.seamless=true;
  assert.equal(renderSeamlessField(createLayer('symbols','symbols'),doc),null);
});

test('grid corner marks that map to the same torus point are emitted once',()=>{
  const {doc,layer}=documentFor('grid');
  layer.rotation=0;layer.scale=1;
  Object.assign(layer.params,{cornerShape:'circle',cornerInset:0,cornerSize:24,dots:false,hatch:false});
  const field=renderSeamlessField(layer,doc);
  assert.equal((field.content.match(/<circle\b/g)??[]).length,1,'four identical tile corners should share one canonical mark');
  assert.ok(Object.values(field.bounds).every(Number.isFinite));
});

test('square and triangle corner marks fit within the nearest wrapped mark clearance',()=>{
  for(const shape of ['square','triangle']){
    const {doc,layer}=documentFor('grid');
    Object.assign(layer.params,{cellSize:43,cornerShape:shape,cornerSize:500,cornerInset:11,strokeWidth:500,junction:'none',dots:false,hatch:false});
    const field=renderSeamlessField(layer,doc),polygons=[...field.content.matchAll(/<polygon points="([^"]+)" fill="[^"]+" stroke="[^"]+" stroke-width="([\d.]+)"/g)];
    assert.equal(polygons.length,4,`${shape} should emit one mark at each distinct torus corner`);
    const vertices=polygons.map(match=>match[1].split(' ').map(point=>point.split(',').map(Number)));
    const origins=vertices.map(points=>points[0]),wrapDistance=(a,b)=>{
      const dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
      return Math.hypot(Math.min(dx,doc.width-dx),Math.min(dy,doc.height-dy));
    };
    for(let i=0;i<polygons.length;i++){
      const nearest=Math.min(...origins.filter((_,j)=>j!==i).map(origin=>wrapDistance(origins[i],origin)));
      const points=vertices[i],edgeLengths=points.map((point,j)=>Math.hypot(point[0]-points[(j+1)%points.length][0],point[1]-points[(j+1)%points.length][1]));
      const worldSize=Math.min(...edgeLengths),strokeWidth=Number(polygons[i][2]),miterFactor=shape==='triangle'?1.4:.75;
      assert.ok(worldSize<=nearest*.30+.001,`${shape} mark size should stay within 30% of nearest corner spacing`);
      assert.ok(Math.SQRT2*worldSize+miterFactor*strokeWidth<=nearest*.49+.002,`${shape} miter and stroke extent should stay within nearest-corner clearance`);
    }
    assert.ok(Object.values(field.bounds).every(Number.isFinite));
  }
});
