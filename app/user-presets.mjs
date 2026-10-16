/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { canonicalizeLayers, descendantsOf, isGroupLayer, isPatternLayer } from './layer-tree.mjs';
import { createDocument, createLayer, isImageMaskLayer, normalizeDocument, switchLayerPattern } from './engine.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new TypeError(message); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);
const PRESET_KEYS = new Set(['id', 'name', 'version', 'layer', 'seed', 'width', 'height']);
const CURRENT_PATTERN_KEYS = [
  'opacity', 'color', 'secondary', 'rotation', 'scale', 'offsetX', 'offsetY',
  'params', 'pixelPalette', 'redrawData', 'redrawEdits', 'redrawPalette', 'redrawPlacement', 'hiddenCells', 'customMotif', 'motifTint', 'cellLinks', 'linkWidth', 'mask',
];

function presetName(value) {
  assert(typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Invalid preset name');
  const name = value.trim();
  assert(name.length >= 1 && name.length <= 80, 'Invalid preset name');
  return name;
}

function standaloneLayer(layer) {
  const copy = clone(layer);
  delete copy.parentId;
  return copy;
}

function validationDocument(layer, seed, width, height) {
  const standalone = standaloneLayer(layer);
  const layers = [standalone];
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
  const layer = document.layers.find(isPatternLayer);
  assert(layer, 'Legacy preset must contain a pattern layer');
  return { layer: standaloneLayer(layer), seed: document.seed, width: document.width, height: document.height };
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
  const standalone = standaloneLayer(presetData.layer);
  const layers = [standalone];
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
  let layer = document.layers.find(candidate => candidate.id === layerId);
  assert(layer, 'Preset layer was not found');
  if (isGroupLayer(layer)) {
    layer = descendantsOf(document, layer.id).find(isPatternLayer) ?? document.layers.find(isPatternLayer);
  }
  assert(layer && !isGroupLayer(layer), 'Preset layer was not found');
  const presetLayer = standaloneLayer(layer);
  delete presetLayer.imageSource;
  if (isPatternLayer(presetLayer)) presetLayer.redrawPlacement=null;
  for (const snapshot of Object.values(presetLayer.patternSettings ?? {})) { delete snapshot.imageSource; snapshot.redrawPlacement=null; }
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

function contentLayerCount(document) {
  return document.layers.filter(layer => !isGroupLayer(layer)).length;
}

function assertNewLayerId(document, id, label) {
  assert(safeId(id), 'Invalid new ' + label + ' layer id');
  assert(!document.layers.some(layer => layer.id === id), 'Duplicate ' + label + ' layer id');
}

function addPresetLayer(document, presetLayer, id, parentId, label) {
  assert(contentLayerCount(document) < 16, 'Document cannot contain more than 16 layers');
  assertNewLayerId(document, id, label);
  const layer = standaloneLayer(presetLayer);
  layer.id = id;
  if (parentId) layer.parentId = parentId;
  document.layers.push(layer);
  canonicalizeLayers(document);
  return layer;
}

export function applyUserPreset(doc, selectedId, preset, newId) {
  const presetData = readPreset(preset);
  assert(isObject(doc) && Array.isArray(doc.layers), 'Invalid document');
  const document = normalizeDocument(clone(doc));
  const selectedIndex = document.layers.findIndex(layer => layer.id === selectedId);
  assert(selectedIndex >= 0, 'Selected layer was not found');
  const selectedLayer = document.layers[selectedIndex];
  const selectedGroup = isGroupLayer(selectedLayer) ? selectedLayer : null;

  if (isImageMaskLayer(presetData.layer)) {
    if (isImageMaskLayer(selectedLayer)) {
      const imageLayer = clone(presetData.layer);
      imageLayer.id = selectedLayer.id;
      imageLayer.visible = selectedLayer.visible;
      if (selectedLayer.parentId) imageLayer.parentId = selectedLayer.parentId;
      document.layers[selectedIndex] = imageLayer;
      return { document, selectedId: selectedLayer.id };
    }
    const parentId = selectedGroup?.id ?? selectedLayer.parentId ?? null;
    const added = addPresetLayer(document, presetData.layer, newId, parentId, 'image');
    return { document, selectedId: added.id };
  }

  let target = selectedGroup
    ? descendantsOf(document, selectedGroup.id).find(isPatternLayer)
    : isPatternLayer(selectedLayer) ? selectedLayer : document.layers.find(isPatternLayer);
  if (!target && selectedGroup) {
    const added = addPresetLayer(document, presetData.layer, newId, selectedGroup.id, 'pattern');
    return { document, selectedId: added.id };
  }
  assert(target, 'Document must contain a pattern layer');
  const targetIndex = document.layers.findIndex(layer => layer.id === target.id);
  const nextLayer = switchLayerPattern(target, presetData.layer.type);
  nextLayer.imageSource = target.imageSource ?? 'auto';
  for (const key of CURRENT_PATTERN_KEYS) nextLayer[key] = clone(presetData.layer[key]);
  nextLayer.id = target.id;
  nextLayer.visible = target.visible;
  if (target.parentId) nextLayer.parentId = target.parentId;
  document.layers[targetIndex] = nextLayer;
  return { document, selectedId: target.id };
}