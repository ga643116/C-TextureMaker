/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHistorySnapshot, restoreHistorySnapshot } from '../app/history-snapshot.mjs';

test('capture creates an immutable copy without freezing or aliasing mutable input', () => {
  const input = {
    layers: [{ id: 'layer-a', settings: { opacity: 0.75 } }],
    colorMap: { primary: '#112233' },
    redrawData: [{ points: [1, 2, 3] }]
  };
  const snapshot = captureHistorySnapshot(input);

  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.layers, input.layers);
  assert.notEqual(snapshot.layers[0], input.layers[0]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.layers));
  assert.ok(Object.isFrozen(snapshot.layers[0].settings));
  assert.ok(!Object.isFrozen(input));
  assert.ok(!Object.isFrozen(input.layers));
  assert.equal(captureHistorySnapshot(snapshot), snapshot);

  input.layers[0].settings.opacity = 0.1;
  input.colorMap.primary = '#ffffff';
  input.redrawData[0].points.push(4);
  assert.equal(snapshot.layers[0].settings.opacity, 0.75);
  assert.equal(snapshot.colorMap.primary, '#112233');
  assert.deepEqual(snapshot.redrawData[0].points, [1, 2, 3]);
});

test('retains 35 parameter edits and shares unchanged image, color map, redraw data, and layer trees', () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(256 * 1024);
  const parameters = Object.fromEntries(Array.from({ length: 35 }, (_, index) => ['parameter' + index, 0]));
  let previous = captureHistorySnapshot({
    parameters,
    layers: [{ id: 'texture', image, colorMap: { dark: '#102030', light: '#f0e0d0' } }],
    colorMap: { accent: '#ff8844' },
    redrawData: { seed: 12, points: [[1, 2], [3, 4]] }
  });
  const history = [previous];

  for (let index = 0; index < 35; index += 1) {
    const edited = restoreHistorySnapshot(previous);
    edited.parameters['parameter' + index] = index + 1;
    const next = captureHistorySnapshot(edited, previous);

    assert.equal(next.parameters['parameter' + index], index + 1);
    assert.equal(next.layers, previous.layers);
    assert.equal(next.layers[0], previous.layers[0]);
    assert.equal(next.layers[0].image, previous.layers[0].image);
    assert.equal(next.colorMap, previous.colorMap);
    assert.equal(next.redrawData, previous.redrawData);
    history.push(next);
    previous = next;
  }

  assert.equal(history.length, 36);
  assert.equal(history[0].parameters.parameter0, 0);
  assert.equal(history[1].parameters.parameter0, 1);
  assert.equal(history[35].parameters.parameter34, 35);
  assert.ok(history.every(snapshot => Object.isFrozen(snapshot)));
});

test('reuses deeply equal subtrees across layer removal, insertion, and reordering', () => {
  const previous = captureHistorySnapshot({
    layers: [
      { id: 'layer-a', texture: { pixels: [1, 2] } },
      { id: 'layer-b', texture: { pixels: [3, 4] } },
      { id: 'layer-c', texture: { pixels: [5, 6] } }
    ]
  });
  const edited = {
    layers: [
      { texture: { pixels: [5, 6] }, id: 'layer-c' },
      { id: 'layer-new', texture: { pixels: [7, 8] } },
      { id: 'layer-a', texture: { pixels: [1, 2] } }
    ]
  };
  const next = captureHistorySnapshot(edited, previous);

  assert.notEqual(next.layers, previous.layers);
  assert.equal(next.layers[0], previous.layers[2]);
  assert.notEqual(next.layers[1], previous.layers[1]);
  assert.equal(next.layers[2], previous.layers[0]);
  assert.equal(next.layers[2].texture, previous.layers[0].texture);
});

test('matches object subtrees regardless of property order and distinguishes scalar values', () => {
  const previous = captureHistorySnapshot({
    values: { nil: null, enabled: true, disabled: false, amount: 12.5, zero: -0 },
    nested: { first: 1, second: 2 }
  });
  const reordered = captureHistorySnapshot({
    nested: { second: 2, first: 1 },
    values: { zero: -0, amount: 12.5, disabled: false, enabled: true, nil: null }
  }, previous);

  assert.equal(reordered.values, previous.values);
  assert.equal(reordered.nested, previous.nested);
  assert.equal(reordered.values.nil, null);
  assert.equal(reordered.values.enabled, true);
  assert.equal(reordered.values.disabled, false);
  assert.equal(reordered.values.amount, 12.5);
  assert.ok(Object.is(reordered.values.zero, -0));
});

test('restore returns independent mutable copies suitable for undo and redo', () => {
  const before = captureHistorySnapshot({ layers: [{ id: 'a', opacity: 1 }], enabled: true });
  const firstEdit = restoreHistorySnapshot(before);
  firstEdit.layers[0].opacity = 0.5;
  firstEdit.enabled = false;
  const after = captureHistorySnapshot(firstEdit, before);

  const undo = restoreHistorySnapshot(before);
  const redo = restoreHistorySnapshot(after);
  assert.deepEqual(undo, { layers: [{ id: 'a', opacity: 1 }], enabled: true });
  assert.deepEqual(redo, { layers: [{ id: 'a', opacity: 0.5 }], enabled: false });
  assert.notEqual(undo.layers, before.layers);
  assert.notEqual(redo.layers, after.layers);
  assert.notEqual(undo.layers, redo.layers);

  undo.layers[0].opacity = 0.25;
  redo.layers[0].id = 'edited-redo-copy';
  assert.equal(before.layers[0].opacity, 1);
  assert.equal(after.layers[0].opacity, 0.5);
  assert.equal(after.layers[0].id, 'a');
});

test('does not reuse mutable objects passed as previous and rejects non-JSON values', () => {
  const mutablePrevious = { nested: { value: 1 } };
  const source = { nested: { value: 1 } };
  const snapshot = captureHistorySnapshot(source, mutablePrevious);
  assert.notEqual(snapshot.nested, mutablePrevious.nested);
  assert.notEqual(snapshot.nested, source.nested);

  const cyclic = {};
  cyclic.self = cyclic;
  for (const invalid of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    new Map(),
    new Uint8Array([1]),
    { value: undefined },
    [,],
    cyclic
  ]) {
    assert.throws(() => captureHistorySnapshot(invalid), TypeError);
  }
});
