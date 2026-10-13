/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../app/storage.mjs';

class MemoryLocalStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function memoryDatabase({ failWrites = false } = {}) {
  const records = new Map();
  return {
    async get(key) { return records.has(key) ? JSON.parse(JSON.stringify(records.get(key))) : undefined; },
    async put(key, value) {
      if (failWrites) throw new Error('write failed');
      records.set(key, JSON.parse(JSON.stringify(value)));
    },
    async putIfMissing(key, value) {
      if (failWrites) throw new Error('write failed');
      if (!records.has(key)) records.set(key, JSON.parse(JSON.stringify(value)));
    },
    records
  };
}

const encode = value => JSON.stringify(value);

test('legacy autosave and presets move only after their IndexedDB writes commit', async () => {
  const document = { version: 1, name: 'Saved work', layers: [] };
  const presets = [{ id: 'custom-1', name: 'Saved preset' }];
  const localStorage = new MemoryLocalStorage({
    'ctm.autosave': encode(document),
    'ctm.presets': encode(presets)
  });
  const database = memoryDatabase();
  const storage = createStorage({ openDatabase: async () => database, localStorage });

  assert.equal(await storage.initialize(), true);
  assert.deepEqual(await storage.getRecord('autosave', null), document);
  assert.deepEqual(await storage.getRecord('presets', []), presets);
  assert.equal(localStorage.getItem('ctm.autosave'), null);
  assert.equal(localStorage.getItem('ctm.presets'), null);
});

test('failed IndexedDB writes keep and return the legacy data', async () => {
  const document = { version: 1, name: 'Keep this work', layers: [] };
  const presets = [{ id: 'custom-2', name: 'Keep this preset' }];
  const localStorage = new MemoryLocalStorage({
    'ctm.autosave': encode(document),
    'ctm.presets': encode(presets)
  });
  const database = memoryDatabase({ failWrites: true });
  const storage = createStorage({ openDatabase: async () => database, localStorage });

  assert.equal(await storage.initialize(), false);
  assert.deepEqual(await storage.getRecord('autosave', null), document);
  assert.deepEqual(await storage.getRecord('presets', []), presets);
  assert.equal(await storage.setRecord('autosave', { ...document, name: 'New work' }), false);
  assert.equal(localStorage.getItem('ctm.autosave'), encode(document));
  assert.equal(localStorage.getItem('ctm.presets'), encode(presets));
});

test('unavailable IndexedDB leaves legacy data intact and reports writes as failed', async () => {
  const document = { version: 1, name: 'Offline copy', layers: [] };
  const localStorage = new MemoryLocalStorage({ 'ctm.autosave': encode(document) });
  const storage = createStorage({ openDatabase: async () => { throw new Error('unavailable'); }, localStorage });

  assert.equal(await storage.initialize(), false);
  assert.deepEqual(await storage.getRecord('autosave', null), document);
  assert.equal(await storage.setRecord('autosave', { ...document, name: 'New work' }), false);
  assert.equal(localStorage.getItem('ctm.autosave'), encode(document));
});

test('successful writes replace legacy values and remain readable', async () => {
  const previous = { version: 1, name: 'Old work', layers: [] };
  const next = { version: 1, name: 'New work', layers: [] };
  const localStorage = new MemoryLocalStorage({ 'ctm.autosave': encode(previous) });
  const database = memoryDatabase();
  const storage = createStorage({ openDatabase: async () => database, localStorage });

  assert.equal(await storage.initialize(), true);
  assert.equal(await storage.setRecord('autosave', next), true);
  assert.deepEqual(await storage.getRecord('autosave', null), next);
  assert.equal(localStorage.getItem('ctm.autosave'), null);
});

test('shape records persist independently without becoming legacy migration keys', async () => {
  const legacyShapeLike = [{ id: 'old-local', name: 'Keep local key untouched', data: 'legacy' }];
  const localStorage = new MemoryLocalStorage({
    'ctm.shapes': encode(legacyShapeLike),
    undefined: 'unrelated local value'
  });
  const database = memoryDatabase();
  const storage = createStorage({ openDatabase: async () => database, localStorage });
  const shapes = [{ id: 'shape-1', name: 'Circle', data: 'data:image/png;base64,AA==' }];

  assert.equal(await storage.initialize(), true);
  assert.deepEqual(await storage.getRecord('shapes', []), []);
  assert.equal(database.records.has('shapes'), false);
  assert.equal(localStorage.getItem('ctm.shapes'), encode(legacyShapeLike));
  assert.equal(await storage.setRecord('shapes', shapes), true);
  assert.deepEqual(await storage.getRecord('shapes', []), shapes);
  assert.equal(localStorage.getItem('ctm.shapes'), encode(legacyShapeLike));
  assert.equal(localStorage.getItem('undefined'), 'unrelated local value');
  assert.equal(await storage.setRecord('unknown', []), false);
  assert.deepEqual(await storage.getRecord('unknown', 'fallback'), 'fallback');
});

test('an unreadable shape library is not reported as empty', async () => {
  const storage = createStorage({
    openDatabase: async () => ({ async get() { throw new Error('read failed'); } }),
    localStorage: new MemoryLocalStorage()
  });
  await assert.rejects(storage.getRecord('shapes', []), /read failed/);
  assert.deepEqual(await storage.getRecord('autosave', null), null);
});
