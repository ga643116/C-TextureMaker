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
