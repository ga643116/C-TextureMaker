/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const DATABASE_NAME = 'c-texturemaker';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'records';
const LEGACY_KEYS = { autosave: 'ctm.autosave', presets: 'ctm.presets' };

function localStorageOrNull() {
  try { return globalThis.localStorage; } catch { return null; }
}

function openIndexedDb(indexedDB) {
  if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    const timer = setTimeout(() => finish(reject, new Error('IndexedDB open timed out')), 10000);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) database.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => {
      if (settled) request.result.close();
      else finish(resolve, createDatabaseAdapter(request.result));
    };
    request.onerror = () => finish(reject, request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => finish(reject, new Error('IndexedDB open was blocked'));
  });
}

function createDatabaseAdapter(database) {
  return {
    get(key) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE).get(key);
        let value;
        request.onsuccess = () => { value = request.result; };
        request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB read failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB read aborted'));
      });
    },
    put(key, value) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, 'readwrite');
        transaction.objectStore(OBJECT_STORE).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
      });
    },
    putIfMissing(key, value) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, 'readwrite');
        const records = transaction.objectStore(OBJECT_STORE);
        const request = records.get(key);
        request.onsuccess = () => records.put(request.result === undefined ? value : request.result, key);
        request.onerror = () => reject(request.error || new Error('IndexedDB migration read failed'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB migration failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB migration aborted'));
      });
    }
  };
}

function readLegacy(localStorage, key, fallback) {
  try {
    const raw = localStorage?.getItem(LEGACY_KEYS[key]);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function createStorage({
  openDatabase = () => openIndexedDb(globalThis.indexedDB),
  localStorage = localStorageOrNull()
} = {}) {
  let databasePromise;
  const database = () => databasePromise ??= Promise.resolve().then(openDatabase);

  async function initialize() {
    let db;
    try { db = await database(); } catch { return false; }
    let migrated = true;
    for (const key of Object.keys(LEGACY_KEYS)) {
      let value;
      try {
        const raw = localStorage?.getItem(LEGACY_KEYS[key]);
        if (raw === null || raw === undefined) continue;
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      try {
        await db.putIfMissing(key, value);
        try { localStorage?.removeItem(LEGACY_KEYS[key]); } catch { /* The IndexedDB copy is already committed. */ }
      } catch {
        // Keep the legacy value until an IndexedDB write has committed.
        migrated = false;
      }
    }
    return migrated;
  }

  async function getRecord(key, fallback) {
    try {
      const value = await (await database()).get(key);
      if (value !== undefined) return value;
    } catch {
      // The legacy copy remains available when IndexedDB cannot be read.
    }
    return readLegacy(localStorage, key, fallback);
  }

  async function setRecord(key, value) {
    if (!LEGACY_KEYS[key]) return false;
    try {
      await (await database()).put(key, value);
      try { localStorage?.removeItem(LEGACY_KEYS[key]); } catch { /* The IndexedDB copy is already committed. */ }
      return true;
    } catch {
      return false;
    }
  }

  return { initialize, getRecord, setRecord };
}

export const persistentStorage = createStorage();
