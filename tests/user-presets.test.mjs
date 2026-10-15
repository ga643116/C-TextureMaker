/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createImageMaskLayer, createLayer, isImageMaskLayer, switchLayerPattern } from '../app/engine.mjs';
import { applyUserPreset, createUserPreset, presetPreview, readPreset } from '../app/user-presets.mjs';

const image = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#fff"/></svg>',
).toString('base64');

function imageLayer(id, overrides = {}) {
  return { ...createImageMaskLayer({ id, name: 'Reference image', image, imageWidth: 2, imageHeight: 2 }), ...overrides };
}

function presetFor(layer, overrides = {}) {
  return { id: 'preset-1', name: 'Preset', version: 2, layer, seed: 987, width: 640, height: 360, ...overrides };
}

test('createUserPreset stores only the selected layer and preview metadata as independent data', () => {
  const doc = createDocument();
  const layer = createLayer('dots', 'selected-layer');
  layer.params.spacing = 57;
  doc.name = 'Project title';
  doc.width = 640;
  doc.height = 360;
  doc.seed = 123;
  doc.layers = [layer, createLayer('grid', 'other-layer')];
  const before = JSON.stringify(doc);
  const preset = createUserPreset(doc, layer.id, { id: 'preset-a', name: '  My dots  ' });

  assert.deepEqual(Object.keys(preset), ['id', 'name', 'version', 'layer', 'seed', 'width', 'height']);
  assert.equal(preset.name, 'My dots');
  assert.equal(preset.version, 2);
  const expectedLayer = structuredClone(layer);
  delete expectedLayer.imageSource;
  assert.deepEqual(preset.layer, expectedLayer);
  assert.equal(preset.seed, 123);
  assert.equal(preset.width, 640);
  assert.equal(preset.height, 360);
  assert.equal(Object.hasOwn(preset, 'document'), false);
  assert.equal(Object.hasOwn(preset, 'projectFileToken'), false);
  assert.equal(JSON.stringify(doc), before);
  preset.layer.params.spacing = 88;
  assert.equal(doc.layers[0].params.spacing, 57);
});

test('pattern application preserves document identity, target history, and other layers', () => {
  let target = createLayer('dots', 'target');
  target.params.spacing = 44;
  target = switchLayerPattern(target, 'grid');
  target.params.cellSize = 72;
  target = switchLayerPattern(target, 'dots');
  target.visible = false;
  const historyBefore = structuredClone(target.patternSettings);

  const source = createDocument();
  source.width = 512;
  source.height = 384;
  source.seed = 800;
  source.layers = [createLayer('concentric', 'preset-source')];
  source.layers[0].params.count = 35;
  source.layers[0].color = '#123456';
  const patternPreset = createUserPreset(source, 'preset-source', { id: 'pattern-preset', name: 'Concentric' });

  const doc = createDocument();
  doc.name = 'Keep this project';
  doc.width = 1440;
  doc.height = 900;
  doc.transparent = false;
  doc.background = '#abcdef';
  doc.seamless = true;
  doc.seed = 52;
  const selectedImage = imageLayer('selected-image', { visible: false });
  const other = createLayer('waves', 'other');
  other.params.amplitude = 93;
  doc.layers = [selectedImage, target, other];
  const before = JSON.stringify(doc);
  const result = applyUserPreset(doc, selectedImage.id, patternPreset);
  const applied = result.document.layers.find(layer => layer.id === target.id);

  assert.equal(result.selectedId, target.id);
  assert.equal(applied.type, 'concentric');
  assert.equal(applied.id, target.id);
  assert.equal(applied.visible, false);
  assert.equal(applied.params.count, 35);
  assert.equal(applied.color, '#123456');
  assert.deepEqual(applied.patternSettings.grid, historyBefore.grid);
  assert.equal(applied.patternSettings.dots.params.spacing, 44);
  assert.deepEqual(result.document.layers[0], selectedImage);
  assert.deepEqual(result.document.layers[2], other);
  assert.equal(result.document.name, 'Keep this project');
  assert.equal(result.document.width, 1440);
  assert.equal(result.document.height, 900);
  assert.equal(result.document.transparent, false);
  assert.equal(result.document.background, '#abcdef');
  assert.equal(result.document.seamless, true);
  assert.equal(result.document.seed, 52);
  assert.equal(JSON.stringify(doc), before);

  const restoredDots = switchLayerPattern(applied, 'dots');
  assert.equal(restoredDots.params.spacing, 44);
});

test('image presets replace selected images or add a separately identified image layer', () => {
  const imagePresetDoc = createDocument();
  imagePresetDoc.layers = [createLayer('dots', 'image-preset-pattern'), imageLayer('preset-image', { mode: 'color', colorMap: { width: 1, height: 1, rgba: '/////w==' } })];
  const imagePreset = createUserPreset(imagePresetDoc, 'preset-image', { id: 'image-preset', name: 'Image treatment' });

  const doc = createDocument();
  const selectedImage = imageLayer('replace-this', { name: 'Old source', visible: false, threshold: 72 });
  const art = createLayer('dots', 'art');
  art.params.spacing = 91;
  doc.layers = [selectedImage, art];
  const before = JSON.stringify(doc);
  const replaced = applyUserPreset(doc, selectedImage.id, imagePreset);

  assert.equal(replaced.selectedId, selectedImage.id);
  assert.equal(replaced.document.layers[0].id, selectedImage.id);
  assert.equal(replaced.document.layers[0].visible, false);
  assert.equal(replaced.document.layers[0].name, 'Reference image');
  assert.equal(replaced.document.layers[0].mode, 'color');
  assert.equal(replaced.document.layers[0].threshold, 128);
  assert.deepEqual(replaced.document.layers[1], art);

  const added = applyUserPreset(doc, art.id, imagePreset, 'new-image');
  assert.equal(added.selectedId, 'new-image');
  assert.equal(added.document.layers.length, 3);
  assert.equal(added.document.layers[2].id, 'new-image');
  assert.equal(isImageMaskLayer(added.document.layers[2]), true);
  assert.equal(JSON.stringify(doc), before);
});

test('legacy presets normalize a copy, choose the first pattern, and retain their full preview', () => {
  const legacyDoc = createDocument();
  legacyDoc.layers = [
    imageLayer('legacy-image'),
    createLayer('halftone', 'first-pattern'),
    createLayer('grid', 'second-pattern'),
  ];
  legacyDoc.layers[1].params.spacing = 83;
  const legacyPreset = { id: 'legacy', name: 'Legacy', document: legacyDoc };
  const before = JSON.stringify(legacyPreset);
  const data = readPreset(legacyPreset);
  const preview = presetPreview(legacyPreset);

  assert.equal(data.layer.id, 'first-pattern');
  assert.equal(data.layer.type, 'halftone');
  assert.equal(data.layer.params.spacing, 83);
  assert.equal(data.seed, legacyDoc.seed);
  assert.equal(preview.layers.length, 3);
  assert.equal(JSON.stringify(legacyPreset), before);
});

test('invalid presets and image-capacity overflow are rejected without mutating inputs', () => {
  const bad = presetFor(createLayer('dots', 'valid-layer'), { seed: 0 });
  const beforeBad = JSON.stringify(bad);
  assert.throws(() => readPreset(bad), /seed|Invalid/i);
  assert.equal(JSON.stringify(bad), beforeBad);

  const imagePreset = presetFor(imageLayer('preset-image'));
  const fullDoc = createDocument();
  fullDoc.layers = [createLayer('dots', 'art')];
  for (let i = 0; i < 15; i++) fullDoc.layers.push(imageLayer('image-' + i));
  const beforeDoc = JSON.stringify(fullDoc);
  assert.throws(() => applyUserPreset(fullDoc, 'art', imagePreset, 'extra-image'), /16 layers/);
  assert.equal(JSON.stringify(fullDoc), beforeDoc);
});

test('application and reads never share nested references with source documents or presets', () => {
  const source = createDocument();
  source.layers = [createLayer('dots', 'source-layer')];
  source.layers[0].params.spacing = 66;
  const preset = createUserPreset(source, 'source-layer', { id: 'shared-preset', name: 'Shared' });
  const sourceDoc = createDocument();
  sourceDoc.layers = [createLayer('dots', 'target-layer'), createLayer('grid', 'other-layer')];

  const read = readPreset(preset);
  read.layer.params.spacing = 17;
  assert.equal(preset.layer.params.spacing, 66);

  const result = applyUserPreset(sourceDoc, 'target-layer', preset);
  result.document.layers[0].params.spacing = 99;
  result.document.layers[1].params.cellSize = 23;
  assert.equal(preset.layer.params.spacing, 66);
  assert.equal(sourceDoc.layers[0].params.spacing, 32);
  assert.equal(sourceDoc.layers[1].params.cellSize, 64);
});
