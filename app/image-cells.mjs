/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const REC709_R = 0.2126;
const REC709_G = 0.7152;
const REC709_B = 0.0722;

function pixelCount(width, height) {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError('width and height must be positive safe integers');
  }
  const count = width * height;
  if (!Number.isSafeInteger(count)) throw new RangeError('image dimensions are too large');
  return count;
}

function validateField(field) {
  if (!field || typeof field !== 'object') throw new TypeError('field must be an image field');
  const count = pixelCount(field.width, field.height);
  const isByteArray = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
  if (!isByteArray(field.gray) || field.gray.length !== count) {
    throw new TypeError('field.gray must be a byte array matching the image dimensions');
  }
  if (!isByteArray(field.alpha) || field.alpha.length !== count) {
    throw new TypeError('field.alpha must be a byte array matching the image dimensions');
  }
  return count;
}

function validateThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new TypeError('threshold must be an integer from 0 to 255');
  }
  return threshold;
}

function validateBoolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function clampIndex(index, size) {
  return Math.min(size - 1, Math.max(0, index));
}

function wrapIndex(index, size) {
  return ((index % size) + size) % size;
}

function sampleChannel(data, width, height, x, y, seamless) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const fx = x - left;
  const fy = y - top;
  const x0 = seamless ? wrapIndex(left, width) : clampIndex(left, width);
  const x1 = seamless ? wrapIndex(left + 1, width) : clampIndex(left + 1, width);
  const y0 = seamless ? wrapIndex(top, height) : clampIndex(top, height);
  const y1 = seamless ? wrapIndex(top + 1, height) : clampIndex(top + 1, height);
  const topValue = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottomValue = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return topValue * (1 - fy) + bottomValue * fy;
}

function wrapped(value, period) {
  return ((value % period) + period) % period;
}

export function grayscaleImage({ width, height, data }) {
  const count = pixelCount(width, height);
  if (!(data instanceof Uint8ClampedArray) || data.length !== count * 4) {
    throw new TypeError('data must be an RGBA Uint8ClampedArray matching the image dimensions');
  }

  const gray = new Uint8Array(count);
  const alpha = new Uint8Array(count);
  for (let pixel = 0, offset = 0; pixel < count; pixel++, offset += 4) {
    const opacity = data[offset + 3] / 255;
    const luminance = REC709_R * data[offset] + REC709_G * data[offset + 1] + REC709_B * data[offset + 2];
    gray[pixel] = Math.round(luminance * opacity + 255 * (1 - opacity));
    alpha[pixel] = data[offset + 3];
  }
  return { width, height, gray, alpha };
}

export function autoThreshold(field) {
  const count = validateField(field);
  const histogram = new Uint32Array(256);
  let included = 0;
  for (let i = 0; i < count; i++) {
    if (field.alpha[i] === 0) continue;
    histogram[field.gray[i]]++;
    included++;
  }
  if (included === 0) return 127;

  let totalSum = 0;
  for (let value = 0; value < histogram.length; value++) totalSum += value * histogram[value];

  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestScore = -1;
  const scores = new Float64Array(255);
  for (let threshold = 0; threshold < 255; threshold++) {
    backgroundCount += histogram[threshold];
    backgroundSum += threshold * histogram[threshold];
    const foregroundCount = included - backgroundCount;
    if (backgroundCount === 0 || foregroundCount === 0) {
      scores[threshold] = 0;
    } else {
      const difference = totalSum * backgroundCount - backgroundSum * included;
      scores[threshold] = difference * difference / (backgroundCount * foregroundCount);
    }
    if (scores[threshold] > bestScore) bestScore = scores[threshold];
  }

  // Empty histogram bins create a flat Otsu optimum. Choose the middle of its
  // widest interval so a threshold does not drift toward either endpoint.
  let bestStart = 0;
  let bestEnd = 254;
  let bestWidth = -1;
  let runStart = -1;
  const considerRun = (start, end) => {
    if (start < 0 || end < start) return;
    const runWidth = end - start;
    if (runWidth > bestWidth) {
      bestStart = start;
      bestEnd = end;
      bestWidth = runWidth;
    } else if (runWidth === bestWidth) {
      const currentCenter = (bestStart + bestEnd) / 2;
      const nextCenter = (start + end) / 2;
      if (Math.abs(nextCenter - 127) < Math.abs(currentCenter - 127)) {
        bestStart = start;
        bestEnd = end;
      }
    }
  };
  for (let threshold = 0; threshold < 255; threshold++) {
    if (scores[threshold] === bestScore) {
      if (runStart < 0) runStart = threshold;
    } else if (runStart >= 0) {
      considerRun(runStart, threshold - 1);
      runStart = -1;
    }
  }
  considerRun(runStart, 254);
  return Math.round((bestStart + bestEnd) / 2);
}

export function binaryPreview(field, { threshold = autoThreshold(field), invert = false } = {}) {
  const count = validateField(field);
  validateThreshold(threshold);
  validateBoolean(invert, 'invert');
  const preview = new Uint8ClampedArray(count * 4);
  for (let pixel = 0, offset = 0; pixel < count; pixel++, offset += 4) {
    const retained = field.alpha[pixel] > 0 && (invert ? field.gray[pixel] > threshold : field.gray[pixel] <= threshold);
    const value = retained ? 0 : 255;
    preview[offset] = value;
    preview[offset + 1] = value;
    preview[offset + 2] = value;
    preview[offset + 3] = field.alpha[pixel];
  }
  return preview;
}

export function classifyCells(field, cells, { width, height, threshold = autoThreshold(field), invert = false, seamless = false } = {}) {
  validateField(field);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError('width and height must be positive finite numbers');
  }
  validateThreshold(threshold);
  validateBoolean(invert, 'invert');
  validateBoolean(seamless, 'seamless');
  if (!Array.isArray(cells)) throw new TypeError('cells must be an array');

  for (const cell of cells) {
    if (!cell || typeof cell !== 'object' || (typeof cell.id !== 'string' && typeof cell.id !== 'number') ||
        (typeof cell.id === 'number' && !Number.isFinite(cell.id)) ||
        !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) {
      throw new TypeError('each cell must have a finite string or number id and finite x and y coordinates');
    }
  }

  const hiddenCells = [];
  const seen = new Set();
  let visibleCount = 0;
  let totalCount = 0;
  for (const cell of cells) {
    let x = cell.x;
    let y = cell.y;
    if (seamless) {
      x = wrapped(x, width);
      y = wrapped(y, height);
    } else if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }
    if (seen.has(cell.id)) continue;
    seen.add(cell.id);
    totalCount++;

    const sampleX = x * field.width / width - 0.5;
    const sampleY = y * field.height / height - 0.5;
    const alpha = sampleChannel(field.alpha, field.width, field.height, sampleX, sampleY, seamless);
    const gray = sampleChannel(field.gray, field.width, field.height, sampleX, sampleY, seamless);
    const retained = alpha > 0 && (invert ? gray > threshold : gray <= threshold);
    if (retained) visibleCount++;
    else hiddenCells.push(cell.id);
  }
  return { hiddenCells, visibleCount, totalCount };
}
