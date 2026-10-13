/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {autoThreshold,binaryPreview,classifyCells,grayscaleImage} from '../app/image-cells.mjs';

const field = (width, height, gray, alpha = gray.map(() => 255)) => ({
  width,
  height,
  gray: Uint8Array.from(gray),
  alpha: Uint8Array.from(alpha),
});

test('grayscale uses Rec.709, composites against white, and preserves alpha', () => {
  const image = grayscaleImage({
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 0, 128,
      0, 0, 0, 0,
    ]),
  });
  assert.deepEqual([...image.gray], [54, 182, 127, 255]);
  assert.deepEqual([...image.alpha], [255, 255, 128, 0]);
});

test('Otsu ignores transparent pixels and centers flat optima', () => {
  assert.equal(autoThreshold(field(1, 1, [0], [0])), 127);
  assert.equal(autoThreshold(field(2, 1, [0, 255], [255, 0])), 127);
  assert.equal(autoThreshold(field(3, 1, [0, 0, 0])), 127);
  assert.equal(autoThreshold(field(3, 1, [255, 255, 255])), 127);
  assert.equal(autoThreshold(field(4, 1, [0, 0, 200, 200])), 100);
});

test('binary preview applies dark and inverted thresholds while preserving transparent alpha', () => {
  const mask = field(3, 1, [0, 255, 0], [255, 255, 0]);
  assert.deepEqual([...binaryPreview(mask, { threshold: 127 })], [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
  assert.deepEqual([...binaryPreview(mask, { threshold: 127, invert: true })], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0]);
});

test('classifies a non-square field in document coordinates and ignores offscreen centers', () => {
  const mask = field(2, 1, [0, 255]);
  const result = classifyCells(mask, [
    { id: 'dark', x: 1, y: 1 },
    { id: 'light', x: 3, y: 1 },
    { id: 'outside', x: 4, y: 1 },
  ], { width: 4, height: 2, threshold: 127 });
  assert.deepEqual(result, { hiddenCells: ['light'], visibleCount: 1, totalCount: 2 });
});

test('duplicate IDs keep the first valid copy in stable input order', () => {
  const mask = field(2, 1, [0, 255]);
  const firstDark = classifyCells(mask, [
    { id: 'same', x: 0.5, y: 0.5 },
    { id: 'same', x: 1.5, y: 0.5 },
  ], { width: 2, height: 1, threshold: 127 });
  const firstLight = classifyCells(mask, [
    { id: 'same', x: 1.5, y: 0.5 },
    { id: 'same', x: 0.5, y: 0.5 },
  ], { width: 2, height: 1, threshold: 127 });
  assert.deepEqual(firstDark, { hiddenCells: [], visibleCount: 1, totalCount: 1 });
  assert.deepEqual(firstLight, { hiddenCells: ['same'], visibleCount: 0, totalCount: 1 });
});

test('seamless classification wraps cell centers and transparent samples stay hidden when inverted', () => {
  const mask = field(3, 1, [255, 255, 0], [0, 255, 255]);
  const result = classifyCells(mask, [
    { id: 'transparent', x: 0.5, y: 0.5 },
    { id: 'bright', x: 1.5, y: 0.5 },
    { id: 'dark', x: 2.5, y: 0.5 },
    { id: 'wrapped', x: 4.5, y: 0.5 },
  ], { width: 3, height: 1, threshold: 127, invert: true, seamless: true });
  assert.deepEqual(result, { hiddenCells: ['transparent', 'dark'], visibleCount: 2, totalCount: 4 });
});

test('rejects malformed image and threshold inputs', () => {
  assert.throws(() => grayscaleImage({ width: 0, height: 1, data: new Uint8ClampedArray(0) }), TypeError);
  assert.throws(() => binaryPreview(field(1, 1, [0]), { threshold: 256 }), TypeError);
});
