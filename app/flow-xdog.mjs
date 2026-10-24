/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Independent implementation of the flow-guided XDoG formulation:
// Winnemoeller et al., Computers & Graphics (2012).
// https://www.kyprianidis.com/p/cag2012/winnemoeller-cag2012.pdf
const MAX_LONG_EDGE = 1024;
const DOG_K = 1.6;
const PREPARED = new WeakMap();

function validateInput(rgba, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new TypeError('Image dimensions must be positive integers');
  }
  if (width > MAX_LONG_EDGE || height > MAX_LONG_EDGE) {
    throw new RangeError(`Image dimensions may not exceed ${MAX_LONG_EDGE} pixels per edge`);
  }
  const expected = width * height * 4;
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray) || rgba.length !== expected) {
    throw new TypeError(`RGBA data must contain exactly ${expected} bytes`);
  }
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labF(value) {
  return value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
}

function rgbaToLab(rgba, width, height) {
  const size = width * height;
  const lightness = new Float32Array(size);
  const channelA = new Float32Array(size);
  const channelB = new Float32Array(size);
  const sourceAlpha = new Float32Array(size);

  for (let i = 0, pixel = 0; i < size; i++, pixel += 4) {
    const alpha = rgba[pixel + 3] / 255;
    sourceAlpha[i] = alpha;
    const red = srgbToLinear(rgba[pixel] / 255 * alpha + 1 - alpha);
    const green = srgbToLinear(rgba[pixel + 1] / 255 * alpha + 1 - alpha);
    const blue = srgbToLinear(rgba[pixel + 2] / 255 * alpha + 1 - alpha);

    const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
    const y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue;
    const z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883;
    const fx = labF(x);
    const fy = labF(y);
    const fz = labF(z);
    lightness[i] = 116 * fy - 16;
    channelA[i] = 500 * (fx - fy);
    channelB[i] = 200 * (fy - fz);
  }

  return { lightness, channels: [lightness, channelA, channelB], sourceAlpha };
}

function reflect101(index, length) {
  if (length <= 1) return 0;
  while (index < 0 || index >= length) {
    index = index < 0 ? -index : 2 * length - 2 - index;
  }
  return index;
}

function gaussianKernel(sigma, supportSigma) {
  const radius = Math.max(1, Math.ceil(supportSigma * sigma));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel[i + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

function structureTensor(channels, width, height) {
  const size = width * height;
  let jxx = new Float32Array(size);
  let jxy = new Float32Array(size);
  let jyy = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    const ym = reflect101(y - 1, height);
    const yp = reflect101(y + 1, height);
    for (let x = 0; x < width; x++) {
      const xm = reflect101(x - 1, width);
      const xp = reflect101(x + 1, width);
      const tl = ym * width + xm;
      const tc = ym * width + x;
      const tr = ym * width + xp;
      const ml = y * width + xm;
      const mr = y * width + xp;
      const bl = yp * width + xm;
      const bc = yp * width + x;
      const br = yp * width + xp;
      let xx = 0;
      let xy = 0;
      let yy = 0;

      for (const channel of channels) {
        const gx = (-channel[tl] + channel[tr] - 2 * channel[ml] + 2 * channel[mr] - channel[bl] + channel[br]) / 8;
        const gy = (-channel[tl] - 2 * channel[tc] - channel[tr] + channel[bl] + 2 * channel[bc] + channel[br]) / 8;
        xx += gx * gx;
        xy += gx * gy;
        yy += gy * gy;
      }

      const index = y * width + x;
      jxx[index] = xx;
      jxy[index] = xy;
      jyy[index] = yy;
    }
  }

  const kernel = gaussianKernel(1.6, 2.45);
  const scratch = new Float32Array(size);
  const smooth = (input) => {
    const output = new Float32Array(size);
    const radius = (kernel.length - 1) >> 1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += kernel[k + radius] * input[row + reflect101(x + k, width)];
        }
        scratch[row + x] = sum;
      }
    }
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += kernel[k + radius] * scratch[reflect101(y + k, height) * width + x];
        }
        output[row + x] = sum;
      }
    }
    return output;
  };

  const smoothXX = smooth(jxx);
  jxx = null;
  const smoothXY = smooth(jxy);
  jxy = null;
  const smoothYY = smooth(jyy);
  jyy = null;

  const normalX = new Float32Array(size);
  const normalY = new Float32Array(size);
  const tangentX = new Float32Array(size);
  const tangentY = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const xx = smoothXX[i];
    const xy = smoothXY[i];
    const yy = smoothYY[i];
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    let nx = Math.cos(angle);
    let ny = Math.sin(angle);
    let tx = -ny;
    let ty = nx;
    const energy = xx + yy;
    const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
    if (energy < 1e-6 || discriminant / (energy + 1e-6) < 1e-4) {
      nx = 1;
      ny = 0;
      tx = 0;
      ty = 1;
    }
    normalX[i] = nx;
    normalY[i] = ny;
    tangentX[i] = tx;
    tangentY[i] = ty;
  }

  return { normalX, normalY, tangentX, tangentY };
}

function bilinearReflect(image, width, height, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ax = reflect101(x0, width);
  const bx = reflect101(x0 + 1, width);
  const ay = reflect101(y0, height);
  const by = reflect101(y0 + 1, height);
  const top = image[ay * width + ax] * (1 - fx) + image[ay * width + bx] * fx;
  const bottom = image[by * width + ax] * (1 - fx) + image[by * width + bx] * fx;
  return top * (1 - fy) + bottom * fy;
}

function bilinearClamped(image, width, height, x, y) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = image[y0 * width + x0] * (1 - fx) + image[y0 * width + x1] * fx;
  const bottom = image[y1 * width + x0] * (1 - fx) + image[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function orientedGaussian(image, normalX, normalY, sigma, width, height) {
  const radius = Math.max(0, Math.floor(2 * sigma));
  const kernel = new Float32Array(radius * 2 + 1);
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-0.5 * (offset / sigma) ** 2);
    kernel[offset + radius] = weight;
    weightSum += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= weightSum;

  const result = new Float32Array(image.length);
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = kernel[offset + radius];
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const sx = Math.fround(x + offset * normalX[i]);
        const sy = Math.fround(y + offset * normalY[i]);
        result[i] = Math.fround(result[i] + weight * bilinearReflect(image, width, height, sx, sy));
      }
    }
  }
  return result;
}

function getScaleBlurs(state, scale) {
  const key = String(scale);
  const cached = state.blurCache.get(key);
  if (cached) {
    state.blurCache.delete(key);
    state.blurCache.set(key, cached);
    return cached;
  }

  const result = {
    center: orientedGaussian(state.lightness, state.normalX, state.normalY, scale, state.width, state.height),
    surround: orientedGaussian(state.lightness, state.normalX, state.normalY, DOG_K * scale, state.width, state.height),
  };
  state.blurCache.set(key, result);
  if (state.blurCache.size > 3) state.blurCache.delete(state.blurCache.keys().next().value);
  return result;
}

function flowLicPair(center, difference, tangentX, tangentY, sigma, width, height) {
  const size = center.length;
  const radius = Math.max(0, Math.floor(2 * sigma));
  const accumulatedCenter = center.slice();
  const accumulatedDifference = difference.slice();
  const pathX = new Float32Array(size);
  const pathY = new Float32Array(size);
  const flowBufferX = [new Float32Array(size), new Float32Array(size)];
  const flowBufferY = [new Float32Array(size), new Float32Array(size)];
  let weightSum = 1;

  for (const direction of [1, -1]) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        pathX[row + x] = x;
        pathY[row + x] = y;
      }
    }

    let previousX = tangentX;
    let previousY = tangentY;
    let bufferIndex = 0;
    for (let distance = 1; distance <= radius; distance++) {
      const flowX = flowBufferX[bufferIndex];
      const flowY = flowBufferY[bufferIndex];
      const weight = Math.exp(-0.5 * (distance / sigma) ** 2);
      weightSum += weight;
      for (let i = 0; i < size; i++) {
        let vx = bilinearClamped(tangentX, width, height, pathX[i], pathY[i]);
        let vy = bilinearClamped(tangentY, width, height, pathX[i], pathY[i]);
        if (vx * previousX[i] + vy * previousY[i] < 0) {
          vx = -vx;
          vy = -vy;
        }
        const magnitude = Math.hypot(vx, vy);
        if (magnitude < 1e-6) {
          vx = previousX[i];
          vy = previousY[i];
        } else {
          vx /= magnitude;
          vy /= magnitude;
        }
        flowX[i] = vx;
        flowY[i] = vy;
        pathX[i] = Math.max(0, Math.min(width - 1, pathX[i] + direction * vx));
        pathY[i] = Math.max(0, Math.min(height - 1, pathY[i] + direction * vy));
        accumulatedCenter[i] = Math.fround(accumulatedCenter[i] + weight * bilinearClamped(center, width, height, pathX[i], pathY[i]));
        accumulatedDifference[i] = Math.fround(accumulatedDifference[i] + weight * bilinearClamped(difference, width, height, pathX[i], pathY[i]));
      }
      previousX = flowX;
      previousY = flowY;
      bufferIndex ^= 1;
    }
  }

  for (let i = 0; i < size; i++) {
    accumulatedCenter[i] /= weightSum;
    accumulatedDifference[i] /= weightSum;
  }
  return { center: accumulatedCenter, difference: accumulatedDifference };
}

function getScaleResponses(state, scale, smooth) {
  const key = `${scale}|${smooth}`;
  const cached = state.responseCache.get(key);
  if (cached) {
    state.responseCache.delete(key);
    state.responseCache.set(key, cached);
    return cached;
  }

  const { center, surround } = getScaleBlurs(state, scale);
  // LIC uses fixed flow paths and is linear in its signal: filter this p-independent basis once.
  const difference = new Float32Array(center.length);
  for (let i = 0; i < difference.length; i++) difference[i] = Math.fround(center[i] - surround[i]);
  const responses = flowLicPair(center, difference, state.tangentX, state.tangentY, smooth, state.width, state.height);
  state.responseCache.set(key, responses);
  if (state.responseCache.size > 3) state.responseCache.delete(state.responseCache.keys().next().value);
  return responses;
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/**
 * Convert RGBA bytes into a reusable, bounded-size Flow-XDoG preparation.
 * RGB is composited over white before Lab conversion; the original alpha is
 * retained as coverage and multiplies the extracted line opacity.
 */
export function prepareFlow(rgba, width, height) {
  validateInput(rgba, width, height);
  const { lightness, channels, sourceAlpha } = rgbaToLab(rgba, width, height);
  const flow = structureTensor(channels, width, height);
  const prepared = Object.freeze({ width, height });
  PREPARED.set(prepared, {
    width,
    height,
    lightness,
    sourceAlpha,
    ...flow,
    blurCache: new Map(),
    responseCache: new Map(),
  });
  return prepared;
}

/** Extract continuous black-line opacity from a prepared RGBA image. */
export function extractFlow(prepared, { lineDetail = 99, lineSmooth = 2.4, lineScale = 0.8 } = {}) {
  const state = PREPARED.get(prepared);
  if (!state) throw new TypeError('Expected a value returned by prepareFlow');
  const detail = clamp(lineDetail, 49, 249, 99);
  const smooth = clamp(lineSmooth, 1.2, 3.6, 2.4);
  const scale = clamp(lineScale, 0.6, 1.2, 0.8);
  const { center, difference } = getScaleResponses(state, scale, smooth);
  const alpha = new Uint8Array(center.length);
  for (let i = 0; i < alpha.length; i++) {
    const filtered = Math.fround(center[i] + detail * difference[i]);
    const ink = filtered < 0 ? Math.max(0, Math.min(1, -Math.tanh(0.1 * filtered))) : 0;
    alpha[i] = Math.round(255 * ink * state.sourceAlpha[i]);
  }
  return alpha;
}
