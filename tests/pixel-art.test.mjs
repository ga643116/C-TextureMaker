/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { createDocument, createImageMaskLayer, createLayer, getPixelData, getPixelGrid, normalizeDocument, renderSVG, resetLayerPattern, switchLayerPattern } from '../app/engine.mjs';
import { encodeColorMap, normalizeColorMap } from '../app/image-color.mjs';
import { applyUserPreset, createUserPreset, readPreset } from '../app/user-presets.mjs';

function imageLayer(id, width, height, data, overrides = {}) {
  const png = new PNG({ width, height });
  png.data.set(data);
  return createImageMaskLayer({
    id, image: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
    imageWidth: width, imageHeight: height, mode: 'color', colorMap: encodeColorMap({ width, height, data }),
    ...overrides,
  });
}

function pixelDocument(width = 128, height = 128, layer = createLayer('pixel', 'pixel')) {
  const doc = createDocument();
  doc.width = width;
  doc.height = height;
  doc.layers = [layer];
  return doc;
}

function solidData(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  return data;
}

function quadrantImage() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const color = colors[(y >= 2 ? 2 : 0) + (x >= 2 ? 1 : 0)], offset = (y * 4 + x) * 4;
    data.set([...color, 255], offset);
  }
  return data;
}

function rowColors(data, row = 0) {
  return Array.from({ length: data.width }, (_, col) => {
    const index = data.indices[row * data.width + col];
    return index < 0 ? null : data.palette[index];
  });
}

function colorGrid() {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 4;
    data[offset] = x * 17;
    data[offset + 1] = y * 17;
    data[offset + 2] = (x * 37 + y * 17) & 255;
    data[offset + 3] = 255;
  }
  return data;
}

test('Pixel defaults, grid limits, aspect ratio, and color count limits are stable', () => {
  const layer = createLayer('pixel', 'pixel-limits');
  assert.deepEqual(layer.params, {
    sizeMode: 'longEdge', blockSize: 8, pixelCount: 64, colorCount: 16,
    resample: 'average', colorDistance: 'oklab', dither: 'none', ditherStrength: 0.6,
    brightness: 0, contrast: 0, saturation: 0, alphaThreshold: 0.5,
    paletteMode: 'auto', outputSize: 'canvas',
  });
  assert.deepEqual(layer.pixelPalette, []);

  const doc = pixelDocument(512, 256, layer);
  layer.params.pixelCount = 64;
  assert.deepEqual(getPixelGrid(doc, layer), { width: 64, height: 32 });
  const portraitLayer = createLayer('pixel', 'pixel-width-mode');
  portraitLayer.params.sizeMode = 'width';
  portraitLayer.params.pixelCount = 140;
  assert.deepEqual(getPixelGrid(pixelDocument(640, 935, portraitLayer), portraitLayer), { width: 140, height: 205 });
  portraitLayer.params.sizeMode = 'block';
  portraitLayer.params.blockSize = 8;
  assert.deepEqual(getPixelGrid(pixelDocument(640, 935, portraitLayer), portraitLayer), { width: 80, height: 117 });
  portraitLayer.params.blockSize = 1;
  assert.deepEqual(getPixelGrid(pixelDocument(4096, 2048, portraitLayer), portraitLayer), { width: 1024, height: 512 });
  layer.params.pixelCount = 512;
  assert.deepEqual(getPixelGrid(doc, layer), { width: 512, height: 256 });
  layer.params.pixelCount = 3;
  layer.params.colorCount = 257;
  const normalized = normalizeDocument(doc);
  assert.equal(normalized.layers[0].params.pixelCount, 4);
  assert.equal(normalized.layers[0].params.colorCount, 256);

  const pixel = createLayer('pixel', 'pixel-colors');
  pixel.params.pixelCount = 16;
  const image = imageLayer('rgb-source', 16, 16, colorGrid());
  const colored = pixelDocument(128, 128, pixel);
  colored.layers.push(image);
  for (const limit of [2, 8, 256]) {
    pixel.params.colorCount = limit;
    const result = getPixelData(colored, pixel);
    assert.ok(result.palette.length <= limit);
    assert.ok(new Set(result.palette).size <= limit);
    assert.ok([...result.indices].every(index => index >= -1 && index < result.palette.length));
  }
});

test('custom palette retains duplicate swatch positions for stable editing', () => {
  const layer = createLayer('pixel', 'pixel-duplicate-swatches');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 4;
  layer.params.paletteMode = 'custom';
  layer.pixelPalette = ['#ff0000', '#ff0000', '#00ff00', '#0000ff'];
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('duplicate-source', 4, 4, quadrantImage()));
  const result = getPixelData(doc, layer);
  assert.deepEqual(result.palette, layer.pixelPalette);
  assert.equal(result.indices[0], 0);
  assert.equal(result.indices[3], 2);
});

test('median-cut output is deterministic and uses no more than the requested colors', () => {
  const layer = createLayer('pixel', 'pixel-stable');
  layer.params.pixelCount = 16;
  layer.params.colorCount = 8;
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('stable-source', 16, 16, colorGrid()));
  const first = getPixelData(doc, layer), second = getPixelData(doc, layer);
  assert.deepEqual(first.palette, second.palette);
  assert.deepEqual(first.indices, second.indices);
  assert.deepEqual(first.pixels, second.pixels);
  assert.equal(first.palette.length, 8);
});

test('alpha below 128 becomes transparent and alpha 128 becomes opaque', () => {
  const data = quadrantImage();
  data[3] = 127;
  data[7] = 128;
  const layer = createLayer('pixel', 'pixel-alpha');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 2;
  layer.params.paletteMode = 'custom';
  layer.pixelPalette = ['#ff0000'];
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('alpha-source', 4, 4, data));
  const result = getPixelData(doc, layer);
  assert.equal(result.indices[0], -1);
  assert.equal(result.pixels[3], 0);
  assert.ok(result.indices[1] >= 0);
  assert.equal(result.pixels[7], 255);
});

test('sources composite bottom-to-top and zero-alpha or missing sources remain transparent', () => {
  const layer = createLayer('pixel', 'pixel-composite');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 2;
  layer.params.resample = 'nearest';
  layer.params.colorDistance = 'rgb';
  layer.params.paletteMode = 'custom';
  layer.params.alphaThreshold = 0;
  layer.pixelPalette = ['#80007f', '#7f0080'];
  const doc = pixelDocument(4, 4, layer);
  doc.layers.push(imageLayer('composite-under', 4, 4, solidData(4, 4, [0, 0, 255, 255])));
  doc.layers.push(imageLayer('composite-top', 4, 4, solidData(4, 4, [255, 0, 0, 128])));
  const composite = getPixelData(doc, layer);
  assert.equal(composite.palette[composite.indices[0]], '#80007f');

  const transparentLayer = createLayer('pixel', 'pixel-transparent-zero-threshold');
  transparentLayer.params.pixelCount = 4;
  transparentLayer.params.paletteMode = 'custom';
  transparentLayer.params.alphaThreshold = 0;
  transparentLayer.pixelPalette = ['#ffffff'];
  const transparentDoc = pixelDocument(4, 4, transparentLayer);
  transparentDoc.layers.push(imageLayer('fully-transparent', 4, 4, solidData(4, 4, [255, 255, 255, 0])));
  const transparent = getPixelData(transparentDoc, transparentLayer);
  assert.ok([...transparent.indices].every(index => index === -1));
  assert.ok([...transparent.pixels].every((value, index) => index % 4 !== 3 || value === 0));

  transparentLayer.imageSource = 'missing-source';
  const missing = getPixelData(transparentDoc, transparentLayer);
  assert.ok([...missing.indices].every(index => index === -1), 'a selected but unavailable source must not fall back to the demo gradient');
});

test('Bayer and Floyd-Steinberg dithering create deterministic palette patterns', () => {
  const layer = createLayer('pixel', 'pixel-dither');
  layer.params.sizeMode = 'width';
  layer.params.pixelCount = 16;
  layer.params.colorCount = 2;
  layer.params.resample = 'nearest';
  layer.params.paletteMode = 'custom';
  layer.params.colorDistance = 'rgb';
  layer.pixelPalette = ['#000000', '#ffffff'];
  const doc = pixelDocument(16, 16, layer);
  doc.layers.push(imageLayer('gray-source', 16, 16, solidData(16, 16, [128, 128, 128, 255])));

  const plain = getPixelData(doc, layer);
  assert.equal(new Set(plain.indices).size, 1);
  layer.params.dither = 'bayer4';
  const ordered = getPixelData(doc, layer);
  assert.equal(new Set(ordered.indices).size, 2);
  assert.deepEqual(getPixelData(doc, layer).indices, ordered.indices);
  layer.params.dither = 'floyd-steinberg';
  const diffused = getPixelData(doc, layer);
  assert.equal(new Set(diffused.indices).size, 2);
  assert.deepEqual(getPixelData(doc, layer).indices, diffused.indices);
});

test('brightness and saturation adjust colors before palette matching', () => {
  const layer = createLayer('pixel', 'pixel-adjust');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 2;
  layer.params.resample = 'nearest';
  layer.params.colorDistance = 'rgb';
  layer.params.paletteMode = 'custom';
  layer.pixelPalette = ['#000000', '#ffffff'];
  const doc = pixelDocument(4, 4, layer);
  doc.layers.push(imageLayer('black-source', 4, 4, solidData(4, 4, [0, 0, 0, 255])));
  assert.equal(rowColors(getPixelData(doc, layer))[0], '#000000');
  layer.params.brightness = 0.6;
  assert.equal(rowColors(getPixelData(doc, layer))[0], '#ffffff');

  layer.pixelPalette = ['#202020', '#ff0000'];
  const mutedDoc = pixelDocument(4, 4, layer);
  mutedDoc.layers.push(imageLayer('muted-red-source', 4, 4, solidData(4, 4, [128, 64, 64, 255])));
  layer.params.brightness = 0;
  layer.params.saturation = 0;
  assert.equal(rowColors(getPixelData(mutedDoc, layer))[0], '#202020');
  layer.params.saturation = 1;
  assert.equal(rowColors(getPixelData(mutedDoc, layer))[0], '#ff0000');
});

test('legacy pixel settings retain bilinear resampling and RGB matching defaults', () => {
  const layer = createLayer('pixel', 'pixel-legacy-settings');
  layer.params = { pixelCount: 8, colorCount: 4, paletteMode: 'auto', outputSize: 'canvas' };
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('legacy-settings-source', 16, 16, colorGrid()));
  const normalized = normalizeDocument(doc);
  assert.equal(normalized.layers[0].params.resample, 'bilinear');
  assert.equal(normalized.layers[0].params.colorDistance, 'rgb');

  const legacy = getPixelData(doc, layer);
  layer.params.resample = 'bilinear';
  layer.params.colorDistance = 'rgb';
  assert.deepEqual(getPixelData(doc, layer), legacy);
});

test('source sampling respects contain, cover, rotation, flip, and offset transforms', () => {
  const layer = createLayer('pixel', 'pixel-transform');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 4;
  layer.params.paletteMode = 'custom';
  layer.pixelPalette = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const doc = pixelDocument(128, 128, layer);
  const source = imageLayer('transform-source', 4, 4, quadrantImage());
  doc.layers.push(source);
  assert.deepEqual(rowColors(getPixelData(doc, layer)), ['#ff0000', '#ff0000', '#00ff00', '#00ff00']);

  source.flipX = true;
  assert.deepEqual(rowColors(getPixelData(doc, layer)), ['#00ff00', '#00ff00', '#ff0000', '#ff0000']);
  source.flipX = false;
  source.rotation = 90;
  assert.deepEqual(rowColors(getPixelData(doc, layer)), ['#0000ff', '#0000ff', '#ff0000', '#ff0000']);
  source.rotation = 0;
  source.offsetX = 32;
  assert.deepEqual(rowColors(getPixelData(doc, layer)), [null, '#ff0000', '#ff0000', '#00ff00']);

  const rectangleLayer = createLayer('pixel', 'pixel-fit');
  rectangleLayer.params.pixelCount = 4;
  rectangleLayer.params.paletteMode = 'custom';
  rectangleLayer.pixelPalette = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const rectangle = pixelDocument(256, 128, rectangleLayer);
  const fitted = imageLayer('fit-source', 4, 4, quadrantImage());
  rectangle.layers.push(fitted);
  assert.equal(getPixelData(rectangle, rectangleLayer).indices[0], -1, 'contain leaves uncovered canvas transparent');
  fitted.fit = 'cover';
  assert.ok(getPixelData(rectangle, rectangleLayer).indices[0] >= 0, 'cover fills the wider canvas');
});

test('renderSVG draws quantized crisp cells and does not project the source image over Pixel', () => {
  const layer = createLayer('pixel', 'pixel-svg');
  layer.params.pixelCount = 4;
  layer.params.colorCount = 4;
  layer.params.paletteMode = 'custom';
  layer.pixelPalette = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('svg-source', 4, 4, quadrantImage()));
  const svg = renderSVG(doc);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /fill="#ff0000"/);
  assert.doesNotMatch(svg, /image-color-shape-pixel-svg|image-color-source|<image\b/);
});

test('pixelPalette reset, pattern history, legacy normalization, and user preset round trips', () => {
  const layer = createLayer('pixel', 'pixel-palette');
  layer.pixelPalette = ['#123456', '#abcdef'];
  const doc = pixelDocument(128, 128, layer);
  const preset = createUserPreset(doc, layer.id, { id: 'pixel-preset', name: 'Pixel palette' });
  const oldPreset = structuredClone(preset);
  delete oldPreset.layer.imageSource;
  assert.equal(readPreset(oldPreset).layer.imageSource, 'auto', 'older presets may omit imageSource');
  assert.deepEqual(readPreset(preset).layer.pixelPalette, ['#123456', '#abcdef']);

  const target = pixelDocument(128, 128, createLayer('dots', 'preset-target'));
  const applied = applyUserPreset(target, 'preset-target', preset);
  assert.deepEqual(applied.document.layers[0].pixelPalette, ['#123456', '#abcdef']);
  const reset = resetLayerPattern(layer);
  assert.deepEqual(reset.pixelPalette, [], 'reset clears custom pixel swatches');

  const dots = switchLayerPattern(layer, 'dots');
  assert.deepEqual(dots.patternSettings.pixel.pixelPalette, ['#123456', '#abcdef']);
  const back = switchLayerPattern(dots, 'pixel');
  assert.deepEqual(back.pixelPalette, ['#123456', '#abcdef']);

  const oldActive = createLayer('pixel', 'old-pixel');
  delete oldActive.pixelPalette;
  const legacyDoc = pixelDocument(128, 128, oldActive);
  assert.deepEqual(normalizeDocument(legacyDoc).layers[0].pixelPalette, []);

  const legacyHistory = switchLayerPattern(layer, 'dots');
  delete legacyHistory.patternSettings.pixel.pixelPalette;
  const restoredLegacy = normalizeDocument(pixelDocument(128, 128, legacyHistory));
  assert.deepEqual(restoredLegacy.layers[0].patternSettings.pixel.pixelPalette, []);
  assert.deepEqual(switchLayerPattern(restoredLegacy.layers[0], 'pixel').pixelPalette, []);
});

test('pixel results are copied on cache reads, and 1024-wide color maps validate', () => {
  const layer = createLayer('pixel', 'pixel-cache');
  layer.params.pixelCount = 16;
  layer.params.colorCount = 8;
  const doc = pixelDocument(128, 128, layer);
  doc.layers.push(imageLayer('cache-source', 16, 16, colorGrid()));
  const expected = getPixelData(doc, layer);
  const first = getPixelData(doc, layer);
  first.palette[0] = '#ffffff';
  first.indices.fill(-1);
  first.pixels.fill(0);
  const next = getPixelData(doc, layer);
  assert.deepEqual(next.palette, expected.palette);
  assert.deepEqual(next.indices, expected.indices);
  assert.deepEqual(next.pixels, expected.pixels);

  const large = encodeColorMap({ width: 1024, height: 1, data: new Uint8ClampedArray(1024 * 4) });
  assert.deepEqual(normalizeColorMap(large), large);
});
test('area averaging keeps subpixel stripes and ignores colors behind zero alpha', () => {
  const layer=createLayer('pixel','average-stripes');
  Object.assign(layer.params,{pixelCount:4,colorCount:3,paletteMode:'custom',colorDistance:'rgb',resample:'average'});
  layer.pixelPalette=['#000000','#808080','#ffffff'];
  const data=new Uint8ClampedArray(8*8*4);
  for(let i=0;i<64;i++){const value=i%2?0:255;data.set([value,value,value,255],i*4);}
  const doc=pixelDocument(128,128,layer);
  doc.layers.push(imageLayer('stripes',8,8,data));
  assert.ok(rowColors(getPixelData(doc,layer)).every(color=>color==='#808080'),'averaging retains both colors inside each cell');
  layer.params.resample='nearest';
  assert.ok(rowColors(getPixelData(doc,layer)).every(color=>color==='#000000'),'nearest samples only the center source pixel');
  for(let i=0;i<64;i++)data.set(i%2?[0,0,255,0]:[255,0,0,255],i*4);
  doc.layers[1]=imageLayer('stripes',8,8,data);
  layer.params.resample='average';layer.pixelPalette=['#ff0000','#800080'];
  assert.ok(rowColors(getPixelData(doc,layer)).every(color=>color==='#ff0000'),'transparent blue does not contaminate averaged red');
  layer.params.alphaThreshold=0.51;
  assert.ok([...getPixelData(doc,layer).indices].every(index=>index===-1),'half-covered cells respect the alpha threshold');
});
