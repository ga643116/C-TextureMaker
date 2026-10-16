/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const snapshotRoots = new WeakSet();
const snapshotShapes = new WeakMap();

const isContainer = value => value !== null && typeof value === 'object';

function assertJsonScalar(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  throw new TypeError('History snapshots support JSON values only');
}

function inspectContainer(value) {
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError('History snapshots require plain arrays');
    }

    const keys = Reflect.ownKeys(value);
    let itemCount = 0;
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('History snapshots do not support symbol keys');

      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        throw new TypeError('History snapshots require arrays with indexed values only');
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('History snapshots require enumerable data properties');
      }
      itemCount += 1;
    }

    if (itemCount !== value.length) throw new TypeError('History snapshots do not support sparse arrays');
    return { array: true, keys: null };
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('History snapshots require plain objects');
  }

  const keys = Reflect.ownKeys(value);
  const stringKeys = [];
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('History snapshots do not support symbol keys');

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('History snapshots require enumerable data properties');
    }
    stringKeys.push(key);
  }
  return { array: false, keys: stringKeys };
}

function shapeFor(value, info = null) {
  const known = snapshotShapes.get(value);
  if (known !== undefined) return known;

  const details = info ?? inspectContainer(value);
  if (details.array) return 'array:' + value.length;

  const keys = [...details.keys].sort();
  let shape = 'object:' + keys.length + ';';
  for (const key of keys) shape += key.length + ':' + key + ';';
  return shape;
}

function deepEqualJson(input, snapshot, active = new WeakSet()) {
  if (!isContainer(input)) {
    assertJsonScalar(input);
    return Object.is(input, snapshot);
  }

  const info = inspectContainer(input);
  if (!isContainer(snapshot) || Array.isArray(input) !== Array.isArray(snapshot)) return false;
  if (active.has(input)) throw new TypeError('History snapshots do not support cycles');

  active.add(input);
  try {
    if (info.array) {
      if (input.length !== snapshot.length) return false;
      for (let index = 0; index < input.length; index += 1) {
        if (!deepEqualJson(input[index], snapshot[index], active)) return false;
      }
      return true;
    }

    const snapshotKeys = Object.keys(snapshot);
    if (info.keys.length !== snapshotKeys.length) return false;
    for (const key of info.keys) {
      if (!Object.hasOwn(snapshot, key) || !deepEqualJson(input[key], snapshot[key], active)) return false;
    }
    return true;
  } finally {
    active.delete(input);
  }
}

function indexSnapshotTree(root) {
  const byShape = new Map();
  const visited = new WeakSet();
  const pending = [root];

  while (pending.length > 0) {
    const value = pending.pop();
    if (!isContainer(value) || visited.has(value)) continue;
    visited.add(value);

    const shape = shapeFor(value);
    const candidates = byShape.get(shape);
    if (candidates) candidates.push(value);
    else byShape.set(shape, [value]);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) pending.push(value[index]);
    } else {
      for (const key of Object.keys(value)) pending.push(value[key]);
    }
  }

  return byShape;
}

function cloneAndShare(value, preferred, candidates, active) {
  if (!isContainer(value)) {
    assertJsonScalar(value);
    return value;
  }

  const info = inspectContainer(value);
  if (active.has(value)) throw new TypeError('History snapshots do not support cycles');
  active.add(value);

  try {
    const shape = shapeFor(value, info);
    const matching = candidates?.get(shape) ?? [];
    const tried = new WeakSet();

    if (isContainer(preferred) && shapeFor(preferred) === shape) {
      tried.add(preferred);
      if (value === preferred || deepEqualJson(value, preferred)) return preferred;
    }

    for (const candidate of matching) {
      if (tried.has(candidate)) continue;
      tried.add(candidate);
      if (value === candidate || deepEqualJson(value, candidate)) return candidate;
    }

    if (info.array) {
      const copy = new Array(value.length);
      const previousArray = Array.isArray(preferred) ? preferred : null;
      for (let index = 0; index < value.length; index += 1) {
        const previousChild = previousArray && index < previousArray.length ? previousArray[index] : null;
        copy[index] = cloneAndShare(value[index], previousChild, candidates, active);
      }
      snapshotShapes.set(copy, shape);
      return Object.freeze(copy);
    }

    const copy = {};
    const previousObject = isContainer(preferred) && !Array.isArray(preferred) ? preferred : null;
    for (const key of info.keys) {
      const previousChild = previousObject && Object.hasOwn(previousObject, key) ? previousObject[key] : null;
      Object.defineProperty(copy, key, {
        value: cloneAndShare(value[key], previousChild, candidates, active),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    snapshotShapes.set(copy, shape);
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}

/**
 * Create a deeply frozen JSON snapshot. Only snapshots created by this module
 * are trusted as reuse sources; other previous values are ignored.
 */
export function captureHistorySnapshot(value, previous = null) {
  if (isContainer(value) && snapshotRoots.has(value)) return value;

  const trustedPrevious = isContainer(previous) && snapshotRoots.has(previous);
  const candidates = trustedPrevious ? indexSnapshotTree(previous) : new Map();
  const snapshot = cloneAndShare(value, trustedPrevious ? previous : null, candidates, new WeakSet());
  if (isContainer(snapshot)) snapshotRoots.add(snapshot);
  return snapshot;
}

function cloneJson(value, active) {
  if (!isContainer(value)) {
    assertJsonScalar(value);
    return value;
  }

  const info = inspectContainer(value);
  if (active.has(value)) throw new TypeError('History snapshots do not support cycles');
  active.add(value);

  try {
    if (info.array) {
      const copy = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        copy[index] = cloneJson(value[index], active);
      }
      return copy;
    }

    const copy = {};
    for (const key of info.keys) {
      Object.defineProperty(copy, key, {
        value: cloneJson(value[key], active),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return copy;
  } finally {
    active.delete(value);
  }
}

/** Return an independent, mutable JSON copy of a history snapshot. */
export function restoreHistorySnapshot(snapshot) {
  return cloneJson(snapshot, new WeakSet());
}
