/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { createDocument, createLayer, isImageMaskLayer, normalizeDocument, switchLayerPattern } from './engine.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new TypeError(message); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);
const PRESET_KEYS = new Set(['id', 'name', 'version', 'layer', 'seed', 'width', 'height']);
const CURRENT_PATTERN_KEYS = [
  'opacity', 'color', 'secondary', 'rotation', 'scale', 'offsetX', 'offsetY',
  'params', 'pixelPalette', 'hiddenCells', 'customMotif', 'motifTint', 'cellLinks', 'linkWidth', 'mask',
];

function presetName(value) {
  assert(typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Invalid preset name');
  const name = value.trim();
  assert(name.length >= 1 && name.length <= 80, 'Invalid preset name');
  return name;
}

function validationDocument(layer, seed, width, height) {
  const layers = [clone(layer)];
  if (isImageMaskLayer(layer)) {
    let patternId = '__preset_validation__';
    while (patternId === layer.id) patternId += '_';
    layers.unshift(createLayer('contour', patternId));
  }
  return normalizeDocument({ ...createDocument(), name: 'Preset validation', width, height, seed, layers });
}

function normalizeLayer(layer, seed, width, height) {
  assert(isObject(layer), 'Invalid preset layer');
  const document = validationDocument(layer, seed, width, height);
  return {
    layer: clone(isImageMaskLayer(layer) ? document.layers[1] : document.layers[0]),
    seed: document.seed,
    width: document.width,
    height: document.height,
  };
}

function isLegacyPreset(preset) {
  return isObject(preset) && (preset.version === undefined || preset.version === 1) && isObject(preset.document);
}

function normalizeLegacyPreset(preset) {
  const document = normalizeDocument(clone(preset.document));
  const layer = document.layers.find(candidate => !isImageMaskLayer(candidate));
  assert(layer, 'Legacy preset must contain a pattern layer');
  return { layer: clone(layer), seed: document.seed, width: document.width, height: document.height };
}

function normalizeVersion2Preset(preset) {
  assert(isObject(preset) && preset.version === 2, 'Unsupported preset version');
  for (const key of Object.keys(preset)) assert(PRESET_KEYS.has(key), 'Unknown preset field: ' + key);
  for (const key of PRESET_KEYS) assert(Object.hasOwn(preset, key), 'Missing preset field: ' + key);
  assert(safeId(preset.id), 'Invalid preset id');
  presetName(preset.name);
  return normalizeLayer(preset.layer, preset.seed, preset.width, preset.height);
}

function previewDocument(presetData) {
  const layers = [clone(presetData.layer)];
  if (isImageMaskLayer(presetData.layer)) {
    let patternId = '__preset_preview__';
    while (patternId === presetData.layer.id) patternId += '_';
    layers.unshift(createLayer('contour', patternId));
  }
  return normalizeDocument({
    ...createDocument(),
    name: 'Preset preview',
    width: presetData.width,
    height: presetData.height,
    seed: presetData.seed,
    layers,
  });
}

export function createUserPreset(doc, layerId, { id, name } = {}) {
  assert(safeId(id), 'Invalid preset id');
  const cleanName = presetName(name);
  const document = normalizeDocument(clone(doc));
  const layer = document.layers.find(candidate => candidate.id === layerId);
  assert(layer, 'Preset layer was not found');
  const presetLayer = clone(layer);
  delete presetLayer.imageSource;
  for (const snapshot of Object.values(presetLayer.patternSettings ?? {})) delete snapshot.imageSource;
  return {
    id,
    name: cleanName,
    version: 2,
    layer: clone(presetLayer),
    seed: document.seed,
    width: document.width,
    height: document.height,
  };
}

export function readPreset(preset) {
  if (preset?.version === 2) return normalizeVersion2Preset(preset);
  assert(isLegacyPreset(preset), 'Invalid preset');
  return normalizeLegacyPreset(preset);
}

export function presetPreview(preset) {
  if (isLegacyPreset(preset)) return normalizeDocument(clone(preset.document));
  return previewDocument(readPreset(preset));
}

export function applyUserPreset(doc, selectedId, preset, newId) {
  const presetData = readPreset(preset);
  assert(isObject(doc) && Array.isArray(doc.layers), 'Invalid document');
  const document = clone(doc);
  const selectedIndex = document.layers.findIndex(layer => layer.id === selectedId);
  assert(selectedIndex >= 0, 'Selected layer was not found');
  const selectedLayer = document.layers[selectedIndex];

  if (isImageMaskLayer(presetData.layer)) {
    const imageLayer = clone(presetData.layer);
    if (isImageMaskLayer(selectedLayer)) {
      imageLayer.id = selectedLayer.id;
      imageLayer.visible = selectedLayer.visible;
      document.layers[selectedIndex] = imageLayer;
      return { document, selectedId: selectedLayer.id };
    }
    assert(document.layers.length < 16, 'Document cannot contain more than 16 layers');
    assert(safeId(newId), 'Invalid new image layer id');
    assert(!document.layers.some(layer => layer.id === newId), 'Duplicate image layer id');
    imageLayer.id = newId;
    document.layers.push(imageLayer);
    return { document, selectedId: newId };
  }

  const targetIndex = isImageMaskLayer(selectedLayer)
    ? document.layers.findIndex(layer => !isImageMaskLayer(layer))
    : selectedIndex;
  assert(targetIndex >= 0, 'Document must contain a pattern layer');
  const target = document.layers[targetIndex];
  const nextLayer = switchLayerPattern(target, presetData.layer.type);
  nextLayer.imageSource = target.imageSource ?? 'auto';
  for (const key of CURRENT_PATTERN_KEYS) nextLayer[key] = clone(presetData.layer[key]);
  nextLayer.id = target.id;
  nextLayer.visible = target.visible;
  document.layers[targetIndex] = nextLayer;
  return { document, selectedId: target.id };
}
