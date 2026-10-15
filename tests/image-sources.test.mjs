/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { Resvg } from '@resvg/resvg-js';
import {
  createCompositeColorSampler, createDocument, createGroup, createImageMaskLayer, createLayer,
  hasColorSource, imageMaskGeometry, normalizeDocument, renderSVG, resetLayerPattern,
  resolveBelowMasks, resolveColorSources, switchLayerPattern,
} from '../app/engine.mjs';
import { createImageColorSampler, encodeColorMap } from '../app/image-color.mjs';
import { applyUserPreset, createUserPreset, readPreset } from '../app/user-presets.mjs';

function imageLayer(id, pixels, { width = 1, height = 1, mode = 'color', visible = true } = {}) {
  const png = new PNG({ width, height });
  png.data.set(pixels);
  const data = new Uint8ClampedArray(pixels);
  const layer = createImageMaskLayer({
    id, name: `Image ${id}`, image: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
    imageWidth: width, imageHeight: height, mode, colorMap: encodeColorMap({ width, height, data }),
  });
  layer.visible = visible;
  return layer;
}

function documentWith(layers, width = 128, height = 128) {
  const doc = createDocument();
  doc.width = width;
  doc.height = height;
  doc.layers = layers;
  return doc;
}

function sample(doc, layer) {
  return createCompositeColorSampler(doc, layer)?.(doc.width / 2, doc.height / 2) ?? null;
}

function raster(svg) {
  return PNG.sync.read(new Resvg(svg).render().asPng());
}

test('all composites visible color layers bottom-to-top with premultiplied alpha', () => {
  const pattern = createLayer('dots', 'pattern');
  pattern.imageSource = 'all';
  const red = imageLayer('red', [255, 0, 0, 255]);
  const blue = imageLayer('blue', [0, 0, 255, 128]);
  const transparent = imageLayer('transparent', [0, 255, 0, 0]);
  const doc = documentWith([pattern, red, blue, transparent]);

  assert.deepEqual(resolveColorSources(doc, pattern).map(layer => layer.id), ['red', 'blue', 'transparent']);
  assert.deepEqual(sample(doc, pattern), [127, 0, 128, 255]);
  doc.layers = [pattern, blue, red];
  assert.deepEqual(sample(doc, pattern), [255, 0, 0, 255]);

  blue.visible = false;
  assert.deepEqual(resolveColorSources(doc, pattern).map(layer => layer.id), ['red']);
  assert.deepEqual(sample(doc, pattern), [255, 0, 0, 255]);
});

test('all includes raw image layers as sampling sources', () => {
  const pattern = createLayer('dots', 'sample-all');
  pattern.imageSource = 'all';
  const raw = imageLayer('raw-all', [0, 255, 0, 255], { mode: 'image' });
  const doc = documentWith([pattern, raw]);
  assert.deepEqual(resolveColorSources(doc, pattern).map(layer => layer.id), ['raw-all']);
  assert.deepEqual(sample(doc, pattern), [0, 255, 0, 255]);
});

test('below resolves one nearest base for each effect, including the same base for adjacent effects', () => {
  const base = imageLayer('shared-base', [220, 40, 60, 255], { mode: 'image' });
  const first = createLayer('dots', 'effect-first');
  const second = createLayer('grid', 'effect-second');
  first.imageSource = second.imageSource = 'below';
  const doc = documentWith([base, first, second]);

  assert.deepEqual(resolveColorSources(doc, first).map(layer => layer.id), ['shared-base']);
  assert.deepEqual(resolveColorSources(doc, second).map(layer => layer.id), ['shared-base']);
  const svg = renderSVG(doc);
  assert.match(svg, /<g id="image-color-source-effect-first"><use href="#image-source-shared-base"\/><\/g>/);
  assert.match(svg, /<g id="image-color-source-effect-second"><use href="#image-source-shared-base"\/><\/g>/);
  assert.equal(svg.split(base.image).length - 1, 1, 'the shared source image should be embedded only once');
  assert.ok(raster(svg).width > 0, 'the SVG export should rasterize');
});

test('below group masks intersect their own color source and do not mask another group effect', () => {
  const folderA = createGroup('folder-a', 'Folder A');
  const folderB = createGroup('folder-b', 'Folder B');
  const red = imageLayer('red-base', [255, 0, 0, 255], { mode: 'color' });
  const whiteMask = imageLayer('white-mask', [255, 255, 255, 255], { mode: 'mask' });
  const green = imageLayer('green-base', [0, 255, 0, 255], { mode: 'color' });
  red.parentId = whiteMask.parentId = 'folder-a';
  green.parentId = 'folder-b';
  const effectA = createLayer('dots', 'effect-a');
  const effectB = createLayer('dots', 'effect-b');
  effectA.imageSource = effectB.imageSource = 'below';
  for (const effect of [effectA, effectB]) {
    effect.params.spacing = 128;
    effect.params.size = 96;
  }
  const doc = documentWith([red, whiteMask, folderA, effectA, green, folderB, effectB]);

  assert.deepEqual(resolveColorSources(doc, effectA).map(layer => layer.id), ['red-base']);
  assert.deepEqual(resolveBelowMasks(doc, effectA).map(layer => layer.id), ['white-mask']);
  assert.deepEqual(resolveBelowMasks(doc, effectB), []);
  assert.deepEqual(sample(doc, effectA), [255, 0, 0, 255]);
  assert.deepEqual(sample(doc, effectB), [0, 255, 0, 255]);
  const output = raster(renderSVG(doc));
  let hasGreen = false;
  let hasRed = false;
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const [r, g, b, a] = output.data.subarray(offset, offset + 4);
    if (a > 0 && g > r && g > b) hasGreen = true;
    if (a > 0 && r > g && r > b) hasRed = true;
  }
  assert.equal(hasGreen, true, 'the unrelated second group effect should remain visible');
  assert.equal(hasRed, false, 'the first group mask should suppress only its own effect');
});

test('below mask-only bases keep native pattern color, while hidden group bases resolve transparent', () => {
  const folder = createGroup('mask-folder', 'Mask folder');
  const mask = imageLayer('mask-only', [0, 0, 0, 255], { mode: 'mask' });
  mask.parentId = folder.id;
  const pattern = createLayer('dots', 'mask-only-effect');
  pattern.imageSource = 'below';
  pattern.params.spacing = 128;
  pattern.params.size = 96;
  const doc = documentWith([mask, folder, pattern]);
  assert.deepEqual(resolveColorSources(doc, pattern), []);
  assert.equal(hasColorSource(doc, pattern), false);
  assert.equal(createCompositeColorSampler(doc, pattern), null);
  const native = raster(renderSVG(doc));
  assert.ok(native.data.some((value, index) => index % 4 === 3 && value > 0), 'mask-only sources should preserve the pattern color render');

  folder.visible = false;
  assert.deepEqual(resolveColorSources(doc, pattern), []);
  assert.equal(hasColorSource(doc, pattern), true, 'a hidden configured base remains an intentional transparent source');
  assert.deepEqual(sample(doc, pattern), [0, 0, 0, 0]);
  assert.equal(renderSVG(doc).includes(mask.image), false, 'hidden group masks should not be emitted into the export');
});

test('auto, none and explicit image selection preserve source scope per pattern', () => {
  const red = imageLayer('red-source', [255, 0, 0, 255]);
  const blue = imageLayer('blue-source', [0, 0, 255, 255]);
  const automatic = createLayer('dots', 'automatic');
  automatic.imageSource = 'auto';
  const explicitRed = createLayer('grid', 'explicit-red');
  explicitRed.imageSource = 'red-source';
  const explicitBlue = createLayer('contour', 'explicit-blue');
  explicitBlue.imageSource = 'blue-source';
  const explicitAgain = createLayer('polygons', 'explicit-red-again');
  explicitAgain.imageSource = 'red-source';
  const raw = imageLayer('raw-source', [0, 255, 0, 255], { mode: 'image' });
  const explicitImage = createLayer('halftone', 'explicit-image');
  explicitImage.imageSource = 'raw-source';
  const none = createLayer('halftone', 'no-image');
  none.imageSource = 'none';
  const doc = documentWith([automatic, explicitRed, explicitBlue, explicitAgain, explicitImage, none, red, blue, raw]);

  assert.deepEqual(resolveColorSources(doc, automatic).map(layer => layer.id), ['blue-source']);
  assert.deepEqual(sample(doc, explicitRed), [255, 0, 0, 255]);
  assert.deepEqual(sample(doc, explicitBlue), [0, 0, 255, 255]);
  assert.deepEqual(sample(doc, explicitImage), [0, 255, 0, 255]);
  assert.deepEqual(resolveColorSources(doc, explicitImage).map(layer => layer.id), ['raw-source']);
  assert.equal(hasColorSource(doc, none), false);
  assert.equal(createCompositeColorSampler(doc, none), null);

  const svg = renderSVG(doc);
  assert.match(svg, /<g id="image-color-source-explicit-red"><use href="#image-source-red-source"\/><\/g>/);
  assert.match(svg, /<g id="image-color-source-explicit-blue"><use href="#image-source-blue-source"\/><\/g>/);
  assert.match(svg, /<g id="image-color-source-explicit-red-again"><use href="#image-source-red-source"\/><\/g>/);
  assert.match(svg, /<g id="image-color-source-explicit-image"><use href="#image-source-raw-source"\/><\/g>/);
  assert.equal(svg.split(red.image).length - 1, 1, 'a source reused by patterns embeds once');
  assert.equal(svg.split(blue.image).length - 1, 1, 'each source layer embeds its image once');
  assert.equal(svg.split(raw.image).length - 1, 1, 'a raw image reused for sampling and display embeds once');
});

test('missing and hidden selections stay transparent without falling back to pattern colors', () => {
  const pattern = createLayer('dots', 'pattern');
  pattern.color = '#00ff00';
  pattern.imageSource = 'missing-image';
  const hiddenColor = imageLayer('hidden-color', [255, 0, 0, 255], { visible: false });
  const doc = documentWith([pattern, hiddenColor]);

  assert.equal(hasColorSource(doc, pattern), true);
  assert.deepEqual(resolveColorSources(doc, pattern), []);
  assert.deepEqual(sample(doc, pattern), [0, 0, 0, 0]);
  assert.doesNotMatch(renderSVG(doc), /image-color-source-pattern"><use/);

  pattern.imageSource = 'all';
  assert.equal(hasColorSource(doc, pattern), true, 'hidden color sources still suppress own-color fallback');
  assert.deepEqual(sample(doc, pattern), [0, 0, 0, 0]);
  pattern.imageSource = 'none';
  assert.equal(hasColorSource(doc, pattern), false);
  assert.equal(createCompositeColorSampler(doc, pattern), null);

  const hiddenImage = imageLayer('hidden-image', [0, 0, 255, 255], { mode: 'image', visible: false });
  pattern.imageSource = 'hidden-image';
  doc.layers.push(hiddenImage);
  assert.equal(hasColorSource(doc, pattern), true);
  assert.deepEqual(resolveColorSources(doc, pattern), []);
  assert.deepEqual(sample(doc, pattern), [0, 0, 0, 0]);
});

test('raw image mode displays in layer order and stays outside global image masks', () => {
  const art = createLayer('dots', 'art');
  art.params.spacing = 128;
  art.params.size = 96;
  const whiteMask = imageLayer('white-mask', [255, 255, 255, 255], { mode: 'mask' });
  const photo = imageLayer('photo', [255, 0, 0, 255], { mode: 'image' });
  const doc = documentWith([art, whiteMask, photo]);
  const svg = renderSVG(doc);
  assert.match(svg, /all-image-masks/);
  assert.match(svg, /<use href="#image-source-photo"\/>/);
  assert.equal(svg.split(photo.image).length - 1, 1);
  const output = raster(svg),index = (64 * output.width + 64) * 4;
  assert.deepEqual([...output.data.subarray(index, index + 4)], [255, 0, 0, 255]);
});

test('image source defaults, legacy snapshots, reset, switching and presets preserve the right state', () => {
  const created = createLayer('dots', 'created');
  assert.equal(created.imageSource, 'all');
  assert.deepEqual(createLayer('pixel', 'pixel').params, {
    sizeMode: 'longEdge', blockSize: 8, pixelCount: 64, colorCount: 16, resample: 'average',
    colorDistance: 'oklab', dither: 'none', ditherStrength: 0.6, brightness: 0, contrast: 0,
    saturation: 0, alphaThreshold: 0.5, paletteMode: 'auto', outputSize: 'canvas',
  });

  const legacy = createLayer('pixel', 'legacy');
  delete legacy.imageSource;
  delete legacy.params.resample;
  delete legacy.params.colorDistance;
  const loaded = normalizeDocument(documentWith([legacy]));
  assert.equal(loaded.layers[0].imageSource, 'auto');
  assert.equal(loaded.layers[0].params.resample, 'bilinear');
  assert.equal(loaded.layers[0].params.colorDistance, 'rgb');

  const oldSnapshotLayer = switchLayerPattern(createLayer('dots', 'history'), 'grid');
  delete oldSnapshotLayer.patternSettings.dots.imageSource;
  const oldSnapshot = normalizeDocument(documentWith([oldSnapshotLayer])).layers[0];
  assert.equal(oldSnapshot.patternSettings.dots.imageSource, 'auto');
  assert.equal(switchLayerPattern(oldSnapshot, 'dots').imageSource, 'auto');

  const target = createLayer('dots', 'target');
  target.imageSource = 'project-image';
  const switched = switchLayerPattern(target, 'grid');
  assert.equal(switched.imageSource, 'project-image');
  assert.equal(resetLayerPattern(switched).imageSource, 'project-image');

  const sourceBase = createLayer('dots', 'preset-source');
  sourceBase.imageSource = 'other-project-image';
  const source = switchLayerPattern(sourceBase, 'grid');
  source.patternSettings.dots.imageSource = 'another-private-image';
  const presetDoc = documentWith([source]);
  const preset = createUserPreset(presetDoc, source.id, { id: 'source-preset', name: 'Source preset' });
  assert.equal(Object.hasOwn(preset.layer, 'imageSource'), false);
  assert.equal(Object.hasOwn(preset.layer.patternSettings.dots, 'imageSource'), false);
  assert.equal(readPreset(preset).layer.imageSource, 'auto');

  const targetDoc = documentWith([target]);
  const applied = applyUserPreset(targetDoc, target.id, preset);
  assert.equal(applied.document.layers[0].type, 'grid');
  assert.equal(applied.document.layers[0].imageSource, 'project-image');

  const cachedGrid = createLayer('grid', 'cached-target');
  cachedGrid.imageSource = 'cached-private-image';
  const targetWithCachedGrid = switchLayerPattern(cachedGrid, 'dots');
  targetWithCachedGrid.imageSource = 'current-project-image';
  const cachedApplied = applyUserPreset(documentWith([targetWithCachedGrid]), targetWithCachedGrid.id, preset);
  assert.equal(cachedApplied.document.layers[0].imageSource, 'current-project-image');
});

test('nearest image sampling selects a single source pixel while bilinear remains default', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  const source = imageLayer('two-pixels', [...pixels], { width: 2, height: 1 });
  const geometry = { width: 2, height: 1, cx: 1, cy: 0.5 };
  assert.deepEqual(createImageColorSampler(source, geometry, { nearest: true })(0.75, 0.5), [255, 0, 0, 255]);
  assert.deepEqual(createImageColorSampler(source, geometry)(0.75, 0.5), [191, 0, 64, 255]);
  const measured = imageMaskGeometry(source, { width: 2, height: 1 });
  assert.deepEqual([measured.width, measured.height, measured.cx, measured.cy], [2, 1, 1, 0.5]);
});
