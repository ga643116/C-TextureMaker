/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const RETRO_PALETTE = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgbHex = (r, g, b) => `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const rgbFromHex = value => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
const binKey = (r, g, b) => (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
const binKeyFromPacked = packed => binKey(Math.floor(packed / 65536), Math.floor(packed / 256) % 256, packed % 256);
const copyResult = result => ({ width: result.width, height: result.height, palette: [...result.palette], indices: result.indices.slice(), pixels: result.pixels.slice() });

function sameSignature(a, b) {
  return a.colorMap === b.colorMap && a.mapWidth === b.mapWidth && a.mapHeight === b.mapHeight &&
    a.docWidth === b.docWidth && a.docHeight === b.docHeight && a.gridWidth === b.gridWidth && a.gridHeight === b.gridHeight &&
    a.pixelCount === b.pixelCount && a.colorCount === b.colorCount && a.paletteMode === b.paletteMode &&
    a.sourceWidth === b.sourceWidth && a.sourceHeight === b.sourceHeight && a.fit === b.fit && a.scale === b.scale &&
    a.rotation === b.rotation && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.flipX === b.flipX && a.flipY === b.flipY &&
    a.geometryWidth === b.geometryWidth && a.geometryHeight === b.geometryHeight && a.geometryCx === b.geometryCx && a.geometryCy === b.geometryCy &&
    a.color === b.color && a.secondary === b.secondary && a.customPalette.length === b.customPalette.length &&
    a.customPalette.every((color, index) => color === b.customPalette[index]);
}

function colorStats(samples) {
  const stats = new Map();
  for (const packed of samples) {
    if (packed < 0) continue;
    const r = Math.floor(packed / 65536), g = Math.floor(packed / 256) % 256, b = packed % 256;
    const key = binKey(r, g, b);
    let item = stats.get(key);
    if (!item) { item = { key, count: 0, rSum: 0, gSum: 0, bSum: 0 }; stats.set(key, item); }
    item.count++;
    item.rSum += r;
    item.gSum += g;
    item.bSum += b;
  }
  for (const item of stats.values()) {
    item.r = item.rSum / item.count;
    item.g = item.gSum / item.count;
    item.b = item.bSum / item.count;
  }
  return [...stats.values()];
}

function medianCut(points, limit) {
  if (!points.length) return { palette: [], bins: new Map() };
  const boxes = [points];
  while (boxes.length < limit) {
    let selected = -1, selectedAxis = 0, selectedScore = -1;
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      if (box.length < 2) continue;
      let minR = 256, minG = 256, minB = 256, maxR = -1, maxG = -1, maxB = -1, weight = 0;
      for (const point of box) {
        minR = Math.min(minR, point.r); maxR = Math.max(maxR, point.r);
        minG = Math.min(minG, point.g); maxG = Math.max(maxG, point.g);
        minB = Math.min(minB, point.b); maxB = Math.max(maxB, point.b);
        weight += point.count;
      }
      const ranges = [maxR - minR, maxG - minG, maxB - minB];
      let axis = 0;
      if (ranges[1] > ranges[axis]) axis = 1;
      if (ranges[2] > ranges[axis]) axis = 2;
      const score = ranges[axis] * weight;
      if (score > selectedScore) { selected = boxIndex; selectedAxis = axis; selectedScore = score; }
    }
    if (selected < 0 || selectedScore <= 0) break;
    const box = boxes[selected], channel = ['r', 'g', 'b'][selectedAxis];
    const ordered = box.slice().sort((a, b) => a[channel] - b[channel] || a.key - b.key);
    const total = ordered.reduce((sum, point) => sum + point.count, 0), halfway = total / 2;
    let accumulated = 0, split = 1;
    for (let index = 0; index < ordered.length - 1; index++) {
      accumulated += ordered[index].count;
      split = index + 1;
      if (accumulated >= halfway) break;
    }
    boxes[selected] = ordered.slice(0, split);
    boxes.push(ordered.slice(split));
  }

  const palette = [], bins = new Map(), colorIndices = new Map();
  for (const box of boxes) {
    let count = 0, r = 0, g = 0, b = 0;
    for (const point of box) { count += point.count; r += point.rSum; g += point.gSum; b += point.bSum; }
    const color = rgbHex(r / count, g / count, b / count);
    let colorIndex = colorIndices.get(color);
    if (colorIndex === undefined) { colorIndex = palette.length; palette.push(color); colorIndices.set(color, colorIndex); }
    for (const point of box) bins.set(point.key, colorIndex);
  }
  return { palette, bins };
}

function nearestPaletteBins(points, colors) {
  const choices = colors.map(rgbFromHex), bins = new Map();
  for (const point of points) {
    let best = 0, bestDistance = Infinity;
    for (let index = 0; index < choices.length; index++) {
      const [r, g, b] = choices[index], dr = point.r - r, dg = point.g - g, db = point.b - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    }
    bins.set(point.key, best);
  }
  return bins;
}

export function createPixelArtEngine({ normalizeDocument, isImageMaskLayer, imageMaskGeometry, createImageColorSampler }) {
  const cache = [];

  function canonical(doc, layer) {
    const normalized = normalizeDocument(doc);
    const selected = normalized.layers.find(candidate => candidate.id === layer?.id);
    if (!selected || isImageMaskLayer(selected) || selected.type !== 'pixel') throw new TypeError('Expected a pixel pattern layer in the document');
    return { doc: normalized, layer: selected };
  }

  function gridFor(doc, layer) {
    const count = Math.round(clamp(layer.params.pixelCount, 4, 512));
    if (doc.width >= doc.height) return { width: count, height: Math.max(1, Math.round(count * doc.height / doc.width)) };
    return { width: Math.max(1, Math.round(count * doc.width / doc.height)), height: count };
  }

  function signatureFor(doc, layer, source, geometry, grid) {
    const map = source?.colorMap ?? null;
    return {
      colorMap: map?.rgba ?? null, mapWidth: map?.width ?? 0, mapHeight: map?.height ?? 0,
      docWidth: doc.width, docHeight: doc.height, gridWidth: grid.width, gridHeight: grid.height,
      pixelCount: layer.params.pixelCount, colorCount: layer.params.colorCount, paletteMode: layer.params.paletteMode,
      sourceWidth: source?.imageWidth ?? 0, sourceHeight: source?.imageHeight ?? 0,
      fit: source?.fit ?? '', scale: source?.scale ?? 0, rotation: source?.rotation ?? 0,
      offsetX: source?.offsetX ?? 0, offsetY: source?.offsetY ?? 0, flipX: source?.flipX ?? false, flipY: source?.flipY ?? false,
      color: layer.color, secondary: layer.secondary,
      customPalette: layer.pixelPalette.slice(0, layer.params.colorCount),
      geometryWidth: geometry?.width ?? 0, geometryHeight: geometry?.height ?? 0,
      geometryCx: geometry?.cx ?? 0, geometryCy: geometry?.cy ?? 0,
    };
  }

  function compute(doc, layer) {
    const grid = gridFor(doc, layer), source = doc.layers.findLast(candidate => isImageMaskLayer(candidate) && candidate.visible && candidate.mode === 'color') ?? null;
    const geometry = source?.colorMap ? imageMaskGeometry(source, doc) : null;
    const signature = signatureFor(doc, layer, source, geometry, grid);
    const hit = cache.findIndex(entry => sameSignature(entry.signature, signature));
    if (hit >= 0) {
      const [entry] = cache.splice(hit, 1);
      cache.unshift(entry);
      return copyResult(entry.result);
    }

    const sampler = geometry ? createImageColorSampler(source, geometry) : null;
    const base = rgbFromHex(layer.color), secondary = rgbFromHex(layer.secondary);
    const samples = new Int32Array(grid.width * grid.height).fill(-1);
    for (let row = 0; row < grid.height; row++) for (let col = 0; col < grid.width; col++) {
      const index = row * grid.width + col, x = (col + .5) * doc.width / grid.width, y = (row + .5) * doc.height / grid.height;
      const rgba = sampler ? sampler(x, y) : [
        Math.round(base[0] + (secondary[0] - base[0]) * ((col + .5) / grid.width)),
        Math.round(base[1] + (secondary[1] - base[1]) * ((col + .5) / grid.width)),
        Math.round(base[2] + (secondary[2] - base[2]) * ((col + .5) / grid.width)), 255,
      ];
      if (rgba[3] >= 128) samples[index] = rgba[0] * 65536 + rgba[1] * 256 + rgba[2];
    }

    const colorCount = Math.round(clamp(layer.params.colorCount, 2, 256)), mode = layer.params.paletteMode;
    let palette = [], bins = new Map(), grayLevels = 0;
    if (mode === 'grayscale') {
      const opaque = samples.some(sample => sample >= 0);
      if (opaque) { grayLevels = colorCount; palette = Array.from({ length: grayLevels }, (_, index) => { const value = Math.round(index * 255 / (grayLevels - 1)); return rgbHex(value, value, value); }); }
    } else if (mode === 'retro') {
      palette = RETRO_PALETTE.slice(0, colorCount);
      bins = nearestPaletteBins(colorStats(samples), palette);
    } else if (mode === 'custom' && layer.pixelPalette.length) {
      palette = layer.pixelPalette.slice(0, colorCount);
      bins = nearestPaletteBins(colorStats(samples), palette);
    } else {
      const quantized = medianCut(colorStats(samples), colorCount);
      palette = quantized.palette;
      bins = quantized.bins;
    }

    const indices = new Int16Array(samples.length).fill(-1), pixels = new Uint8ClampedArray(samples.length * 4);
    for (let index = 0; index < samples.length; index++) {
      const packed = samples[index];
      if (packed < 0 || !palette.length) continue;
      let colorIndex;
      if (mode === 'grayscale') {
        const r = Math.floor(packed / 65536), g = Math.floor(packed / 256) % 256, b = packed % 256;
        const level = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * (grayLevels - 1) / 255);
        colorIndex = clamp(level, 0, palette.length - 1);
      } else colorIndex = bins.get(binKeyFromPacked(packed));
      if (colorIndex === undefined || colorIndex < 0 || colorIndex >= palette.length) continue;
      indices[index] = colorIndex;
      const [r, g, b] = rgbFromHex(palette[colorIndex]);
      const offset = index * 4; pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b; pixels[offset + 3] = 255;
    }

    const result = { width: grid.width, height: grid.height, palette, indices, pixels };
    cache.unshift({ signature, result });
    if (cache.length > 2) cache.pop();
    return copyResult(result);
  }

  function getPixelGrid(doc, layer) { const value = canonical(doc, layer); return gridFor(value.doc, value.layer); }
  function getPixelData(doc, layer) { const value = canonical(doc, layer); return compute(value.doc, value.layer); }
  function getPixelDataFromNormalized(doc, layer) { return compute(doc, layer); }

  return { getPixelGrid, getPixelData, getPixelDataFromNormalized };
}