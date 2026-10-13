/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {autoThreshold,grayscaleImage} from '../app/image-threshold.mjs';

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

test('rejects malformed source pixels and histogram fields', () => {
  assert.throws(() => grayscaleImage({ width: 0, height: 1, data: new Uint8ClampedArray(0) }), TypeError);
  assert.throws(() => grayscaleImage({ width: 2, height: 1, data: new Uint8ClampedArray(4) }), TypeError);
  assert.throws(() => autoThreshold(field(2, 1, [0])), TypeError);
});
