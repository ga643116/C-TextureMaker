/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, createDocument, createLayer, normalizeDocument, renderSVG } from '../app/engine.mjs';

const ids = ['concentric','halftone','hud','ticks','barcode','waves','lines','dots','polygons','contour','lowpoly','pixel','symbols','nested','globe','grid','rays'];

test('exposes the seventeen localized pattern schemas and renders each default layer', () => {
  assert.deepEqual(PATTERNS.map(p => p.id), ids);
  for (const pattern of PATTERNS) {
    for (const locale of ['zh','en','ja']) {
      assert.equal(typeof pattern.name[locale], 'string');
      assert.equal(typeof pattern.description[locale], 'string');
    }
    for (const control of pattern.controls) {
      for (const locale of ['zh','en','ja']) assert.equal(typeof control.label[locale], 'string');
      if (control.options) for (const option of control.options) for (const locale of ['zh','en','ja']) assert.equal(typeof option.label[locale], 'string');
    }
    const doc = createDocument();
    doc.width = 256; doc.height = 256; doc.layers = [createLayer(pattern.id, `test-${pattern.id}`)];
    const svg = renderSVG(doc);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.endsWith('</svg>'));
    assert.doesNotMatch(svg, /NaN|Infinity|<script|(?:href|src)=["'](?:https?:|\/\/)/i);
  }
});

test('creates a fresh contract-shaped document and applies layer transforms and transparency', () => {
  const doc = createDocument();
  assert.deepEqual(Object.keys(doc), ['version','name','width','height','transparent','background','seamless','seed','layers']);
  assert.deepEqual(Object.keys(doc.layers[0]), ['id','type','visible','opacity','color','secondary','rotation','scale','offsetX','offsetY','params','pixelPalette','hiddenCells','customMotif','motifTint','cellLinks','linkWidth','mask','imageSource','patternSettings']);
  assert.equal(doc.layers[0].type, 'contour');
  const transparent = renderSVG(doc);
  assert.doesNotMatch(transparent, /<rect width="1024" height="1024" fill="#eeeae2"/);
  doc.transparent = false;
  assert.match(renderSVG(doc), /<rect width="1024" height="1024" fill="#eeeae2"\/>/);
  doc.layers[0].opacity = 0.4; doc.layers[0].scale = 1.2; doc.layers[0].rotation = 18; doc.layers[0].offsetX = 12;
  assert.match(renderSVG(doc), /opacity="0\.4"/);
  assert.match(renderSVG(doc), /scale\(1\.2\)/);
});

test('normalizes bounded dimensions and parameters while preserving all defaults', () => {
  const doc = createDocument();
  doc.width = 9000; doc.layers[0].params.sampling = 400;
  const normalized = normalizeDocument(doc);
  assert.equal(normalized.width, 4096);
  assert.equal(normalized.layers[0].params.sampling, 256);
  assert.deepEqual(Object.keys(normalized.layers[0].params), Object.keys(PATTERNS.find(p => p.id === 'contour').defaults));
});

test('rejects unknown versions, malformed layers, unknown parameters and unsafe data URLs', () => {
  const base = createDocument();
  assert.throws(() => normalizeDocument({ ...base, version: 2 }), /Unsupported/);
  assert.throws(() => normalizeDocument({ ...base, layers: {} }), /layers/);
  assert.throws(() => normalizeDocument({ ...base, layers: [createLayer('dots','bad.id')] }), /id/);
  const unknown = createDocument(); unknown.layers[0].params.injected = 1;
  assert.throws(() => normalizeDocument(unknown), /Unknown contour parameter/);
  const badColor = createDocument(); badColor.layers[0].color = 'red';
  assert.throws(() => normalizeDocument(badColor), /color/);
  const badSvg = createDocument(); badSvg.layers[0].customMotif = 'data:image/svg+xml;base64,' + Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64');
  assert.throws(() => normalizeDocument(badSvg), /Unsafe SVG/);
  const localUse = createDocument();
  localUse.layers[0].customMotif = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="motif" d="M0 0L1 1"/></defs><use href="#motif"/></svg>').toString('base64');
  assert.doesNotThrow(() => normalizeDocument(localUse), 'safe internal SVG references should be accepted');
  const externalUse = createDocument();
  externalUse.layers[0].customMotif = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/motif.svg#motif"/></svg>').toString('base64');
  assert.throws(() => normalizeDocument(externalUse), /Unsafe SVG/);
});

test('hidden cells stay visible and clickable as faint preview ghosts but disappear from exports', () => {
  const doc = createDocument(); doc.width = 256; doc.height = 256; doc.layers = [createLayer('dots','dots-1')];
  let svg = renderSVG(doc, { preview: true });
  assert.match(svg, /data-cell="0:0" data-layer="dots-1"/);
  doc.layers[0].hiddenCells = ['0:0'];
  svg = renderSVG(doc, { preview: true });
  assert.match(svg, /data-cell="0:0" data-layer="dots-1" data-hidden="true" opacity="0\.18" pointer-events="all"/);
  assert.match(svg, /data-cell="0:1"/);
  assert.doesNotMatch(renderSVG(doc), /data-cell="0:0"|data-hidden="true"/);

  doc.layers = [createLayer('polygons','poly-1')]; doc.layers[0].hiddenCells = ['0:0'];
  svg = renderSVG(doc, { preview: true });
  assert.match(svg, /data-cell="0:0" data-layer="poly-1" data-hidden="true" opacity="0\.18" pointer-events="all"/);
  assert.doesNotMatch(renderSVG(doc), /data-cell="0:0"|data-hidden="true"/);

  doc.layers = [createLayer('halftone','motif-1')];
  doc.layers[0].customMotif = 'data:image/png;base64,iVBORw0KGgo=';
  doc.layers[0].hiddenCells = ['0:0'];
  assert.match(renderSVG(doc, { preview: true }), /data-cell="0:0" data-layer="motif-1" data-hidden="true" opacity="0\.18" pointer-events="all"/);
});

test('seeded generators are deterministic and respond to seed changes', () => {
  const doc = createDocument(); doc.width = 256; doc.height = 256; doc.layers = [createLayer('barcode','bars')];
  const first = renderSVG(doc), again = renderSVG(doc);
  assert.equal(first, again);
  doc.seed++;
  assert.notEqual(renderSVG(doc), first);
  doc.layers = [createLayer('contour','terrain')]; doc.seed = 41;
  const terrain = renderSVG(doc); doc.seed = 42;
  assert.notEqual(renderSVG(doc), terrain);
});

test('repeat mode creates a 3 by 3 sheet and seamless geometry is represented by periodic translated instances', () => {
  const doc = createDocument(); doc.width = 256; doc.height = 256; doc.seamless = true; doc.layers = [createLayer('dots','periodic')];
  const one = renderSVG(doc), three = renderSVG(doc, { repeat: 3 });
  assert.match(three, /width="768" height="768" viewBox="0 0 768 768"/);
  const instances=(one.match(/opacity="1" transform="translate/g) ?? []).length;
  assert.ok(instances>=1&&instances<=9);
  assert.equal((three.match(/href="#source-periodic"/g) ?? []).length, 9*instances);
  assert.throws(() => renderSVG(doc, { repeat: 2 }), /repeat/);
});

test('seamless fields fit extreme aspect ratios without copying an oversized rotated field', () => {
  const doc = createDocument(); doc.width = 128; doc.height = 4096; doc.seamless = true;
  const layer = createLayer('grid','wide-grid'); layer.params.hatch = true; layer.params.hatchSpacing = 6;
  layer.offsetX = 128; layer.offsetY = 4096; layer.rotation = 45; layer.scale = 1.5; doc.layers = [layer];
  const svg = renderSVG(doc, { repeat: 3 });
  assert.match(svg, /width="384" height="12288"/);
  const instances=(svg.match(/href="#source-wide-grid"/g) ?? []).length;
  assert.ok(instances>=9&&instances<=81,'canonical cells should not require an oversized field of overlapping copies');
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('embedded motif and alpha mask stay data-only and mask is applied', () => {
  const doc = createDocument(); doc.width = 128; doc.height = 128; doc.layers = [createLayer('halftone','asset')];
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  doc.layers[0].customMotif = png; doc.layers[0].mask = png;
  const svg = renderSVG(doc);
  assert.match(svg, /mask-type="alpha"/);
  assert.match(svg, /mask="url\(#mask-asset\)"/);
  assert.match(svg, /href="data:image\/png;base64,/);
});

test('conditional controls change their generated geometry when enabled', () => {
  const rendered = (type, setup, key, value) => {
    const doc = createDocument(); doc.width = 256; doc.height = 256; doc.layers = [createLayer(type, `control-${type}`)];
    Object.assign(doc.layers[0].params, setup);
    const before = renderSVG(doc); doc.layers[0].params[key] = value;
    assert.notEqual(renderSVG(doc), before, `${type}.${key} should affect its output`);
  };
  rendered('concentric', { sweep: 120, lineStyle: 'dashed' }, 'startAngle', 40);
  rendered('concentric', { lineStyle: 'dashed' }, 'dashLength', 32);
  rendered('ticks', { waveAmplitude: 24 }, 'waveFrequency', 3);
  rendered('dots', { finite: true }, 'columns', 8);
  rendered('grid', { diagonals: 1 }, 'diagonalWidth', 4);
  rendered('grid', { junction: 'cross' }, 'junctionSize', 24);
  rendered('symbols', {}, 'roundness', 0.8);
  rendered('rays', {}, 'mode', 'fixedWidth');
});

test('polygon lattices use equilateral tessellations, centered scale and per-cell secondary grids', () => {
  const polygonCells = svg => [...svg.matchAll(/<polygon points="([^"]+)"[^>]*data-cell="([^"]+)"/g)].map(match => ({
    id: match[2], points: match[1].split(' ').map(pair => pair.split(',').map(Number)),
  }));
  const center = points => points.reduce((sum, point) => [sum[0]+point[0]/points.length,sum[1]+point[1]/points.length],[0,0]);
  const areaSign = points => Math.sign(points.reduce((area,[x,y],i)=>{const [nx,ny]=points[(i+1)%points.length];return area+x*ny-nx*y;},0));

  const doc=createDocument(); doc.width=doc.height=256; doc.layers=[createLayer('polygons','mesh')];
  const layer=doc.layers[0]; layer.params.cellSize=60; layer.params.showGrid=false;
  for(const shape of ['triangle','hexagon']) {
    layer.params.shape=shape; layer.params.shapeScale=1;
    const whole=polygonCells(renderSVG(doc,{preview:true})).find(cell=>cell.id==='1:1');
    assert.ok(whole,`${shape} should render the first in-canvas editable cell`);
    assert.equal(whole.points.length,shape==='triangle'?3:6);
    const sideLengths=whole.points.map((point,i)=>{const next=whole.points[(i+1)%whole.points.length];return Math.hypot(next[0]-point[0],next[1]-point[1]);});
    const expectedSide=shape==='triangle'?60:30;
    assert.ok(sideLengths.every(length=>Math.abs(length-expectedSide)<.01),`${shape} cells should be regular`);
    const wholeCenter=center(whole.points);
    layer.params.shapeScale=.5;
    const half=polygonCells(renderSVG(doc,{preview:true})).find(cell=>cell.id==='1:1');
    const halfCenter=center(half.points);
    assert.ok(Math.hypot(wholeCenter[0]-halfCenter[0],wholeCenter[1]-halfCenter[1])<.01,`${shape} scale should preserve each cell center`);
    const halfSides=half.points.map((point,i)=>{const next=half.points[(i+1)%half.points.length];return Math.hypot(next[0]-point[0],next[1]-point[1]);});
    assert.ok(halfSides.every(length=>Math.abs(length-expectedSide*.5)<.01),`${shape} shapeScale should scale its sides evenly`);
  }

  layer.params.shape='triangle'; layer.params.shapeScale=1; layer.params.showGrid=false;
  const triangleBand=polygonCells(renderSVG(doc,{preview:true})).filter(cell=>cell.id.startsWith('1:'));
  assert.equal(new Set(triangleBand.map(cell=>areaSign(cell.points))).size,2,'triangular cells should alternate up and down');

  layer.params.shape='hexagon'; layer.params.shapeScale=1;
  const hexCells=polygonCells(renderSVG(doc,{preview:true}));
  const byId=new Map(hexCells.map(cell=>[cell.id,cell]));
  const first=center(byId.get('1:1').points),sameRow=center(byId.get('1:2').points),nextRow=center(byId.get('2:1').points);
  assert.ok(Math.abs(sameRow[0]-first[0]-60*Math.sqrt(3)/2)<.01&&Math.abs(sameRow[1]-first[1])<.01,'hex centers should use the regular horizontal pitch');
  assert.ok(Math.abs(nextRow[0]-first[0]-60*Math.sqrt(3)/4)<.01&&Math.abs(nextRow[1]-first[1]-45)<.01,'staggered hex rows should use the regular neighbor pitch');

  layer.secondary='#a0b0c0'; layer.params.showGrid=true;
  const withGrid=renderSVG(doc);
  assert.match(withGrid,/fill="none" stroke="#a0b0c0" stroke-width="1" opacity="\.42"/);
  const gridD=withGrid.match(/<path d="([^"]+)" fill="none" stroke="#a0b0c0"/)[1];
  assert.ok((gridD.match(/M/g)??[]).length>20,'showGrid should draw the complete faint cell lattice');
  layer.params.showGrid=false;
  assert.doesNotMatch(renderSVG(doc),/stroke="#a0b0c0"/);
});

test('seamless polygons keep only canonical transformed cells within each tile', () => {
  const cases=[
    {width:256,height:256,size:24,rotation:0,scale:1},
    {width:1024,height:1024,size:56,rotation:23,scale:.1},
    {width:251,height:333,size:59,rotation:0,scale:1},
    {width:400,height:257,size:101,rotation:0,scale:1},
    {width:251,height:333,size:59,rotation:23,scale:.1},
    {width:251,height:333,size:59,rotation:23,scale:.7},
    {width:251,height:333,size:59,rotation:23,scale:1.35},
    {width:251,height:333,size:59,rotation:90,scale:.7},
    {width:251,height:333,size:59,rotation:90,scale:1.35},
  ];
  const center=points=>points.reduce((sum,point)=>[sum[0]+point[0]/points.length,sum[1]+point[1]/points.length],[0,0]);
  const wrapped=(value,extent)=>((value+extent/2)%extent+extent)%extent-extent/2;
  const doc=createDocument();doc.seamless=true;const layer=createLayer('polygons','periodic-mesh');doc.layers=[layer];
  for(const {width,height,size,rotation,scale} of cases){
    doc.width=width;doc.height=height;layer.rotation=rotation;layer.scale=scale;layer.params.cellSize=size;layer.params.shapeScale=1;layer.params.filled=false;layer.params.showGrid=true;layer.params.strokeWidth=3;layer.offsetX=0;layer.offsetY=0;
    for(const shape of ['triangle','hexagon']){
      layer.params.shape=shape;
      const svg=renderSVG(doc,{preview:true,repeat:3}),source=svg.match(/<g id="source-periodic-mesh" opacity="[^"]+" transform="([^"]+)">([\s\S]*?)<\/g>/);
      assert.ok(source,`${shape} ${width}x${height} should retain one reusable vector source`);
      const cells=[...source[2].matchAll(/<polygon points="([^"]+)"[^>]* data-cell="([^"]+)"[^>]*\/>/g)].map(match=>({id:match[2],points:match[1].split(' ').map(pair=>pair.split(',').map(Number))}));
      const ids=cells.map(cell=>cell.id);
      assert.equal(new Set(ids).size,ids.length,`${shape} should contain no duplicate cells in its canonical source`);
      assert.ok(ids.length>0&&ids.every(id=>/^\d+:\d+$/.test(id)),`${shape} preview click IDs should remain row:column values`);
      const unitCellArea=shape==='triangle'?Math.sqrt(3)/4:3*Math.sqrt(3)/8,effectiveSize=Math.max(size*scale,Math.sqrt(width*height/350)),expected=width*height/(unitCellArea*effectiveSize*effectiveSize),density=ids.length/expected;
      assert.ok(density>.6&&density<1.6,`${shape} ${rotation}deg scale ${scale} should keep cell density near one tile (ratio ${density.toFixed(2)})`);
      assert.match(source[2],/stroke="#77736d" stroke-width="1\.5" opacity="\.42"/,'showGrid should retain its secondary vector stroke');
      assert.match(source[2],/stroke="#e9e6df" stroke-width="3"/,'cell outlines should retain their requested stroke width');

      const angle=rotation*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle),ox=wrapped(layer.offsetX,width),oy=wrapped(layer.offsetY,height);
      for(const cell of cells){
        const [x,y]=center(cell.points),worldX=width/2+scale*(ca*(x-width/2)-sa*(y-height/2)),worldY=height/2+scale*(sa*(x-width/2)+ca*(y-height/2));
        assert.ok(worldX>=-.002&&worldX<width+.002&&worldY>=-.002&&worldY<height+.002,`${shape} cell ${cell.id} should have one transformed center inside the canonical tile`);
        assert.ok(Number.isFinite(worldX+ox)&&Number.isFinite(worldY+oy),'offset and repeat3 transforms should remain finite');
      }
      assert.equal((svg.match(/href="#source-periodic-mesh"/g)??[]).length,81,'repeat3 should wrap the source through all nine preview tiles');
      assert.match(source[1],/translate\(0 0\) translate\(/,'the reusable source should retain the existing layer transform contract');

      layer.hiddenCells=[ids[0]];
      const ghost=renderSVG(doc,{preview:true,repeat:3});
      assert.match(ghost,new RegExp(`data-cell="${ids[0]}" data-layer="periodic-mesh" data-hidden="true" opacity="0\\.18" pointer-events="all"`),'hidden cells should remain clickable preview ghosts');
      layer.hiddenCells=[];
    }
  }
  doc.width=251;doc.height=333;layer.params.shape='triangle';layer.params.cellSize=59;layer.offsetX=17;layer.offsetY=-21;
  const offsetSvg=renderSVG(doc,{repeat:3});
  assert.match(offsetSvg,/translate\(17 -21\)/,'offsets should remain applied to seamless polygon sources');
});

test('radial and contour parameters produce their intended geometry', () => {
  const rings = createDocument(); rings.width = rings.height = 256; rings.layers = [createLayer('concentric','rings')];
  Object.assign(rings.layers[0].params,{count:3,minRadius:20,maxRadius:80,innerWidth:3,outerWidth:9});
  const widths = [...renderSVG(rings).matchAll(/stroke-width="([\d.]+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(widths.slice(0,3),[3,6,9]);

  const globe = createDocument(); globe.width = globe.height = 256; globe.layers = [createLayer('globe','globe-1')];
  globe.layers[0].params.latitudes = 4;
  const centers = [...renderSVG(globe).matchAll(/<ellipse[^>]+cy="([\d.]+)"/g)].map(m=>Number(m[1]));
  assert.ok(new Set(centers).size > 1, 'latitude ellipses should sit at distinct vertical positions');

  const rays = createDocument(); rays.width = rays.height = 256; rays.layers = [createLayer('rays','rays-1')];
  const sector = renderSVG(rays); assert.match(sector, /<path d="M[^\"]+A/);
  rays.layers[0].params.mode = 'fixedWidth';
  const bars = renderSVG(rays); assert.doesNotMatch(bars, /<path d="M[^\"]+A/);
  for (const mode of ['fixedWidth','fixedAngle','random']) {
    rays.layers[0].params.mode = mode; rays.layers[0].params.randomLength = 0;
    const base = renderSVG(rays); rays.layers[0].params.randomLength = 0.7;
    assert.notEqual(renderSVG(rays),base,`${mode} must respond to randomLength`);
  }

  const terrain = createDocument(); terrain.width = terrain.height = 256; terrain.layers = [createLayer('contour','terrain')];
  const contour = renderSVG(terrain), d = [...contour.matchAll(/<path d="([^"]+)"[^>]*stroke-linecap="round"/g)].map(m=>m[1]);
  const slopes = new Set(); let curves = 0;
  for (const path of d) curves += (path.match(/C/g) ?? []).length;
  for (const path of d) for (const m of path.matchAll(/M(-?[\d.]+),(-?[\d.]+)C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)) {
    const dx=Number(m[3])-Number(m[1]),dy=Number(m[4])-Number(m[2]); if (Math.abs(dx)>1e-6) slopes.add((dy/dx).toFixed(1));
  }
  assert.ok(curves > 100, 'contours should be reconstructed as smooth cubic curves');
  assert.ok(slopes.size > 5, 'seeded terrain should produce two-dimensional contour directions, not parallel stripes');
  terrain.layers = [createLayer('contour','quality-floor')]; terrain.layers[0].params.sampling = 16;
  assert.ok((renderSVG(terrain).match(/C/g) ?? []).length > 100, 'low sampling values should retain a protected smooth contour quality floor');
});

test('layer offsets clamp to the canvas and image data URLs accept the imported 4 MB source range', () => {
  const doc = createDocument(); doc.layers[0].offsetX = 9999; doc.layers[0].offsetY = -9999;
  const normalized = normalizeDocument(doc);
  assert.equal(normalized.layers[0].offsetX, normalized.width);
  assert.equal(normalized.layers[0].offsetY, -normalized.height);
  const oversized = createDocument(); oversized.width = oversized.height = 9000;
  oversized.layers[0].offsetX = 9000; oversized.layers[0].offsetY = -9000; oversized.layers[0].scale = 0.05;
  const bounded = normalizeDocument(oversized);
  assert.equal(bounded.width, 4096); assert.equal(bounded.height, 4096);
  assert.equal(bounded.layers[0].offsetX, 4096); assert.equal(bounded.layers[0].offsetY, -4096);
  assert.equal(bounded.layers[0].scale, 0.1);
  oversized.layers[0].scale = 3;
  assert.equal(normalizeDocument(oversized).layers[0].scale, 2);
  const image = createDocument();
  image.layers[0].customMotif = `data:image/png;base64,${'A'.repeat(5_333_336)}`;
  assert.equal(normalizeDocument(image).layers[0].customMotif.length, image.layers[0].customMotif.length);
});
