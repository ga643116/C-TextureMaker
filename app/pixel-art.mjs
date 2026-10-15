/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Adapted algorithm portions: Tezumie/Image-to-Pixel, revision
 * 46f80e2da5eee005da5bd52938995f7ec2c798b3, especially
 * lib/core/palette/extract.js and lib/core/cpu/stages.js (palette extraction
 * and dithering). Copyright (c) 2023-2026 Tezumie; MIT License.
 * See ./vendor/image-to-pixel/LICENSE.
 */

import { oklab, paletteSpread } from './vendor/image-to-pixel/color.mjs';

const RETRO_PALETTE = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
const LUMA = [0.2126, 0.7152, 0.0722];
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = value => clamp(value, 0, 1);
const rgbHex = (r, g, b) => '#' + [r, g, b].map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('');
const rgbFromHex = value => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
const copyResult = result => ({ width: result.width, height: result.height, palette: [...result.palette], indices: result.indices.slice(), pixels: result.pixels.slice() });
function finiteParam(params, name, fallback) {
  return Number.isFinite(params?.[name]) ? params[name] : fallback;
}

function settingsFor(layer) {
  const params = layer.params ?? {};
  const paletteMode = ['auto', 'grayscale', 'retro', 'custom'].includes(params.paletteMode) ? params.paletteMode : 'auto';
  const resample = ['average', 'nearest', 'bilinear'].includes(params.resample) ? params.resample : 'bilinear';
  const colorDistance = ['oklab', 'rgb'].includes(params.colorDistance) ? params.colorDistance : 'rgb';
  const dither = ['none', 'bayer4', 'floyd-steinberg'].includes(params.dither) ? params.dither : 'none';
  const sizeMode = ['longEdge', 'width', 'block'].includes(params.sizeMode) ? params.sizeMode : 'longEdge';
  return {
    pixelCount: Math.round(clamp(finiteParam(params, 'pixelCount', 64), 4, 512)),
    colorCount: Math.round(clamp(finiteParam(params, 'colorCount', 16), 2, 256)),
    paletteMode,
    sizeMode,
    blockSize: Math.round(clamp(finiteParam(params, 'blockSize', 8), 1, 256)),
    resample,
    colorDistance,
    dither,
    ditherStrength: clamp(finiteParam(params, 'ditherStrength', 0.6), 0, 1),
    brightness: clamp(finiteParam(params, 'brightness', 0), -1, 1),
    contrast: clamp(finiteParam(params, 'contrast', 0), -1, 1),
    saturation: clamp(finiteParam(params, 'saturation', 0), -1, 1),
    alphaThreshold: clamp(finiteParam(params, 'alphaThreshold', 0.5), 0, 1),
  };
}

function gridFor(doc, settings) {
  let width, height;
  if (settings.sizeMode === 'width') {
    width = settings.pixelCount;
    height = Math.max(1, Math.round(width * doc.height / doc.width));
  } else if (settings.sizeMode === 'block') {
    width = Math.max(1, Math.round(doc.width / settings.blockSize));
    height = Math.max(1, Math.round(doc.height / settings.blockSize));
  } else if (doc.width >= doc.height) {
    width = settings.pixelCount;
    height = Math.max(1, Math.round(settings.pixelCount * doc.height / doc.width));
  } else {
    width = Math.max(1, Math.round(settings.pixelCount * doc.width / doc.height));
    height = settings.pixelCount;
  }
  const scale = Math.min(1, 1024 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function medianCut(points, limit) {
  if (!points.length) return [];
  const boxes = [points];
  while (boxes.length < limit) {
    let selected = -1, selectedAxis = 0, selectedScore = -1;
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      if (box.length < 2) continue;
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (const point of box) {
        for (let channel = 0; channel < 3; channel++) {
          lo[channel] = Math.min(lo[channel], point[channel]);
          hi[channel] = Math.max(hi[channel], point[channel]);
        }
      }
      let axis = 0;
      if (hi[1] - lo[1] > hi[axis] - lo[axis]) axis = 1;
      if (hi[2] - lo[2] > hi[axis] - lo[axis]) axis = 2;
      const score = (hi[axis] - lo[axis]) * Math.sqrt(box.length);
      if (score > selectedScore) { selected = boxIndex; selectedAxis = axis; selectedScore = score; }
    }
    if (selected < 0 || selectedScore <= 0) break;
    const ordered = boxes[selected].slice().sort((a, b) => a[selectedAxis] - b[selectedAxis]);
    const middle = ordered.length >> 1;
    boxes.splice(selected, 1, ordered.slice(0, middle), ordered.slice(middle));
  }

  let centers = boxes.map(box => mean(box));
  for (let iteration = 0; iteration < 6; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const point of points) {
      let best = 0, bestDistance = Infinity;
      for (let index = 0; index < centers.length; index++) {
        const dr = point[0] - centers[index][0], dg = point[1] - centers[index][1], db = point[2] - centers[index][2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) { best = index; bestDistance = distance; }
      }
      const sum = sums[best];
      sum[0] += point[0]; sum[1] += point[1]; sum[2] += point[2]; sum[3]++;
    }
    centers = centers.map((center, index) => {
      const sum = sums[index];
      return sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : center;
    });
  }

  const colors = [...new Set(centers.map(center => rgbHex(center[0], center[1], center[2])))];
  const luminance = hex => {
    const [r, g, b] = rgbFromHex(hex);
    return LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  };
  return colors.sort((a, b) => luminance(a) - luminance(b));
}

function mean(points) {
  let r = 0, g = 0, b = 0;
  for (const point of points) { r += point[0]; g += point[1]; b += point[2]; }
  return [r / points.length, g / points.length, b / points.length];
}

function extractPalette(buffer, count) {
  const pixelCount = buffer.length / 4;
  const step = Math.max(1, Math.floor(pixelCount / 40000));
  const points = [];
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    if (buffer[offset + 3] < 0.5) continue;
    points.push([
      Math.round(buffer[offset] * 255),
      Math.round(buffer[offset + 1] * 255),
      Math.round(buffer[offset + 2] * 255),
    ]);
  }
  return medianCut(points, count);
}

function adjustColor(r, g, b, settings) {
  r += settings.brightness; g += settings.brightness; b += settings.brightness;
  const factor = settings.contrast >= 0 ? 1 / (1 - 0.99 * settings.contrast) : 1 + settings.contrast;
  r = (r - 0.5) * factor + 0.5;
  g = (g - 0.5) * factor + 0.5;
  b = (b - 0.5) * factor + 0.5;
  const luminance = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  const saturation = 1 + settings.saturation;
  return [
    clamp01(luminance + (r - luminance) * saturation),
    clamp01(luminance + (g - luminance) * saturation),
    clamp01(luminance + (b - luminance) * saturation),
  ];
}

function nearestFactory(palette, distance) {
  const rgb = palette.map(rgbFromHex);
  const coords = rgb.map(color => distance === 'oklab'
    ? oklab(color[0] / 255, color[1] / 255, color[2] / 255)
    : color.map(channel => channel / 255));
  return (r, g, b) => {
    const candidate = distance === 'oklab' ? oklab(r, g, b) : [r, g, b];
    let best = 0, bestDistance = Infinity;
    for (let index = 0; index < coords.length; index++) {
      const first = candidate[0] - coords[index][0];
      const second = candidate[1] - coords[index][1];
      const third = candidate[2] - coords[index][2];
      const d = distance === 'rgb'
        ? 0.299 * first * first + 0.587 * second * second + 0.114 * third * third
        : first * first + second * second + third * third;
      if (d < bestDistance) { best = index; bestDistance = d; }
    }
    return best;
  };
}

function sourceSignature(source, geometry) {
  const map = source.colorMap;
  return [
    source.id ?? '', source.type ?? '', source.mode ?? '', source.visible ?? false,
    source.imageWidth ?? 0, source.imageHeight ?? 0, source.fit ?? '', source.scale ?? 0,
    source.rotation ?? 0, source.offsetX ?? 0, source.offsetY ?? 0, source.flipX ?? false, source.flipY ?? false,
    map?.width ?? 0, map?.height ?? 0,
    geometry?.width ?? 0, geometry?.height ?? 0, geometry?.cx ?? 0, geometry?.cy ?? 0,
  ];
}

function sampleCounts(sourceInfos, doc, grid) {
  let nx = 1, ny = 1;
  const cellWidth = doc.width / grid.width, cellHeight = doc.height / grid.height;
  for (const info of sourceInfos) {
    const map = info.source.colorMap, geometry = info.geometry;
    if (!info.sampler || !map || !geometry?.width || !geometry?.height) continue;
    const angle = (info.source.rotation ?? 0) * Math.PI / 180;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const xPixels = Math.hypot(
      cellWidth * cosine * map.width / geometry.width,
      cellWidth * sine * map.height / geometry.height,
    );
    const yPixels = Math.hypot(
      cellHeight * sine * map.width / geometry.width,
      cellHeight * cosine * map.height / geometry.height,
    );
    nx = Math.max(nx, Math.min(16, Math.max(1, Math.ceil(xPixels))));
    ny = Math.max(ny, Math.min(16, Math.max(1, Math.ceil(yPixels))));
  }
  return { nx, ny };
}

function compositeAt(sourceInfos, x, y) {
  let alpha = 0, red = 0, green = 0, blue = 0;
  for (const info of sourceInfos) {
    if (!info.sampler) continue;
    const rgba = info.sampler(x, y);
    if (!rgba) continue;
    const sourceAlpha = clamp(rgba[3] / 255, 0, 1);
    const retain = 1 - sourceAlpha;
    red = rgba[0] / 255 * sourceAlpha + red * retain;
    green = rgba[1] / 255 * sourceAlpha + green * retain;
    blue = rgba[2] / 255 * sourceAlpha + blue * retain;
    alpha = sourceAlpha + alpha * retain;
  }
  return alpha > 0 ? [red / alpha, green / alpha, blue / alpha, alpha] : [0, 0, 0, 0];
}

function sampleCell(sourceInfos, hasSource, doc, grid, row, col, settings, base, secondary, counts) {
  if (!hasSource) {
    const mix = (col + 0.5) / grid.width;
    return [
      (base[0] + (secondary[0] - base[0]) * mix) / 255,
      (base[1] + (secondary[1] - base[1]) * mix) / 255,
      (base[2] + (secondary[2] - base[2]) * mix) / 255,
      1,
    ];
  }
  if (!sourceInfos.some(info => info.sampler)) return [0, 0, 0, 0];

  const centerX = (col + 0.5) * doc.width / grid.width;
  const centerY = (row + 0.5) * doc.height / grid.height;
  if (settings.resample !== 'average') return compositeAt(sourceInfos, centerX, centerY);

  let alpha = 0, red = 0, green = 0, blue = 0;
  for (let sampleY = 0; sampleY < counts.ny; sampleY++) {
    const y = (row + (sampleY + 0.5) / counts.ny) * doc.height / grid.height;
    for (let sampleX = 0; sampleX < counts.nx; sampleX++) {
      const x = (col + (sampleX + 0.5) / counts.nx) * doc.width / grid.width;
      const sample = compositeAt(sourceInfos, x, y);
      red += sample[0] * sample[3];
      green += sample[1] * sample[3];
      blue += sample[2] * sample[3];
      alpha += sample[3];
    }
  }
  const total = counts.nx * counts.ny;
  return alpha > 0
    ? [red / alpha, green / alpha, blue / alpha, alpha / total]
    : [0, 0, 0, 0];
}

function makePalette(layer, settings, buffer) {
  let hasPixels = false;
  for (let offset = 3; offset < buffer.length; offset += 4) {
    if (buffer[offset] >= 0.5) { hasPixels = true; break; }
  }
  if (!hasPixels) return [];
  if (settings.paletteMode === 'grayscale') {
    return Array.from({ length: settings.colorCount }, (_, index) => {
      const value = Math.round(index * 255 / (settings.colorCount - 1));
      return rgbHex(value, value, value);
    });
  }
  if (settings.paletteMode === 'retro') return RETRO_PALETTE.slice(0, settings.colorCount);
  if (settings.paletteMode === 'custom' && Array.isArray(layer.pixelPalette) && layer.pixelPalette.length) {
    return layer.pixelPalette.slice(0, settings.colorCount);
  }
  return extractPalette(buffer, settings.colorCount);
}

function quantize(buffer, width, height, palette, settings) {
  const indices = new Int16Array(width * height).fill(-1);
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (!palette.length) return { indices, pixels };

  const nearest = nearestFactory(palette, settings.colorDistance);
  const paletteBytes = palette.map(rgbFromHex);
  const colors = paletteBytes.map(rgb => rgb.map(channel => channel / 255));
  const ditherStrength = settings.ditherStrength;
  if (settings.dither === 'floyd-steinberg' && ditherStrength > 0) {
    const errors = new Float32Array(width * height * 3);
    const kernel = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x, offset = pixel * 4;
      if (buffer[offset + 3] < 0.5) continue;
      const color = [
        clamp01(buffer[offset] + errors[pixel * 3] * ditherStrength),
        clamp01(buffer[offset + 1] + errors[pixel * 3 + 1] * ditherStrength),
        clamp01(buffer[offset + 2] + errors[pixel * 3 + 2] * ditherStrength),
      ];
      const colorIndex = nearest(...color);
      indices[pixel] = colorIndex;
      const target = colors[colorIndex];
      for (const [dx, dy, weight] of kernel) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= width || yy >= height) continue;
        const at = (yy * width + xx) * 3;
        errors[at] += (color[0] - target[0]) * weight;
        errors[at + 1] += (color[1] - target[1]) * weight;
        errors[at + 2] += (color[2] - target[2]) * weight;
      }
    }
  } else {
    const spread = paletteSpread(paletteBytes);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x, offset = pixel * 4;
      if (buffer[offset + 3] < 0.5) continue;
      let r = buffer[offset], g = buffer[offset + 1], b = buffer[offset + 2];
      if (settings.dither === 'bayer4' && ditherStrength > 0) {
        const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
        const amount = threshold * spread * ditherStrength;
        r = clamp01(r + amount); g = clamp01(g + amount); b = clamp01(b + amount);
      }
      indices[pixel] = nearest(r, g, b);
    }
  }

  for (let pixel = 0; pixel < indices.length; pixel++) {
    const colorIndex = indices[pixel];
    if (colorIndex < 0) continue;
    const [r, g, b] = paletteBytes[colorIndex];
    const offset = pixel * 4;
    pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b; pixels[offset + 3] = 255;
  }
  return { indices, pixels };
}

export function createPixelArtEngine({
  normalizeDocument, isImageMaskLayer = layer => layer?.type === 'imageMask',
  imageMaskGeometry, createImageColorSampler, resolveColorSources, hasColorSource,
}) {
  const cache = [];
  const resolveSources = resolveColorSources;
  const hasSources = hasColorSource;

  function canonical(doc, layer) {
    const normalized = normalizeDocument(doc);
    const selected = normalized.layers.find(candidate => candidate.id === layer?.id);
    if (!selected || isImageMaskLayer(selected) || selected.type !== 'pixel') throw new TypeError('Expected a pixel pattern layer in the document');
    return { doc: normalized, layer: selected };
  }

  function prepareSources(doc, layer, settings) {
    const sources = resolveSources(doc, layer) ?? [];
    const nearest = settings.resample !== 'bilinear';
    return sources.map(source => {
      const geometry = imageMaskGeometry(source, doc);
      const sampler = createImageColorSampler(source, geometry, { nearest });
      return { source, geometry, sampler };
    });
  }

  function signatureFor(doc, layer, grid, settings, sourceInfos, sourcePresent) {
    return {
      values: JSON.stringify({
        docWidth: doc.width, docHeight: doc.height, grid,
        params: settings, color: layer.color, secondary: layer.secondary,
        palette: layer.pixelPalette ?? [], imageSource: layer.imageSource ?? 'auto',
        sourcePresent,
        sources: sourceInfos.map(info => sourceSignature(info.source, info.geometry)),
      }),
      maps: sourceInfos.map(info => info.source.colorMap?.rgba ?? null),
    };
  }

  function sameSignature(first, second) {
    return first.values === second.values && first.maps.length === second.maps.length &&
      first.maps.every((map, index) => map === second.maps[index]);
  }

  function compute(doc, layer) {
    const settings = settingsFor(layer);
    const grid = gridFor(doc, settings);
    const sourcePresent = Boolean(hasSources(doc, layer));
    const sourceInfos = prepareSources(doc, layer, settings);
    const signature = signatureFor(doc, layer, grid, settings, sourceInfos, sourcePresent);
    const hit = cache.findIndex(entry => sameSignature(entry.signature, signature));
    if (hit >= 0) {
      const [entry] = cache.splice(hit, 1);
      cache.unshift(entry);
      return copyResult(entry.result);
    }

    const counts = settings.resample === 'average' ? sampleCounts(sourceInfos, doc, grid) : { nx: 1, ny: 1 };
    const base = rgbFromHex(layer.color), secondary = rgbFromHex(layer.secondary);
    const buffer = new Float32Array(grid.width * grid.height * 4);
    for (let row = 0; row < grid.height; row++) for (let col = 0; col < grid.width; col++) {
      const offset = (row * grid.width + col) * 4;
      const rgba = sampleCell(sourceInfos, sourcePresent, doc, grid, row, col, settings, base, secondary, counts);
      const adjusted = adjustColor(rgba[0], rgba[1], rgba[2], settings);
      if (rgba[3] > 0 && rgba[3] >= settings.alphaThreshold) {
        buffer[offset] = adjusted[0];
        buffer[offset + 1] = adjusted[1];
        buffer[offset + 2] = adjusted[2];
        buffer[offset + 3] = 1;
      }
    }

    const palette = makePalette(layer, settings, buffer);
    const { indices, pixels } = quantize(buffer, grid.width, grid.height, palette, settings);
    const result = { width: grid.width, height: grid.height, palette, indices, pixels };
    cache.unshift({ signature, result });
    if (cache.length > 2) cache.pop();
    return copyResult(result);
  }

  function getPixelGrid(doc, layer) {
    const value = canonical(doc, layer);
    return gridFor(value.doc, settingsFor(value.layer));
  }
  function getPixelData(doc, layer) {
    const value = canonical(doc, layer);
    return compute(value.doc, value.layer);
  }
  function getPixelDataFromNormalized(doc, layer) { return compute(doc, layer); }

  return { getPixelGrid, getPixelData, getPixelDataFromNormalized };
}
