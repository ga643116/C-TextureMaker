/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const MIN_CANVAS_SIZE = 128;
const MAX_CANVAS_SIZE = 4096;

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(name + ' must be a finite number');
  }
  return value;
}

function clampCanvasSize(value) {
  return Math.round(Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, value)));
}

function gcd(a, b) {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function normalizeAspectRatio(aspectRatio) {
  if (aspectRatio === null) return null;
  if (!Array.isArray(aspectRatio) || aspectRatio.length !== 2) {
    throw new TypeError('aspectRatio must be null or a two-item tuple');
  }
  const [ratioWidth, ratioHeight] = aspectRatio;
  if ([ratioWidth, ratioHeight].some(size => !Number.isInteger(size) || size < MIN_CANVAS_SIZE || size > MAX_CANVAS_SIZE)) {
    throw new RangeError('aspectRatio values must be integers from ' + MIN_CANVAS_SIZE + ' to ' + MAX_CANVAS_SIZE);
  }
  return [ratioWidth, ratioHeight];
}

export function ratioLabel(width, height) {
  for (const [name, value] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(name + ' must be a positive integer');
    }
  }
  const divisor = gcd(width, height);
  return (width / divisor) + ':' + (height / divisor);
}

export function resizeCanvas(width, height, changedAxis, value, aspectRatio = null) {
  if (changedAxis !== 'width' && changedAxis !== 'height') {
    throw new RangeError('changedAxis must be width or height');
  }
  const currentWidth = clampCanvasSize(requireFiniteNumber(width, 'width'));
  const currentHeight = clampCanvasSize(requireFiniteNumber(height, 'height'));
  const requested = requireFiniteNumber(value, 'value');
  const ratio = normalizeAspectRatio(aspectRatio);

  if (ratio === null) {
    return changedAxis === 'width'
      ? { width: clampCanvasSize(requested), height: currentHeight }
      : { width: currentWidth, height: clampCanvasSize(requested) };
  }

  const [ratioWidth, ratioHeight] = ratio;
  const editedUnits = changedAxis === 'width' ? ratioWidth : ratioHeight;
  const otherUnits = changedAxis === 'width' ? ratioHeight : ratioWidth;
  const minimum = Math.max(MIN_CANVAS_SIZE, Math.ceil(MIN_CANVAS_SIZE * editedUnits / otherUnits));
  const maximum = Math.min(MAX_CANVAS_SIZE, Math.floor(MAX_CANVAS_SIZE * editedUnits / otherUnits));
  const edited = Math.round(Math.min(maximum, Math.max(minimum, requested)));
  const other = Math.round(edited * otherUnits / editedUnits);

  return changedAxis === 'width'
    ? { width: edited, height: other }
    : { width: other, height: edited };
}
