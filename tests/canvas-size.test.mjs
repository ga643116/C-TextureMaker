/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, createDocument } from '../app/engine.mjs';
import { ratioLabel, resizeCanvas } from '../app/canvas-size.mjs';

test('ratioLabel reduces dimensions to their simplest integer ratio', () => {
  assert.equal(ratioLabel(1920, 1080), '16:9');
  assert.equal(ratioLabel(1280, 1024), '5:4');
  assert.throws(() => ratioLabel(0, 720), /positive integer/);
});

test('unlocked resizing clamps and rounds only the edited dimension', () => {
  assert.deepEqual(resizeCanvas(1024, 768, 'width', 4096.4), { width: 4096, height: 768 });
  assert.deepEqual(resizeCanvas(1024, 768, 'height', 127.6), { width: 1024, height: 128 });
  assert.deepEqual(resizeCanvas(1024, 768, 'width', 640.4), { width: 640, height: 768 });
});

test('locked resizing derives the other side from the saved ratio on either axis', () => {
  const ratio = [1379, 777];
  assert.deepEqual(resizeCanvas(1379, 777, 'width', 1000, ratio), {
    width: 1000, height: Math.round(1000 * 777 / 1379),
  });
  assert.deepEqual(resizeCanvas(1379, 777, 'height', 800, ratio), {
    width: Math.round(800 * 1379 / 777), height: 800,
  });
});

test('locked resizing keeps both dimensions within bounds at extreme ratios', () => {
  assert.deepEqual(resizeCanvas(4096, 128, 'width', 512, [4096, 128]), { width: 4096, height: 128 });
  assert.deepEqual(resizeCanvas(128, 4096, 'height', 512, [128, 4096]), { width: 128, height: 4096 });
  assert.deepEqual(resizeCanvas(1920, 1080, 'width', 128, [1920, 1080]), { width: 228, height: 128 });
  assert.deepEqual(resizeCanvas(1920, 1080, 'height', 4096, [1920, 1080]), { width: 4096, height: 2304 });
});

test('locked resizing stays stable when repeated with the original ratio', () => {
  const ratio = [1379, 777];
  const resized = resizeCanvas(1379, 777, 'width', 1555, ratio);
  assert.deepEqual(resizeCanvas(resized.width, resized.height, 'width', 1555, ratio), resized);
  assert.deepEqual(resizeCanvas(resized.width, resized.height, 'height', resized.height, ratio), resized);
});

test('normalization keeps legacy documents field-compatible and persists an optional ratio', () => {
  const legacy = normalizeDocument(JSON.parse(JSON.stringify(createDocument())));
  assert.equal(Object.hasOwn(legacy, 'aspectRatio'), false);

  const source = { ...createDocument(), aspectRatio: [1379, 777] };
  const persisted = JSON.parse(JSON.stringify(normalizeDocument(source)));
  const restored = normalizeDocument(persisted);
  assert.deepEqual(restored.aspectRatio, [1379, 777]);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeDocument(JSON.parse(JSON.stringify(restored))))), persisted);

  const unlocked = normalizeDocument({ ...createDocument(), aspectRatio: null });
  assert.equal(Object.hasOwn(unlocked, 'aspectRatio'), true);
  assert.equal(unlocked.aspectRatio, null);
});

test('normalization rejects malformed or out-of-range aspect ratios', () => {
  for (const aspectRatio of [[], [1920], Array(2), [127, 128], [128, 4097], [1920.5, 1080], [Infinity, 1080]]) {
    assert.throws(() => normalizeDocument({ ...createDocument(), aspectRatio }), /Invalid document aspect ratio/);
  }
});
