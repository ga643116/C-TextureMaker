/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS,
  createDocument,
  createImageMaskLayer,
  createLayer,
  normalizeDocument,
  renderSVG,
  resetLayerPattern,
  switchLayerPattern,
} from '../app/engine.mjs';

const patternIds = PATTERNS.map(pattern => pattern.id);
const settingKeys = ['opacity','color','secondary','rotation','scale','offsetX','offsetY','params','pixelPalette','redrawData','redrawEdits','redrawPalette','redrawPlacement','hiddenCells','customMotif','motifTint','cellLinks','linkWidth','mask','imageSource'];
const png = (() => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return `data:image/png;base64,${bytes.toString('base64')}`;
})();
const clone = value => JSON.parse(JSON.stringify(value));
const takeSnapshot = layer => Object.fromEntries(settingKeys.map(key => [key, clone(layer[key])]));
const color = value => `#${(0x120000 + value * 0x101).toString(16).padStart(6, '0')}`;

function customize(layer, index) {
  const pattern = PATTERNS.find(item => item.id === layer.type);
  for (const control of pattern.controls) {
    const current = layer.params[control.key];
    if (control.type === 'range') {
      layer.params[control.key] = current === control.min ? control.max : control.min;
    } else if (control.type === 'color') {
      layer.params[control.key] = color(index + 80);
    } else if (control.type === 'toggle') {
      layer.params[control.key] = !current;
    } else {
      const alternate = control.options.find(option => option.value !== current);
      assert.ok(alternate, `${layer.type}.${control.key} has a distinct option`);
      layer.params[control.key] = alternate.value;
    }
  }
  layer.opacity = 0.25 + index * 0.02;
  layer.color = color(index + 1);
  layer.secondary = color(index + 32);
  layer.rotation = 23 + index * 7;
  layer.scale = 0.5 + index * 0.05;
  layer.offsetX = index * 3;
  layer.offsetY = -index * 4;
  layer.hiddenCells = [`0:${index + 1}`, `1:${index + 2}`];
  layer.customMotif = png;
  layer.motifTint = index % 2 === 1;
  layer.cellLinks = [{ from: '0:1', to: `0:${index + 5}` }];
  layer.linkWidth = 2 + index * 0.5;
  layer.mask = png;
}

function populatedLayer(id = 'pattern-history') {
  let layer = createLayer(patternIds[0], id);
  for (let index = 0; index < patternIds.length; index++) {
    customize(layer, index);
    if (index + 1 < patternIds.length) layer = switchLayerPattern(layer, patternIds[index + 1]);
  }
  return layer;
}

function documentWithCachedPattern(activeType = 'dots', cachedType = 'grid') {
  const document = createDocument();
  const layer = createLayer(activeType, 'cached-pattern');
  const cached = createLayer(cachedType, 'cached-template');
  customize(cached, 4);
  layer.patternSettings[cachedType] = takeSnapshot(cached);
  document.layers = [layer];
  return document;
}

test('all nineteen patterns restore their independent full settings after switching away and back', () => {
  assert.equal(patternIds.length, 19);
  let layer = createLayer(patternIds[0], 'round-trip');
  layer.visible = false;
  const expected = new Map();

  for (let index = 0; index < patternIds.length; index++) {
    customize(layer, index);
    expected.set(layer.type, takeSnapshot(layer));
    if (index + 1 < patternIds.length) {
      const previous = layer;
      const before = JSON.stringify(previous);
      const outgoingType = layer.type;
      layer = switchLayerPattern(layer, patternIds[index + 1]);
      assert.equal(JSON.stringify(previous), before, 'switch must not mutate the previous layer');
      assert.equal(JSON.stringify(layer.patternSettings[outgoingType]), JSON.stringify(expected.get(outgoingType)));
      assert.equal(JSON.stringify(layer.patternSettings[outgoingType].params), JSON.stringify(expected.get(outgoingType).params));
      assert.equal(layer.id, 'round-trip');
      assert.equal(layer.visible, false);
    }
  }

  for (const type of patternIds) {
    layer = switchLayerPattern(layer, type);
    assert.deepEqual(takeSnapshot(layer), expected.get(type), `${type} settings should be restored`);
    assert.equal(Object.hasOwn(layer.patternSettings, layer.type), false);
    assert.equal(layer.id, 'round-trip');
    assert.equal(layer.visible, false);
  }
});

test('switching to a new pattern uses its defaults, preserves palette and visibility, and does not mutate or alias input', () => {
  const source = createLayer('dots', 'no-alias');
  customize(source, 0);
  source.visible = false;
  const before = JSON.stringify(source);
  assert.strictEqual(switchLayerPattern(source, source.type), source, 'same-pattern switch is an exact no-op');

  const first = switchLayerPattern(source, 'grid');
  assert.equal(JSON.stringify(source), before);
  assert.notStrictEqual(first, source);
  assert.equal(first.id, source.id);
  assert.equal(first.visible, false);
  assert.equal(first.color, source.color);
  assert.equal(first.secondary, source.secondary);
  assert.equal(first.opacity, source.opacity);
  assert.equal(first.rotation, 0);
  assert.equal(first.scale, 1);
  assert.equal(first.offsetX, 0);
  assert.equal(first.offsetY, 0);
  assert.deepEqual(first.hiddenCells, []);
  assert.deepEqual(first.params, PATTERNS.find(pattern => pattern.id === 'grid').defaults);
  first.patternSettings.dots.params.spacing = 17;
  assert.notEqual(source.params.spacing, 17, 'switch cache must not alias the original layer');

  const restored = switchLayerPattern(first, 'dots');
  const cachedSpacing = first.patternSettings.dots.params.spacing;
  restored.params.spacing = cachedSpacing + 1;
  assert.equal(first.patternSettings.dots.params.spacing, cachedSpacing, 'restored active params must not alias the cached snapshot');
});

test('reset restores only the active pattern defaults and preserves visibility, palette, and other cached patterns', () => {
  let layer = createLayer('dots', 'reset-layer');
  customize(layer, 2);
  layer.visible = false;
  layer = switchLayerPattern(layer, 'grid');
  customize(layer, 5);
  layer = switchLayerPattern(layer, 'dots');
  const cachedGrid = clone(layer.patternSettings.grid);
  const reset = resetLayerPattern(layer);

  assert.notStrictEqual(reset, layer);
  assert.equal(reset.id, layer.id);
  assert.equal(reset.visible, false);
  assert.equal(reset.color, layer.color);
  assert.equal(reset.secondary, layer.secondary);
  assert.equal(reset.opacity, 1);
  assert.equal(reset.rotation, 0);
  assert.equal(reset.scale, 1);
  assert.equal(reset.offsetX, 0);
  assert.equal(reset.offsetY, 0);
  assert.deepEqual(reset.params, PATTERNS.find(pattern => pattern.id === 'dots').defaults);
  assert.deepEqual(reset.hiddenCells, []);
  assert.equal(reset.customMotif, null);
  assert.equal(reset.motifTint, false);
  assert.deepEqual(reset.cellLinks, []);
  assert.equal(reset.linkWidth, 2);
  assert.equal(reset.mask, null);
  assert.deepEqual(reset.patternSettings.grid, cachedGrid);
  reset.patternSettings.grid.params.cellSize = 19;
  assert.notEqual(layer.patternSettings.grid.params.cellSize, 19, 'reset cache must be an independent copy');
});

test('pattern snapshots survive JSON document normalization, legacy v1 files, and render only the active layer', () => {
  const document = createDocument();
  document.width = 256;
  document.height = 256;
  document.layers = [populatedLayer('persisted-layer')];
  const raw = JSON.parse(JSON.stringify(document));
  const normalized = normalizeDocument(raw);
  assert.equal(Object.keys(normalized.layers[0].patternSettings).length, patternIds.length - 1);
  assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.deepEqual(Object.keys(normalized.layers[0].patternSettings).sort(), patternIds.filter(type => type !== normalized.layers[0].type).sort());
  raw.layers[0].patternSettings.concentric.params.count = -1;
  assert.notEqual(normalized.layers[0].patternSettings.concentric.params.count, -1, 'normalization must not alias input snapshots');

  const svg = renderSVG(normalized, { preview: true, repeat: 3 });
  assert.equal((svg.match(/id="source-persisted-layer"/g) ?? []).length, 1);

  const legacy = JSON.parse(JSON.stringify(createDocument()));
  delete legacy.layers[0].patternSettings;
  assert.deepEqual(normalizeDocument(legacy).layers[0].patternSettings, {}, 'old v1 files receive an empty history');

  const imageMask = createImageMaskLayer({ id: 'mask-layer', image: png, imageWidth: 1, imageHeight: 1 });
  const mixed = createDocument();
  mixed.layers = [createLayer('dots', 'pattern-layer'), imageMask];
  const normalizedMixed = normalizeDocument(mixed);
  assert.equal(Object.hasOwn(normalizedMixed.layers[1], 'patternSettings'), false, 'image mask layers keep their existing schema');
});

test('layer histories and JSON-cloned duplicate layers remain independent', () => {
  let first = createLayer('dots', 'first-layer');
  let second = createLayer('dots', 'second-layer');
  first = switchLayerPattern(first, 'grid');
  second = switchLayerPattern(second, 'grid');
  first.patternSettings.dots.params.spacing = 19;
  assert.notEqual(second.patternSettings.dots.params.spacing, 19);

  const duplicate = clone(first);
  duplicate.id = 'duplicate-layer';
  duplicate.patternSettings.dots.params.spacing = 27;
  assert.equal(first.patternSettings.dots.params.spacing, 19);
  assert.notEqual(duplicate.patternSettings.dots.params.spacing, first.patternSettings.dots.params.spacing);
});

test('normalization rejects invalid cached pattern types, fields, params, and unsafe data', () => {
  const unknownType = documentWithCachedPattern();
  unknownType.layers[0].patternSettings.unknown = clone(unknownType.layers[0].patternSettings.grid);
  assert.throws(() => normalizeDocument(unknownType), /Unknown cached pattern type/);

  const activeType = documentWithCachedPattern();
  activeType.layers[0].patternSettings.dots = clone(activeType.layers[0].patternSettings.grid);
  assert.throws(() => normalizeDocument(activeType), /Active pattern cannot be cached/);

  for (const field of ['id','type','visible','patternSettings','unknown']) {
    const invalid = documentWithCachedPattern();
    invalid.layers[0].patternSettings.grid[field] = field === 'patternSettings' ? {} : true;
    assert.throws(() => normalizeDocument(invalid), /Unknown pattern snapshot field/, `${field} must not enter a snapshot`);
  }

  const incomplete = documentWithCachedPattern();
  delete incomplete.layers[0].patternSettings.grid.opacity;
  assert.throws(() => normalizeDocument(incomplete), /Missing pattern snapshot field: opacity/);

  const invalidParams = documentWithCachedPattern();
  invalidParams.layers[0].patternSettings.grid.params.injected = 1;
  assert.throws(() => normalizeDocument(invalidParams), /Unknown grid parameter/);

  const unsafeSvg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
  const unsafeMotif = documentWithCachedPattern();
  unsafeMotif.layers[0].patternSettings.grid.customMotif = unsafeSvg;
  assert.throws(() => normalizeDocument(unsafeMotif), /Unsafe SVG/);

  const unsafeMask = documentWithCachedPattern();
  unsafeMask.layers[0].patternSettings.grid.mask = unsafeSvg;
  assert.throws(() => normalizeDocument(unsafeMask), /Unsafe SVG/);

  const unsafeLinks = documentWithCachedPattern();
  unsafeLinks.layers[0].patternSettings.grid.cellLinks = [{ from: '0:0', to: 'bad' }];
  assert.throws(() => normalizeDocument(unsafeLinks), /Invalid cell link endpoint/);
});
