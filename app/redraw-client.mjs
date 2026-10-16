/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { createCompositeColorSampler, resolveColorSources } from './engine.mjs';

let requestSequence = 0;
const MAX_SOURCE_EDGE = 768;
const MIN_SOURCE_EDGE = 8;
const WORKER_TIMEOUT_MS = 30000;

function sourceSize(width, height) {
  const longest = Math.max(width, height);
  const scale = Math.min(1, MAX_SOURCE_EDGE / longest);
  return {
    width: Math.max(MIN_SOURCE_EDGE, Math.round(width * scale)),
    height: Math.max(MIN_SOURCE_EDGE, Math.round(height * scale)),
  };
}

function makeSourcePixels(doc, layer) {
  const sources = resolveColorSources(doc, layer).filter(source => source.colorMap);
  if (!sources.length) throw new Error('RedrawSourceMissing');

  const sample = createCompositeColorSampler(doc, layer);
  if (typeof sample !== 'function') throw new Error('RedrawSourceMissing');

  const size = sourceSize(doc.width, doc.height);
  const rgba = new Uint8ClampedArray(size.width * size.height * 4);
  let hasColor = false;

  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const color = sample((x + 0.5) * doc.width / size.width, (y + 0.5) * doc.height / size.height);
      const offset = (y * size.width + x) * 4;
      if (!color || color.length < 4) continue;
      const alpha = Math.max(0, Math.min(255, Number(color[3]) || 0));
      rgba[offset] = Math.max(0, Math.min(255, Number(color[0]) || 0));
      rgba[offset + 1] = Math.max(0, Math.min(255, Number(color[1]) || 0));
      rgba[offset + 2] = Math.max(0, Math.min(255, Number(color[2]) || 0));
      rgba[offset + 3] = alpha;
      if (alpha > 0) hasColor = true;
    }
  }

  if (!hasColor) throw new Error('RedrawSourceEmpty');
  return { ...size, rgba };
}

function validateRedrawData(data) {
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || !Array.isArray(data.regions) || !Array.isArray(data.lines)) {
    throw new Error('RedrawWorkerInvalidReply');
  }
  if (data.regions.length > 2048) throw new Error('RedrawOutputTooComplex');

  let coordinateCount = 0;
  const countRings = rings => {
    if (!Array.isArray(rings)) throw new Error('RedrawWorkerInvalidReply');
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length % 2 || ring.some(value => !Number.isFinite(value))) throw new Error('RedrawWorkerInvalidReply');
      coordinateCount += ring.length;
      if (coordinateCount > 500000) throw new Error('RedrawOutputTooComplex');
    }
  };
  for (const region of data.regions) countRings(region?.rings);
  for (const line of data.lines) countRings(line);
  return data;
}
export async function generateRedraw(doc, layer, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
  if (!doc || !layer || layer.type !== 'redraw') throw new Error('RedrawLayerMissing');

  const { width, height, rgba } = makeSourcePixels(doc, layer);
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');

  const worker = new Worker(new URL('redraw-worker.js', document.baseURI));
  const id = `redraw-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
  const request = {
    id,
    rgba: rgba.buffer,
    width,
    height,
    detail: layer.params.detail,
    seed: Number.isFinite(Number(doc.seed)) ? Number(doc.seed) : 1,
  };

  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => finish(reject, new DOMException('Generation cancelled', 'AbortError'));
      const timeout = setTimeout(() => finish(reject, new Error('RedrawWorkerTimeout')), WORKER_TIMEOUT_MS);

      worker.onmessage = event => {
        const reply = event.data;
        if (reply?.id !== id) return;
        if (typeof reply.error === 'string' && reply.error) finish(reject, new Error(reply.error));
        else if (reply.data && typeof reply.data === 'object') { try { finish(resolve, validateRedrawData(reply.data)); } catch (error) { finish(reject, error); } }
        else finish(reject, new Error('RedrawWorkerInvalidReply'));
      };
      worker.onerror = event => finish(reject, new Error(event.message || 'RedrawWorkerFailed'));
      worker.onmessageerror = () => finish(reject, new Error('RedrawWorkerInvalidReply'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        worker.postMessage(request, [rgba.buffer]);
      } catch (error) {
        finish(reject, error);
      }
    });
  } finally {
    worker.terminate();
  }
}