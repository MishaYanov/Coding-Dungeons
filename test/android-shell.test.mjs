import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {test} from 'node:test';
import {createAndroidBackupSaver, isAndroidShell} from '../lib/mobile/android-shell.mjs';
import {mobileBackupLimit} from '../lib/mobile/input.mjs';

const origin = 'https://appassets.androidplatform.net';
const backup = {filename:'coding-dungeons-world-3-backup.json', text:'{"heroes":[]}'};

function fixture() {
  const host = new EventTarget();
  const sent = [];
  const timers = new Map();
  let next = 0;
  host.location = {origin};
  host.crypto = {randomUUID:() => `request-${++next}`};
  const previous = () => {};
  host.dungeonsSave = {onmessage:previous, postMessage:value => sent.push(JSON.parse(value))};
  const save = createAndroidBackupSaver(host, {
    setTimer:(callback, delay) => { const id = ++next; timers.set(id, {callback, delay}); return id; },
    clearTimer:id => timers.delete(id),
  });
  const reply = (data, extra = {}) => host.dungeonsSave.onmessage?.({data:JSON.stringify(data), ...extra});
  return {host, sent, timers, previous, save, reply};
}

test('Android shell detection requires the exact reserved origin and callable save bridge', () => {
  const {host} = fixture();
  assert.equal(isAndroidShell(host), true);
  for (const value of ['https://appassets.androidplatform.net.evil.test', 'http://appassets.androidplatform.net', 'https://appassets.androidplatform.net:8443', 'null']) {
    host.location.origin = value;
    assert.equal(isAndroidShell(host), false);
  }
  host.location.origin = origin;
  host.dungeonsSave.postMessage = 'not callable';
  assert.equal(isAndroidShell(host), false);
  assert.equal(isAndroidShell({}), false);
});

test('backup export resolves only after the matching native confirmation and restores its listener', async () => {
  const f = fixture();
  let settled = false;
  const result = f.save(backup).then(status => { settled = true; return status; });
  assert.deepEqual(f.sent[0], {...backup, id:'request-1', type:'save-backup'});
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal([...f.timers.values()][0].delay, 300_000);
  f.reply({id:f.sent[0].id, status:'saved'});
  assert.equal(await result, 'saved');
  assert.equal(f.host.dungeonsSave.onmessage, f.previous);
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(f.host, 'pagehide').length, 0);
});

test('foreign, malformed, mismatched, and invalid-status messages cannot confirm a save', async () => {
  const f = fixture();
  let settled = false;
  const result = f.save(backup).then(status => { settled = true; return status; });
  const message = {id:f.sent[0].id, status:'saved'};
  f.reply(message, {origin:'https://evil.test'});
  f.reply({...message, id:'older-request'});
  f.reply({...message, status:'finished'});
  f.host.dungeonsSave.onmessage({data:message});
  f.host.dungeonsSave.onmessage({data:'not JSON'});
  f.host.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(message), origin:'https://evil.test'}));
  await Promise.resolve();
  assert.equal(settled, false);
  f.reply(message);
  assert.equal(await result, 'saved');
});

test('one save can be pending and canceling allows a subsequent request without claiming success', async () => {
  const f = fixture();
  const first = f.save(backup);
  await assert.rejects(f.save(backup), /already in progress/);
  await assert.rejects(createAndroidBackupSaver(f.host)(backup), /already in progress/);
  assert.equal(f.sent.length, 1);
  f.reply({id:f.sent[0].id, status:'canceled'});
  assert.equal(await first, 'canceled');
  const second = f.save(backup);
  f.reply({id:f.sent[0].id, status:'saved'});
  f.reply({id:f.sent[1].id, status:'saved'});
  assert.equal(await second, 'saved');
});

test('native errors and synchronous transport failures release the pending request', async () => {
  const f = fixture();
  const first = f.save(backup);
  f.reply({id:f.sent[0].id, status:'error'});
  await assert.rejects(first, /could not be saved/);
  f.host.dungeonsSave.postMessage = () => { throw new Error('bridge closed'); };
  await assert.rejects(f.save(backup), /bridge closed/);
  assert.equal(f.host.dungeonsSave.onmessage, f.previous);
  assert.equal(f.timers.size, 0);
});

test('timeout, caller cancellation, and page departure clean up pending exports', async () => {
  for (const ending of ['timeout', 'signal', 'pagehide']) {
    const f = fixture();
    const controller = new AbortController();
    const result = f.save({...backup, signal:controller.signal});
    if (ending === 'timeout') [...f.timers.values()][0].callback();
    else if (ending === 'signal') controller.abort();
    else f.host.dispatchEvent(new Event('pagehide'));
    await assert.rejects(result, ending === 'timeout' ? /timed out/ : {name:'AbortError'});
    assert.equal(f.host.dungeonsSave.onmessage, f.previous);
    assert.equal(f.timers.size, 0);
    assert.equal(getEventListeners(f.host, 'pagehide').length, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    const retry = f.save(backup);
    f.reply({id:f.sent[1].id, status:'canceled'});
    assert.equal(await retry, 'canceled');
  }
});

test('unsafe filenames, oversized UTF-8 content, wrong hosts, and pre-aborted requests never reach native code', async () => {
  const f = fixture();
  for (const filename of ['../backup.json', 'backup.json/../secret', 'backup.txt', 'a'.repeat(129) + '.json', 'a\n.json']) {
    await assert.rejects(f.save({...backup, filename}), /filename/);
  }
  await assert.rejects(f.save({...backup, text:'é'.repeat(mobileBackupLimit / 2 + 1)}), /16 MiB/);
  await assert.rejects(f.save({...backup, text:null}), /text/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.save({...backup, signal:controller.signal}), {name:'AbortError'});
  f.host.location.origin = 'https://evil.test';
  await assert.rejects(f.save(backup), /Android app/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.timers.size, 0);
});
