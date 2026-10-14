/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectFiles } from '../app/project-files.mjs';

class FakeHost {
  constructor() {
    this.listeners = [];
    this.messages = [];
  }
  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listeners.push(listener);
  }
  postMessage(message) {
    this.messages.push(structuredClone(message));
  }
  reply(id, type, values = {}) {
    const event = { data: { id, type, ...values } };
    for (const listener of this.listeners) listener(event);
  }
  latest(type) {
    const message = [...this.messages].reverse().find(candidate => candidate.type === type);
    assert.ok(message, 'expected native message type ' + type);
    return message;
  }
}

const TOKEN_A = '00112233445566778899aabbccddeeff';
const TOKEN_B = 'ffeeddccbbaa99887766554433221100';
const base64 = text => Buffer.from(text, 'utf8').toString('base64');

test('first project save prompts through native host and repeat save carries only its returned token', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });
  const first = files.save({ name: 'First.ctm', text: '{"version":1}', lang: 'zh' });
  const firstRequest = host.latest('save');
  assert.equal(firstRequest.intent, 'project');
  assert.equal(firstRequest.saveAs, false);
  assert.equal(firstRequest.projectToken, undefined);
  assert.equal(firstRequest.mime, 'application/json');
  host.reply(firstRequest.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  assert.equal(await first, true);

  const repeat = files.save({ name: 'First.ctm', text: '{"version":1}' });
  const repeatRequest = host.latest('save');
  assert.equal(repeatRequest.projectToken, TOKEN_A);
  host.reply(repeatRequest.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  assert.equal(await repeat, true);
});

test('Save As uses a new returned destination for later saves', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });
  const first = files.save({ name: 'One.ctm', text: '{}' });
  let request = host.latest('save');
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  await first;

  const saveAs = files.save({ name: 'Two.ctm', text: '{"n":2}', saveAs: true });
  request = host.latest('save');
  assert.equal(request.projectToken, TOKEN_A);
  assert.equal(request.saveAs, true);
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_B });
  assert.equal(await saveAs, true);

  const repeat = files.save({ name: 'Two.ctm', text: '{"n":3}' });
  request = host.latest('save');
  assert.equal(request.projectToken, TOKEN_B);
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_B });
  await repeat;
});

test('open returns pending text and accepts its destination only after caller validation', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });
  const opening = files.open({ lang: 'ja' });
  const request = host.latest('open');
  assert.equal(request.lang, 'ja');
  host.reply(request.id, 'open-result', {
    ok: true,
    name: 'Loaded.ctm',
    projectToken: TOKEN_A,
    base64: base64('{"version":1,"name":"Loaded"}')
  });
  const opened = await opening;
  assert.deepEqual(opened, { name: 'Loaded.ctm', text: '{"version":1,"name":"Loaded"}' });
  assert.equal(Object.prototype.hasOwnProperty.call(opened, 'token'), false);

  const beforeAccept = files.save({ name: 'New.ctm', text: '{}' });
  const beforeRequest = host.latest('save');
  assert.equal(beforeRequest.projectToken, undefined);
  host.reply(beforeRequest.id, 'save-result', { ok: true, projectToken: TOKEN_B });
  await beforeAccept;

  assert.equal(files.acceptOpened(opened), true);
  const afterAccept = files.save({ name: 'Loaded.ctm', text: '{}' });
  const afterRequest = host.latest('save');
  assert.equal(afterRequest.projectToken, TOKEN_A);
  host.reply(afterRequest.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  await afterAccept;
});

test('cancellation and errors preserve the current destination', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });
  const first = files.save({ name: 'One.ctm', text: '{}' });
  let request = host.latest('save');
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  await first;

  const cancelled = files.save({ name: 'Two.ctm', text: '{}', saveAs: true });
  request = host.latest('save');
  host.reply(request.id, 'save-result', { ok: false, cancelled: true });
  assert.equal(await cancelled, false);

  const errored = files.save({ name: 'Two.ctm', text: '{}', saveAs: true });
  request = host.latest('save');
  host.reply(request.id, 'save-result', { ok: false, error: 'disk full' });
  await assert.rejects(errored, /disk full/);

  const openCancelled = files.open();
  request = host.latest('open');
  host.reply(request.id, 'open-result', { ok: false, cancelled: true });
  assert.equal(await openCancelled, null);

  const openFailed = files.open();
  request = host.latest('open');
  host.reply(request.id, 'open-result', { ok: false, error: 'read failed' });
  await assert.rejects(openFailed, /read failed/);

  const repeat = files.save({ name: 'One.ctm', text: '{}' });
  request = host.latest('save');
  assert.equal(request.projectToken, TOKEN_A);
  assert.equal(request.saveAs, false);
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  await repeat;
});

test('reset invalidates late Save As and open responses from the previous project', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });

  const first = files.save({ name: 'One.ctm', text: '{}' });
  let request = host.latest('save');
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_A });
  await first;

  const lateSaveAs = files.save({ name: 'Two.ctm', text: '{}', saveAs: true });
  const staleSave = host.latest('save');
  files.reset();
  host.reply(staleSave.id, 'save-result', { ok: true, projectToken: TOKEN_B });
  assert.equal(await lateSaveAs, false);

  const open = files.open();
  const staleOpen = host.latest('open');
  files.reset();
  host.reply(staleOpen.id, 'open-result', {
    ok: true,
    name: 'Stale.ctm',
    projectToken: TOKEN_A,
    base64: base64('{"version":1}')
  });
  const staleResult = await open;
  assert.equal(staleResult, null);
  assert.equal(files.acceptOpened(staleResult), false);

  const acceptedOpening = files.open();
  const acceptedRequest = host.latest('open');
  host.reply(acceptedRequest.id, 'open-result', {
    ok: true,
    name: 'Accepted.ctm',
    projectToken: TOKEN_A,
    base64: base64('{"version":1}')
  });
  const delayedAccept = await acceptedOpening;
  files.reset();
  assert.equal(files.acceptOpened(delayedAccept), false);

  const fresh = files.save({ name: 'Fresh.ctm', text: '{}' });
  request = host.latest('save');
  assert.equal(request.projectToken, undefined);
  host.reply(request.id, 'save-result', { ok: true, projectToken: TOKEN_B });
  await fresh;
});

test('native project operations reject overlap and external targets are symbolic and fixed', async () => {
  const host = new FakeHost();
  const files = createProjectFiles({ host });
  const opening = files.open();
  await assert.rejects(files.save({ name: 'Busy.ctm', text: '{}' }), /already in progress/);
  let request = host.latest('open');
  host.reply(request.id, 'open-result', { ok: false, cancelled: true });
  assert.equal(await opening, null);

  const external = files.openExternal('repository');
  request = host.latest('external');
  assert.equal(request.target, 'repository');
  assert.equal(request.url, undefined);
  host.reply(request.id, 'external-result', { ok: true });
  assert.equal(await external, true);
  await assert.rejects(files.openExternal('https://example.com'), /Unsupported external target/);
});

test('browser save fallback delegates to the existing download function', async () => {
  const calls = [];
  const files = createProjectFiles({
    download: async (name, mime, blob) => {
      calls.push({ name, mime, text: await blob.text() });
      return true;
    }
  });
  assert.equal(await files.save({ name: 'Fallback.ctm', text: '{"ok":true}' }), true);
  assert.deepEqual(calls, [{ name: 'Fallback.ctm', mime: 'application/json', text: '{"ok":true}' }]);
  assert.equal(await files.open(), null);
});
