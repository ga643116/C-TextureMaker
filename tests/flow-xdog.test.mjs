/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { prepareFlow, extractFlow } from '../app/flow-xdog.mjs';
import { encodeAlphaPNG } from '../app/alpha-png.mjs';

function image(width, height, pixelAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixelAt(x, y), (y * width + x) * 4);
  }
  return data;
}

test('Flow-XDoG keeps a long synthetic stroke connected without thinning it', () => {
  const width = 72;
  const height = 72;
  const rgba = image(width, height, (x, y) => x >= 34 && x <= 36 && y >= 8 && y <= 63
    ? [18, 18, 18, 255]
    : [255, 255, 255, 255]);
  const alpha = extractFlow(prepareFlow(rgba, width, height));

  for (let y = 14; y <= 57; y++) {
    const row = alpha.subarray(y * width + 30, y * width + 42);
    assert.ok(row.some((value) => value > 8), `line should remain visible at y=${y}`);
  }
  assert.ok(alpha.some((value) => value > 180), 'dark stroke should produce strong continuous ink');
});

test('line detail changes the response to a weak luminance edge', () => {
  const width = 64;
  const height = 64;
  const rgba = image(width, height, (x) => x < 32 ? [220, 220, 220, 255] : [255, 255, 255, 255]);
  const prepared = prepareFlow(rgba, width, height);
  const lowDetail = extractFlow(prepared, { lineDetail: 49 });
  const highDetail = extractFlow(prepared, { lineDetail: 249 });
  const warmLowDetail = extractFlow(prepared, { lineDetail: 49 });
  let difference = 0;
  for (let i = 0; i < lowDetail.length; i++) difference += Math.abs(highDetail[i] - lowDetail[i]);
  assert.ok(difference > 0, 'changing p should change the weak-edge opacity');
  assert.deepEqual(warmLowDetail, lowDetail, 'warm detail-only extraction should match its cold result');
});

test('source alpha is preserved and transparent RGB does not affect lines', () => {
  const width = 48;
  const height = 48;
  const make = (hiddenColor) => image(width, height, (x) => x < 24
    ? [20, 20, 20, 255]
    : [...hiddenColor, 0]);
  const first = extractFlow(prepareFlow(make([0, 0, 0]), width, height));
  const second = extractFlow(prepareFlow(make([255, 0, 255]), width, height));
  assert.deepEqual(second, first);
  for (let y = 0; y < height; y++) {
    for (let x = 24; x < width; x++) assert.equal(first[y * width + x], 0);
  }

  const semitransparent = image(width, height, (x) => x < 24
    ? [20, 20, 20, 128]
    : [255, 255, 255, 0]);
  const semitransparentAlpha = extractFlow(prepareFlow(semitransparent, width, height));
  for (const value of semitransparentAlpha) assert.ok(value <= 128);
});

test('alpha PNG encoder returns decodable black RGBA pixels', () => {
  const alpha = Uint8Array.of(0, 1, 127, 255, 200, 32);
  const url = encodeAlphaPNG(alpha, 3, 2);
  assert.match(url, /^data:image\/png;base64,/);
  const png = PNG.sync.read(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  assert.equal(png.width, 3);
  assert.equal(png.height, 2);
  for (let i = 0; i < alpha.length; i++) {
    assert.deepEqual([...png.data.subarray(i * 4, i * 4 + 4)], [0, 0, 0, alpha[i]]);
  }

  const largeAlpha = Uint8Array.from({ length: 256 * 128 }, (_, i) => i & 255);
  const largePng = PNG.sync.read(Buffer.from(encodeAlphaPNG(largeAlpha, 256, 128).split(',')[1], 'base64'));
  for (let i = 0; i < largeAlpha.length; i++) {
    const offset = i * 4;
    assert.equal(largePng.data[offset], 0);
    assert.equal(largePng.data[offset + 1], 0);
    assert.equal(largePng.data[offset + 2], 0);
    assert.equal(largePng.data[offset + 3], largeAlpha[i]);
  }
});

test('Flow-XDoG rejects images beyond the supported edge limit', () => {
  assert.throws(() => prepareFlow(new Uint8Array(1025 * 4), 1025, 1), RangeError);
});
