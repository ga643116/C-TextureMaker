/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { buildRedraw } from './shape-redraw.mjs';

export function handleRedrawMessage(message) {
  const id = message && message.id;
  try {
    if (!message || !(message.rgba instanceof ArrayBuffer)) throw new TypeError('Invalid redraw worker request');
    const { width, height, detail = 55, seed = 1924 } = message;
    const rgba = new Uint8ClampedArray(message.rgba);
    return { id, data: buildRedraw(rgba, width, height, { detail, seed }) };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { id, error: text.slice(0, 300) || 'RedrawWorkerFailed' };
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = event => self.postMessage(handleRedrawMessage(event.data));
}