/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { createDocument, createLayer, normalizeDocument, renderSVG } from '../app/engine.mjs';

const setup = (type = 'dots', width = 256, height = 256) => {
  const doc = createDocument();
  doc.width = width;
  doc.height = height;
  doc.layers = [createLayer(type, 'link-layer')];
  return doc;
};
const raster = svg => PNG.sync.read(new Resvg(svg).render().asPng());
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const toSvgData = svg => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
const cellCenters = svg => [...svg.matchAll(/data-cell="([^\"]+)" data-layer="[^\"]+"[^>]*data-cx="(-?[\d.]+)" data-cy="(-?[\d.]+)"/g)]
  .map(match => ({ id: match[1], x: Number(match[2]), y: Number(match[3]) }));
const cellLinks = svg => [...svg.matchAll(/<path data-cell-link="([^\"]+)" d="M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)" fill="none" stroke="([^\"]+)" stroke-width="([^\"]+)" pointer-events="none"\/>/g)]
  .map(match => ({ pair: match[1], x1: Number(match[2]), y1: Number(match[3]), x2: Number(match[4]), y2: Number(match[5]), color: match[6], width: Number(match[7]) }));
const near = (actual, expected, epsilon = 0.002) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);

test('version 1 projects receive defaults and new layer fields retain strict validation', () => {
  const old = structuredClone(createDocument());
  for (const key of ['motifTint', 'cellLinks', 'linkWidth']) delete old.layers[0][key];
  const loaded = normalizeDocument(old).layers[0];
  assert.equal(loaded.motifTint, false);
  assert.deepEqual(loaded.cellLinks, []);
  assert.equal(loaded.linkWidth, 2);

  const linked = setup();
  linked.layers[0].cellLinks = [{ from: '1:1', to: '0:0' }, { from: '0:0', to: '1:1' }];
  linked.layers[0].linkWidth = 0.01;
  const normalized = normalizeDocument(linked).layers[0];
  assert.deepEqual(normalized.cellLinks, [{ from: '0:0', to: '1:1' }], 'reversed duplicate pairs should collapse to one stable pair');
  assert.equal(normalized.linkWidth, 0.25);
  linked.layers[0].linkWidth = 1000;
  assert.equal(normalizeDocument(linked).layers[0].linkWidth, 128);

  const invalid = value => {
    const doc = setup();
    Object.assign(doc.layers[0], value);
    return () => normalizeDocument(doc);
  };
  assert.throws(invalid({ motifTint: 'yes' }), /Invalid motifTint/);
  assert.throws(invalid({ motifTint: undefined }), /Invalid motifTint/);
  assert.throws(invalid({ cellLinks: undefined }), /Invalid cellLinks/);
  assert.throws(invalid({ linkWidth: undefined }), /Invalid linkWidth/);
  assert.throws(invalid({ cellLinks: [{ from: '0:0', to: '1:1', color: '#fff' }] }), /Invalid cell link/);
  assert.throws(invalid({ cellLinks: [{ from: '0:0', to: '0:0' }] }), /cannot connect/);
  assert.throws(invalid({ cellLinks: [{ from: '0:-1', to: '1:1' }] }), /endpoint/);
  assert.throws(invalid({ cellLinks: [{ from: '0:0', to: '1:1' }], unexpected: true }), /Unknown layer field/);
  assert.throws(invalid({ linkWidth: Number.POSITIVE_INFINITY }), /Invalid linkWidth/);
  assert.throws(invalid({ cellLinks: Array.from({ length: 2001 }, (_, i) => ({ from: `${i}:0`, to: `${i}:1` })) }), /Invalid cellLinks/);
});

test('motifTint applies the selected color through PNG and SVG alpha while the default preserves source colors', async () => {
  const png = new PNG({ width: 300, height: 100 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const rgba = x < 100 ? [255, 0, 0, 0] : x < 200 ? [0, 255, 0, 128] : [0, 0, 255, 255];
    png.data.set(rgba, (y * png.width + x) * 4);
  }
  const pngUrl = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
  const svgUrl = toSvgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="100" height="100" fill="#f00" opacity="0"/><rect x="100" width="100" height="100" fill="#0f0" opacity=".5"/><rect x="200" width="100" height="100" fill="#00f"/></svg>');

  for (const source of [pngUrl, svgUrl]) {
    const doc = setup('dots', 128, 128), layer = doc.layers[0];
    Object.assign(layer.params, { finite: true, rows: 1, columns: 1, size: 96 });
    Object.assign(layer, { customMotif: source, motifTint: true, color: '#123456' });
    const svg = renderSVG(doc), image = raster(svg);
    assert.equal((svg.match(/href="data:image\//g) ?? []).length, 1, 'the custom motif data image should be embedded once');
    const transparent = pixel(image, 32, 64), half = pixel(image, 64, 64), opaque = pixel(image, 96, 64);
    assert.equal(transparent[3], 0);
    assert.deepEqual(half.slice(0, 3), [0x12, 0x34, 0x56]);
    assert.ok(Math.abs(half[3] - 128) <= 1, `semi-transparent source alpha should survive tinting (${half[3]})`);
    assert.deepEqual(opaque, [0x12, 0x34, 0x56, 255]);
  }

  const original = setup('dots', 128, 128), layer = original.layers[0];
  Object.assign(layer.params, { finite: true, rows: 1, columns: 1, size: 96 });
  Object.assign(layer, { customMotif: pngUrl, color: '#123456' });
  const sourceImage = raster(renderSVG(original));
  assert.deepEqual(pixel(sourceImage, 64, 64), [0, 255, 0, 128], 'untinted mode should preserve original motif pixels');
});

test('dots, triangles and hexagons link their registered centers and follow layer transforms', () => {
  for (const type of ['dots', 'polygons']) {
    const doc = setup(type), layer = doc.layers[0];
    if (type === 'dots') Object.assign(layer.params, { finite: true, rows: 2, columns: 2, size: 18 });
    else Object.assign(layer.params, { shape: 'triangle', cellSize: 64, shapeScale: 0.85, showGrid: false });
    Object.assign(layer, { rotation: 31, scale: 1.4, offsetX: 19, offsetY: -13, opacity: 0.55, color: '#224466', linkWidth: 4 });
    for (const shape of type === 'polygons' ? ['triangle', 'hexagon'] : ['circle']) {
      if (type === 'polygons') layer.params.shape = shape;
      const before = renderSVG(doc, { preview: true });
      const centers = cellCenters(before);
      assert.ok(centers.length > 1, `${type}/${shape} should expose preview cell centers`);
      const pair = centers.slice(0, 2).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      layer.cellLinks = [{ from: pair[1].id, to: pair[0].id }];
      const svg = renderSVG(doc, { preview: true }), segment = cellLinks(svg)[0];
      assert.ok(segment, `${type}/${shape} should emit one link segment`);
      assert.equal(segment.pair, `${pair[0].id}|${pair[1].id}`);
      near(segment.x1, pair[0].x); near(segment.y1, pair[0].y);
      near(segment.x2, pair[1].x); near(segment.y2, pair[1].y);
      assert.equal(segment.color, layer.color);
      assert.equal(segment.width, layer.linkWidth);
      assert.match(svg, /translate\(19 -13\).*rotate\(31\) scale\(1\.4\)/, 'link and cells should share the layer transform');
      assert.match(svg, /<g opacity="0\.55">/, 'the layer opacity should cover its links');
      const lineTag = svg.match(/<path data-cell-link="[^"]+"[^>]+\/>/)?.[0] ?? '';
      assert.doesNotMatch(lineTag, /data-cell=/, 'link metadata must not look like a clickable cell');
      assert.match(lineTag, /pointer-events="none"/);
    }
  }

  const unsupported = setup('contour');
  unsupported.layers[0].cellLinks = [{ from: '0:0', to: '1:1' }];
  assert.doesNotMatch(renderSVG(unsupported, { preview: true }), /data-cell-link=/, 'links should only render for dots and polygons');
});

test('a hidden endpoint suppresses its connection in preview and export', () => {
  const doc = setup('dots'), layer = doc.layers[0];
  Object.assign(layer.params, { finite: true, rows: 2, columns: 2, size: 18 });
  layer.cellLinks = [{ from: '0:0', to: '1:1' }];
  layer.hiddenCells = ['0:0'];
  const preview = renderSVG(doc, { preview: true });
  assert.match(preview, /data-cell="0:0"[^>]*data-hidden="true"/);
  assert.equal(cellLinks(preview).length, 0);
  assert.equal(cellLinks(renderSVG(doc)).length, 0);
});

test('seamless links use the shortest periodic path, copy across the seam and repeat in the 3 by 3 preview', () => {
  const doc = setup('dots'), layer = doc.layers[0];
  doc.seamless = true;
  Object.assign(layer.params, { spacing: 64, size: 10, finite: false, arrangement: 'grid' });
  const initial = renderSVG(doc, { preview: true, repeat: 3 }), cells = cellCenters(initial);
  let pair = null;
  for (const left of cells.filter(cell => cell.x < doc.width / 4)) {
    const right = cells.find(cell => cell.x > doc.width * 3 / 4 && Math.abs(cell.y - left.y) < 0.002);
    if (right) { pair = [left, right]; break; }
  }
  assert.ok(pair, 'the fitted periodic dot grid should provide cells on opposite sides of one row');
  layer.cellLinks = [{ from: pair[0].id, to: pair[1].id }];
  const preview = renderSVG(doc, { preview: true, repeat: 3 }), previewLine = cellLinks(preview)[0];
  assert.ok(previewLine);
  assert.ok(Math.abs(previewLine.x2 - previewLine.x1) < doc.width / 2, 'the connection should use the shorter horizontal period');
  assert.ok(Math.min(previewLine.x1, previewLine.x2) < 0 || Math.max(previewLine.x1, previewLine.x2) > doc.width, 'the shortest segment should cross the tile boundary');
  assert.equal((preview.match(/data-cell-link=/g) ?? []).length, 1, 'the segment should be authored once and reused by preview tiles');

  const tile = raster(renderSVG(doc)), sheet = raster(renderSVG(doc, { repeat: 3 }));
  const seamRows = [Math.round(previewLine.y1) - 1, Math.round(previewLine.y1), Math.round(previewLine.y1) + 1];
  const leftPainted = seamRows.some(y => [0, 1, 2].some(x => pixel(tile, x, y)[3] > 0));
  const rightPainted = seamRows.some(y => [doc.width - 3, doc.width - 2, doc.width - 1].some(x => pixel(tile, x, y)[3] > 0));
  assert.ok(leftPainted && rightPainted, 'both sides of the seamless export should contain the boundary connection');
  for (let tileY = 0; tileY < 3; tileY++) for (let tileX = 0; tileX < 3; tileX++) {
    let difference = 0;
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const sheetOffset = ((tileY * doc.height + y) * sheet.width + tileX * doc.width + x) * 4;
      const tileOffset = (y * tile.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) difference += Math.abs(sheet.data[sheetOffset + channel] - tile.data[tileOffset + channel]);
    }
    assert.equal(difference, 0, 'every 3 by 3 preview tile should match export');
  }
});

test('seamless polygon links stay aligned after rotation and scale in repeated preview sources', () => {
  for (const shape of ['triangle', 'hexagon']) {
    const doc = setup('polygons'), layer = doc.layers[0];
    doc.seamless = true;
    Object.assign(layer.params, { shape, cellSize: 64, shapeScale: 0.85, showGrid: false });
    Object.assign(layer, { rotation: 23, scale: 0.7, offsetX: 17, offsetY: -21 });
    const first = renderSVG(doc, { preview: true, repeat: 3 }), centers = cellCenters(first);
    const pair = centers.slice(0, 2).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    assert.equal(pair.length, 2);
    layer.cellLinks = [{ from: pair[0].id, to: pair[1].id }];
    const svg = renderSVG(doc, { preview: true, repeat: 3 }), segment = cellLinks(svg)[0];
    assert.ok(segment, `${shape} should have a repeated link source`);
    const cx = doc.width / 2, cy = doc.height / 2, angle = layer.rotation * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
    const world = ([x,y]) => [cx + layer.scale * (ca * (x - cx) - sa * (y - cy)), cy + layer.scale * (sa * (x - cx) + ca * (y - cy))];
    const start = world([segment.x1, segment.y1]), end = world([segment.x2, segment.y2]);
    const expectedStart = world([pair[0].x, pair[0].y]), expectedEnd = world([pair[1].x, pair[1].y]);
    const wrap = (delta, extent) => ((delta + extent / 2) % extent + extent) % extent - extent / 2;
    near(start[0], expectedStart[0]); near(start[1], expectedStart[1]);
    near(end[0] - start[0], wrap(expectedEnd[0] - expectedStart[0], doc.width));
    near(end[1] - start[1], wrap(expectedEnd[1] - expectedStart[1], doc.height));
    assert.match(svg, /translate\(17 -21\).*rotate\(23\) scale\(0\.7\)/);
    assert.equal((svg.match(/data-cell-link=/g) ?? []).length, 1);
  }
});
