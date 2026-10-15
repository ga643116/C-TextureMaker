/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childrenOf, clippingBase, createDocument, createGroup, createLayer,
  descendantsOf, groupLayers, isLayerVisible, moveLayers, normalizeDocument, parentOf,
  ungroupLayers, visibleLayerRows,
} from '../app/engine.mjs';

function docWith(layers) {
  const doc = createDocument();
  doc.layers = layers;
  return doc;
}

test('legacy root layers keep their schema and grouped children normalize to canonical order', () => {
  const legacy = createDocument();
  const roundTrip = normalizeDocument(structuredClone(legacy));
  assert.deepEqual(roundTrip, legacy);
  assert.equal(Object.hasOwn(roundTrip.layers[0], 'parentId'), false);

  const outer = createGroup('outer', 'Outer');
  const inner = createGroup('inner', 'Inner', 'outer');
  const doc = docWith([
    { ...createLayer('dots', 'child-a'), parentId: 'outer' },
    createLayer('grid', 'root-top'),
    { ...createLayer('contour', 'child-b'), parentId: 'inner' },
    inner,
    createLayer('waves', 'root-bottom'),
    outer,
  ]);
  const normalized = normalizeDocument(doc);
  assert.deepEqual(normalized.layers.map(layer => layer.id), [
    'root-top', 'root-bottom', 'child-a', 'child-b', 'inner', 'outer',
  ]);
  assert.deepEqual(childrenOf(normalized, 'outer').map(layer => layer.id), ['child-a', 'inner']);
  assert.deepEqual(descendantsOf(normalized, 'outer').map(layer => layer.id), ['child-a', 'child-b', 'inner']);
  assert.equal(Object.hasOwn(normalized.layers.find(layer => layer.id === 'root-bottom'), 'parentId'), false);
  assert.equal(parentOf(normalized.layers.find(layer => layer.id === 'child-b')), 'inner');
});

test('normalization rejects missing, non-group and cyclic parent references', () => {
  const patternParent = createLayer('dots', 'pattern-parent');
  const child = { ...createLayer('grid', 'child'), parentId: patternParent.id };
  assert.throws(() => normalizeDocument(docWith([patternParent, child])), /parent must be a group/i);

  const missing = createLayer('dots', 'missing-child');
  missing.parentId = 'absent';
  assert.throws(() => normalizeDocument(docWith([missing])), /invalid layer parent/i);

  const a = createGroup('cycle-a', 'A', 'cycle-b');
  const b = createGroup('cycle-b', 'B', 'cycle-a');
  assert.throws(() => normalizeDocument(docWith([createLayer('dots', 'cycle-pattern'), a, b])), /cycle/i);
});

test('grouping anchors on the highest selected branch and prunes selected descendants', () => {
  const lower = createLayer('dots', 'lower');
  const middle = createLayer('grid', 'middle');
  const upper = createLayer('waves', 'upper');
  const doc = docWith([lower, middle, upper]);
  const group = groupLayers(doc, ['upper', 'lower'], { id: 'grouped', name: 'Grouped' });
  assert.equal(group.type, 'group');
  assert.deepEqual(doc.layers.map(layer => layer.id), ['middle', 'lower', 'upper', 'grouped']);
  assert.deepEqual(childrenOf(doc, 'grouped').map(layer => layer.id), ['lower', 'upper']);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'upper')), 'grouped');

  const nested = createGroup('nested', 'Nested', 'outer');
  const outer = createGroup('outer', 'Outer');
  const inside = { ...createLayer('contour', 'inside'), parentId: 'nested' };
  const other = createLayer('halftone', 'other');
  const groupedDoc = docWith([inside, nested, outer, other]);
  groupLayers(groupedDoc, ['outer', 'inside', 'other'], { id: 'new-parent', name: 'New parent' });
  assert.equal(parentOf(groupedDoc.layers.find(layer => layer.id === 'outer')), 'new-parent');
  assert.equal(parentOf(groupedDoc.layers.find(layer => layer.id === 'inside')), 'nested');
  assert.equal(parentOf(groupedDoc.layers.find(layer => layer.id === 'other')), 'new-parent');
  assert.deepEqual(childrenOf(groupedDoc, 'new-parent').map(layer => layer.id), ['outer', 'other']);
});

test('cross-parent grouping uses the common ancestor and preserves selected branch order', () => {
  const left = createGroup('left', 'Left');
  const right = createGroup('right', 'Right');
  const leftSelected = { ...createLayer('dots', 'left-selected'), parentId: 'left' };
  const leftRemain = { ...createLayer('grid', 'left-remain'), parentId: 'left' };
  const rightSelected = { ...createLayer('waves', 'right-selected'), parentId: 'right' };
  const rightRemain = { ...createLayer('contour', 'right-remain'), parentId: 'right' };
  const doc = docWith([leftSelected, leftRemain, left, rightSelected, rightRemain, right, createLayer('halftone', 'top')]);
  groupLayers(doc, ['left-selected', 'right-selected'], { id: 'cross', name: 'Cross' });
  assert.deepEqual(childrenOf(doc, 'cross').map(layer => layer.id), ['left-selected', 'right-selected']);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'cross')), null);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'left-remain')), 'left');
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'right-remain')), 'right');
  assert.deepEqual(doc.layers.map(layer => layer.id), [
    'left-remain', 'left', 'left-selected', 'right-selected', 'cross', 'right-remain', 'right', 'top',
  ]);
});

test('moves reorder siblings, move into groups and reject cycles without changing the stack', () => {
  const group = createGroup('folder', 'Folder');
  const child = { ...createLayer('dots', 'child'), parentId: 'folder' };
  const doc = docWith([createLayer('grid', 'a'), child, group, createLayer('waves', 'b')]);
  assert.equal(moveLayers(doc, ['a'], { targetId: 'b', position: 'after' }), true);
  assert.deepEqual(childrenOf(doc).map(layer => layer.id), ['folder', 'b', 'a']);
  assert.equal(moveLayers(doc, ['a'], { targetId: 'b', position: 'after' }), false);
  assert.equal(moveLayers(doc, ['b'], { targetId: 'folder', position: 'inside' }), true);
  assert.deepEqual(childrenOf(doc, 'folder').map(layer => layer.id), ['child', 'b']);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'b')), 'folder');

  const before = JSON.stringify(doc.layers);
  assert.throws(() => moveLayers(doc, ['folder'], { targetId: 'b', position: 'inside' }), /descendant|cycle/i);
  assert.equal(JSON.stringify(doc.layers), before);
  assert.equal(moveLayers(doc, ['child'], { position: 'root' }), true);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'child')), null);
  assert.deepEqual(childrenOf(doc).map(layer => layer.id), ['folder', 'a', 'child']);
});

test('ungrouping keeps child order and hierarchy while rows and visibility follow groups', () => {
  const group = createGroup('folder', 'Folder');
  const nested = createGroup('nested', 'Nested', 'folder');
  const hiddenPattern = { ...createLayer('dots', 'hidden-pattern'), parentId: 'nested', visible: false };
  const visiblePattern = { ...createLayer('grid', 'visible-pattern'), parentId: 'folder' };
  const doc = docWith([hiddenPattern, nested, visiblePattern, group, createLayer('waves', 'top')]);
  assert.equal(isLayerVisible(doc, 'hidden-pattern'), false);
  group.visible = false;
  assert.equal(isLayerVisible(doc, 'visible-pattern'), false);
  group.visible = true;
  nested.collapsed = true;
  assert.deepEqual(visibleLayerRows(doc).map(row => row.layer.id), ['top', 'folder', 'visible-pattern', 'nested']);
  nested.collapsed = false;
  assert.deepEqual(visibleLayerRows(doc).map(row => row.layer.id), ['top', 'folder', 'visible-pattern', 'nested', 'hidden-pattern']);
  assert.deepEqual(ungroupLayers(doc, ['folder']).map(layer => layer.id), ['folder']);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'nested')), null);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'visible-pattern')), null);
  assert.equal(parentOf(doc.layers.find(layer => layer.id === 'hidden-pattern')), 'nested');
  assert.deepEqual(doc.layers.map(layer => layer.id), ['hidden-pattern', 'nested', 'visible-pattern', 'top']);
});

test('clipping bases are nearest lower image or group siblings and never escape a group', () => {
  const rootPattern = createLayer('dots', 'ignored-pattern');
  const rootMask = { id: 'root-mask', type: 'imageMask', mode: 'mask' };
  const group = createGroup('folder', 'Folder');
  const localPattern = { ...createLayer('grid', 'local-pattern'), parentId: 'folder' };
  const doc = docWith([rootMask, rootPattern, localPattern, group, createLayer('waves', 'outside')]);
  assert.equal(clippingBase(doc, 'outside').id, 'folder');
  assert.equal(clippingBase(doc, 'local-pattern'), null);

  const localMask = { id: 'local-mask', type: 'imageMask', mode: 'mask', parentId: 'folder' };
  doc.layers.unshift(localMask);
  assert.equal(clippingBase(doc, 'local-pattern').id, 'local-mask');
});