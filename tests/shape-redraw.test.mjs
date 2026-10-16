/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRedraw,
  getRedrawPalette,
  normalizeRedrawData,
  normalizeRedrawEdits,
  redrawRegionColor,
  renderRedraw,
} from '../app/shape-redraw.mjs';
import { handleRedrawMessage } from '../app/redraw-worker.mjs';

function image(width, height, color = [0, 0, 0, 0]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return rgba;
}
function rect(rgba, width, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set(color, (y * width + x) * 4);
}
function regionData() {
  return {
    version: 1, width: 128, height: 128, detail: 55,
    regions: [
      { id: 'r0', color: '#e8c993', role: 0, rings: [[8, 8, 64, 8, 64, 120, 8, 120], [20, 40, 20, 60, 40, 60, 40, 40]] },
      { id: 'r1', color: '#235a88', role: 2, rings: [[70, 8, 120, 8, 120, 120, 70, 120]] },
    ],
    lines: [],
  };
}

test('transparent cutouts stay holes and disconnected same-color shapes get separate regions', () => {
  const width = 64, height = 48, rgba = image(width, height);
  rect(rgba, width, 5, 5, 29, 43, [210, 45, 45, 255]);
  rect(rgba, width, 12, 15, 21, 31, [0, 0, 0, 0]);
  rect(rgba, width, 40, 10, 58, 34, [210, 45, 45, 255]);

  const result = buildRedraw(rgba, width, height, { detail: 55, seed: 19 });
  const sameColor = result.regions.filter(region => region.color === '#d22d2d');
  assert.equal(sameColor.length, 2);
  assert.ok(sameColor.some(region => region.rings.length === 2), 'transparent cutout is encoded as a hole');
  assert.deepEqual(result.regions.map(region => region.id), result.regions.map((_, index) => 'r' + index));
  assert.ok(result.regions.every(region => region.rings.flat().every(Number.isFinite)));
});

test('detail preserves more small separated regions at higher settings', () => {
  const width = 128, height = 128, rgba = image(width, height, [245, 245, 245, 255]);
  for (let y = 2; y < height - 4; y += 6) {
    for (let x = 2; x < width - 4; x += 6) {
      const color = ((x / 6 + y / 6) | 0) % 2 ? [210, 40, 45, 255] : [35, 80, 150, 255];
      rect(rgba, width, x, y, x + 4, y + 4, color);
    }
  }
  const coarse = buildRedraw(rgba, width, height, { detail: 0, seed: 31 });
  const fine = buildRedraw(rgba, width, height, { detail: 100, seed: 31 });
  assert.ok(fine.regions.length > coarse.regions.length, 'higher detail retains isolated small patches');
});

test('two-tone role assignment always keeps the darkest and brightest clusters', () => {
  const width = 80, height = 80, rgba = image(width, height, [24, 24, 24, 255]);
  rect(rgba, width, 0, 0, width, 16, [235, 235, 235, 255]);
  const data = buildRedraw(rgba, width, height, { detail: 100, seed: 72 });
  const channel = color => color.slice(1).match(/../g).map(value => parseInt(value, 16));
  const bright = data.regions.reduce((best, region) => Math.max(...channel(region.color)) > Math.max(...channel(best.color)) ? region : best);
  const dark = data.regions.reduce((best, region) => Math.min(...channel(region.color)) < Math.min(...channel(best.color)) ? region : best);
  assert.equal(bright.role, 0);
  assert.equal(dark.role, 2);
  const palette = getRedrawPalette({ redrawData: data, params: { mode: 'three', paletteMode: 'original' } });
  assert.equal(palette.length, 3);
  assert.ok(parseInt(palette[0].slice(1, 3), 16) > parseInt(palette[2].slice(1, 3), 16));
});
test('fixed seed and image produce deterministic region IDs and geometry', () => {
  const width = 48, height = 48, rgba = image(width, height, [240, 236, 220, 255]);
  rect(rgba, width, 4, 4, 26, 44, [160, 35, 45, 255]);
  rect(rgba, width, 25, 12, 44, 40, [24, 55, 82, 255]);
  const first = buildRedraw(rgba, width, height, { detail: 62, seed: 808 });
  const second = buildRedraw(rgba, width, height, { detail: 62, seed: 808 });
  assert.deepEqual(second, first);
});

test('straightness simplifies vector paths without changing region identity', () => {
  const ring = [];
  for (let index = 0; index < 64; index++) {
    const angle = index * Math.PI * 2 / 64;
    const radius = index % 2 ? 36 : 30;
    ring.push(50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle));
  }
  const data = normalizeRedrawData({
    version: 1, width: 100, height: 100, detail: 55,
    regions: [{ id: 'r0', color: '#c43a30', role: 1, rings: [ring] }],
    lines: [],
  });
  const layer = { id: 'shape-a', redrawData: data, redrawEdits: {}, redrawPalette: [], params: { mode: 'blocks', paletteMode: 'original', straightness: 0 } };
  const raw = renderRedraw(layer, { width: 100, height: 100 });
  layer.params.straightness = 12;
  const straight = renderRedraw(layer, { width: 100, height: 100 });
  const pathPointCount = svg => (svg.match(/L/g) || []).length;
  assert.ok(pathPointCount(straight) < pathPointCount(raw));
  assert.match(straight, /id="redraw-shape-a-r0"/);
  assert.match(raw, /id="redraw-shape-a-r0"/);
});

test('palette modes, region override and hidden preview/export behavior are stable', () => {
  const data = normalizeRedrawData(regionData());
  const layer = {
    id: 'layer-a', redrawData: data, redrawEdits: { r1: { color: '#A31A42' } },
    redrawPalette: ['#ffffff', '#ffce00', '#121212'],
    params: { mode: 'blocks', paletteMode: 'original', straightness: 0, lines: false, lineWidth: 1, lineColor: '#202020', outlineWidth: 0 },
  };
  assert.deepEqual(getRedrawPalette(layer), ['#e8c993', '#235a88']);
  assert.equal(redrawRegionColor(data.regions[1], layer), '#a31a42');
  delete layer.redrawEdits.r1.color;
  layer.params.mode = 'three';
  assert.equal(getRedrawPalette(layer).length, 3);
  assert.equal(redrawRegionColor(data.regions[1], layer), getRedrawPalette(layer)[2]);
  layer.params.mode = 'blocks';
  layer.redrawEdits.r1.color = '#a31a42';
  layer.redrawEdits.r1.hidden = true;

  const preview = renderRedraw(layer, { width: 128, height: 128 }, { preview: true });
  const hiddenPath = preview.match(/<path[^>]*data-redraw-region="r1"[^>]*>/)?.[0];
  assert.ok(hiddenPath);
  assert.match(hiddenPath, /data-layer="layer-a"/);
  assert.match(hiddenPath, /fill-opacity="0"/);
  assert.equal((hiddenPath.match(/pointer-events="all"/g) || []).length, 1);
  const output = renderRedraw(layer, { width: 128, height: 128 });
  assert.doesNotMatch(output, /redraw-layer-a-r1/);
  assert.doesNotMatch(output, /data-redraw-region/);
});

test('normalizers reject malformed geometry, orphan edits and excessive coordinates', () => {
  const valid = regionData();
  assert.equal(normalizeRedrawData(undefined), null);
  assert.throws(() => normalizeRedrawData({ ...valid, unexpected: true }), /fields/);
  assert.throws(() => normalizeRedrawData({ ...valid, regions: [{ ...valid.regions[0], rings: [[-1, 0, 10, 0, 10, 10, 0, 10]] }] }), /coordinate/);
  assert.throws(() => normalizeRedrawData({ ...valid, regions: [{ ...valid.regions[0], rings: [valid.regions[0].rings[0], [80, 20, 80, 30, 90, 30, 90, 20]] }] }), /hole/);
  assert.throws(() => normalizeRedrawData({ ...valid, regions: [{ ...valid.regions[0], rings: [[0, 0, Infinity, 0, 10, 10]] }] }), /coordinate/);
  assert.throws(() => normalizeRedrawEdits({ missing: { hidden: true } }, normalizeRedrawData(valid)), /edit/);
  assert.throws(() => normalizeRedrawEdits({ r0: { visible: false } }, normalizeRedrawData(valid)), /fields/);

  const hugeRing = new Array(500002).fill(0);
  assert.throws(() => normalizeRedrawData({
    version: 1, width: 128, height: 128, detail: 55,
    regions: [{ id: 'r0', color: '#abcdef', role: 0, rings: [hugeRing] }],
    lines: [],
  }), /TooComplex/);
});

test('worker accepts transferred pixels locally and returns structured failures', () => {
  const width = 16, height = 16, rgba = image(width, height, [255, 255, 255, 255]);
  const good = handleRedrawMessage({ id: 'job-1', rgba: rgba.buffer, width, height, detail: 55, seed: 4 });
  assert.equal(good.id, 'job-1');
  assert.equal(good.data.version, 1);
  assert.equal(good.data.regions.length, 1);
  const bad = handleRedrawMessage({ id: 'job-2', rgba: new ArrayBuffer(4), width, height });
  assert.equal(bad.id, 'job-2');
  assert.equal(typeof bad.error, 'string');
  assert.equal(Object.hasOwn(bad, 'data'), false);
});