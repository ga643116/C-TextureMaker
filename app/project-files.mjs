/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const NATIVE_TIMEOUT_MS = 600000;
const EXTERNAL_TARGETS = new Set(['repository', 'author']);
const GUID_TOKEN = /^[0-9a-f]{32}$/i;

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new Error('Base64 encoding is unavailable');
}

function decodeUtf8Base64(value) {
  let bytes;
  if (typeof atob === 'function') {
    const binary = atob(value);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } else if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(value, 'base64'));
  } else {
    throw new Error('Base64 decoding is unavailable');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function makeError(message) {
  return new Error(typeof message === 'string' && message ? message : 'Native project operation failed');
}

export function createProjectFiles({ host, download, timeoutMs = NATIVE_TIMEOUT_MS } = {}) {
  const nativeHost = host && typeof host.postMessage === 'function' && typeof host.addEventListener === 'function'
    ? host
    : null;
  if (download !== undefined && typeof download !== 'function') throw new TypeError('download must be a function');

  let projectToken = null;
  let epoch = 0;
  let requestSequence = 0;
  let activeProjectRequest = null;
  const pending = new Map();
  const openedResults = new WeakMap();

  function nextId() {
    requestSequence += 1;
    return 'project-files-' + requestSequence.toString(36);
  }

  function releaseRequest(id) {
    if (activeProjectRequest === id) activeProjectRequest = null;
  }

  function onMessage(event) {
    const reply = event && event.data;
    if (!reply || typeof reply.id !== 'string') return;
    const request = pending.get(reply.id);
    if (!request || reply.type !== request.replyType) return;

    pending.delete(reply.id);
    clearTimeout(request.timer);
    releaseRequest(reply.id);

    if (request.epoch !== null && request.epoch !== epoch) {
      request.resolve(request.kind === 'open' ? null : false);
      return;
    }
    if (!reply.ok) {
      if (reply.cancelled) request.resolve(request.kind === 'open' ? null : false);
      else request.reject(makeError(reply.error));
      return;
    }

    try {
      if (request.kind === 'save') {
        if (typeof reply.projectToken !== 'string' || !GUID_TOKEN.test(reply.projectToken)) {
          throw new Error('Native save result did not include a valid project token');
        }
        projectToken = reply.projectToken;
        request.resolve(true);
      } else if (request.kind === 'open') {
        if (typeof reply.name !== 'string' || !reply.name ||
            typeof reply.base64 !== 'string' ||
            typeof reply.projectToken !== 'string' || !GUID_TOKEN.test(reply.projectToken)) {
          throw new Error('Native open result is incomplete');
        }
        const result = Object.freeze({ name: reply.name, text: decodeUtf8Base64(reply.base64) });
        openedResults.set(result, { epoch: request.epoch, token: reply.projectToken });
        request.resolve(result);
      } else {
        request.resolve(true);
      }
    } catch (error) {
      request.reject(error);
    }
  }

  if (nativeHost) nativeHost.addEventListener('message', onMessage);

  function send(type, payload, kind, requestEpoch, exclusive) {
    if (!nativeHost) return Promise.reject(new Error('Native project host is unavailable'));
    if (exclusive && activeProjectRequest !== null) {
      return Promise.reject(new Error('A project file operation is already in progress'));
    }

    const id = nextId();
    const message = Object.assign({ type, id }, payload);
    return new Promise((resolve, reject) => {
      const request = {
        kind,
        replyType: kind === 'save' ? 'save-result' : kind === 'open' ? 'open-result' : 'external-result',
        epoch: requestEpoch,
        resolve,
        reject,
        timer: null
      };
      request.timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        releaseRequest(id);
        reject(new Error('Native project operation timed out'));
      }, timeoutMs);
      pending.set(id, request);
      if (exclusive) activeProjectRequest = id;
      try {
        nativeHost.postMessage(message);
      } catch (error) {
        clearTimeout(request.timer);
        pending.delete(id);
        releaseRequest(id);
        reject(error);
      }
    });
  }

  async function save({ name, text, lang = 'en', saveAs = false } = {}) {
    if (typeof name !== 'string' || typeof text !== 'string') throw new TypeError('name and text are required');
    const requestEpoch = epoch;

    if (!nativeHost) {
      if (typeof download !== 'function') return false;
      if (activeProjectRequest !== null) throw new Error('A project file operation is already in progress');
      const marker = nextId();
      activeProjectRequest = marker;
      try {
        if (requestEpoch !== epoch) return false;
        const blob = new Blob([text], { type: 'application/json' });
        return Boolean(await download(name, 'application/json', blob)) && requestEpoch === epoch;
      } finally {
        releaseRequest(marker);
      }
    }

    const payload = {
      name,
      mime: 'application/json',
      lang,
      intent: 'project',
      saveAs: Boolean(saveAs),
      base64: encodeBase64(text)
    };
    if (projectToken) payload.projectToken = projectToken;
    return send('save', payload, 'save', requestEpoch, true);
  }

  async function open({ lang = 'en' } = {}) {
    if (!nativeHost) return null;
    return send('open', { lang }, 'open', epoch, true);
  }

  function acceptOpened(result) {
    if (!result || typeof result !== 'object') return false;
    const opened = openedResults.get(result);
    if (!opened || opened.epoch !== epoch) return false;
    projectToken = opened.token;
    openedResults.delete(result);
    return true;
  }

  function reset() {
    epoch += 1;
    projectToken = null;
    return epoch;
  }

  function openExternal(target) {
    if (!EXTERNAL_TARGETS.has(target)) return Promise.reject(new TypeError('Unsupported external target'));
    if (!nativeHost) return Promise.resolve(false);
    return send('external', { target }, 'external', null, false);
  }

  return Object.freeze({ save, open, acceptOpened, reset, openExternal });
}
