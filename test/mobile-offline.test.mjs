import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/mobile/service-worker.js', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://dungeons.test';
const file = '/runtime/rust/compiler.wasm';
const rustCache = 'coding-dungeons-mobile-world-rust-';
const legacyVersion = '0123456789abcdef';

function worker(fetchAsset, {integrity = {[file]:digest('compiler')}, stored = new Map(),
  worlds = {rust:{number:4, version:legacyVersion, files:[file]}}, shellVersion = 'shell'} = {}) {
  const handlers = new Map();
  const fetch = async request => fetchAsset(typeof request === 'string' ? new Request(request) : request);
  const caches = {
    has:async name => stored.has(name),
    keys:async () => [...stored.keys()],
    delete:async name => stored.delete(name),
    async open(name) {
      if (!stored.has(name)) stored.set(name, new Map());
      const values = stored.get(name);
      const key = request => new URL(typeof request === 'string' ? request : request.url, origin).pathname;
      return {
        keys:async () => [...values.keys()].map(path => new Request(origin + path)),
        match:async request => values.get(key(request))?.clone(),
        put:async (request, response) => { values.set(key(request), response.clone()); },
        delete:async request => values.delete(key(request)),
        addAll:async requests => {
          for (const request of requests) {
            const response = await fetch(request);
            if (!response.ok) throw new Error('Download failed.');
            values.set(key(request), response.clone());
          }
        },
      };
    },
  };
  vm.runInNewContext(source, {Request, Response, URL, TextEncoder, Uint8Array, crypto:webcrypto, caches, fetch,
    offline:{shellVersion, shellFiles:[], integrity, worlds},
    self:{location:{origin}, clients:{claim:async () => {}}, addEventListener:(event, callback) => handlers.set(event, callback)},
  });
  async function message(type, world = 'rust') {
    let pending;
    let answer;
    handlers.get('message')({data:{type, world}, ports:[{postMessage:value => { answer = value; }}],
      waitUntil:promise => { pending = promise; }});
    await pending;
    return structuredClone(answer);
  }
  function request(path = file) {
    let pending;
    handlers.get('fetch')({request:new Request(origin + path), respondWith:promise => { pending = promise; }});
    return pending;
  }
  function lifecycle(type) {
    let pending;
    handlers.get(type)({waitUntil:promise => { pending = promise; }});
    return pending;
  }
  return {message, request, stored, lifecycle};
}

test('offline Rust downloads verify asset bytes and forbid redirects before claiming readiness', async () => {
  const valid = worker(request => {
    assert.equal(request.redirect, 'error');
    return new Response('compiler');
  });
  assert.deepEqual(await valid.message('download-world'), {ready:true});
  assert.equal(await (await valid.request()).text(), 'compiler');

  const wrong = worker(() => new Response('changed compiler'));
  assert.match((await wrong.message('download-world')).error, /could not finish downloading/);
  assert.deepEqual(await wrong.message('world-status'), {ready:false});
});

test('a corrupted runtime entry repairs only from a verified response', async () => {
  const wrong = worker(() => new Response('changed compiler'));
  await assert.rejects(wrong.request(), /integrity/i);

  let served = 'compiler';
  const valid = worker(() => new Response(served));
  assert.deepEqual(await valid.message('download-world'), {ready:true});
  valid.stored.get(rustCache + legacyVersion).set(file, new Response('changed compiler'));
  served = 'also corrupt';
  await assert.rejects(valid.request(), /integrity/i);
  assert.deepEqual(await valid.message('world-status'), {ready:false});
  served = 'compiler';
  assert.deepEqual(await valid.message('download-world'), {ready:true});
  valid.stored.get(rustCache + legacyVersion).set(file, new Response('changed compiler'));
  assert.equal(await (await valid.request()).text(), 'compiler');
  assert.equal(await valid.stored.get(rustCache + legacyVersion).get(file).clone().text(), 'compiler');
});

test('Go uses the build asset inventory when checking runtime downloads', async () => {
  const asset = '/runtime/go/compile.wasm';
  let body = 'unexpected Go compiler';
  const go = worker(() => new Response(body), {integrity:{}, worlds:{go:{number:5, version:legacyVersion,
    files:[asset], hashes:{[asset]:digest('pinned Go compiler')}}}});
  await assert.rejects(go.request(asset), /integrity/i);
  assert.match((await go.message('download-world', 'go')).error, /could not finish downloading/);
  assert.deepEqual(await go.message('world-status', 'go'), {ready:false});
  body = 'pinned Go compiler';
  assert.deepEqual(await go.message('download-world', 'go'), {ready:true});
  assert.equal(await (await go.request(asset)).text(), body);
});

test('a world revision stages only changed files before replacing a complete legacy download', async () => {
  const page = '/book/pages/1.webp';
  const other = 'coding-dungeons-mobile-world-go-fedcba9876543210';
  const nextVersion = 'fedcba9876543210';
  const stored = new Map([
    [rustCache + legacyVersion, new Map([[page,new Response('same page')], [file,new Response('old compiler')]])],
    [other, new Map([['/book/go/pages/1.webp', new Response('Go page')]])],
  ]);
  const old = worker(() => { throw new Error('Offline'); }, {stored, integrity:{[file]:digest('old compiler')},
    worlds:{rust:{number:3, version:legacyVersion, files:[page, file]}}});
  const fetches = [];
  let online = false;
  const updated = worker(request => {
    const path = new URL(request.url).pathname;
    fetches.push(path);
    assert.equal(path, file);
    if (!online) throw new Error('Offline');
    return new Response('new compiler');
  }, {stored, shellVersion:'new-shell', integrity:{[file]:digest('new compiler')},
    worlds:{rust:{number:4, version:nextVersion, files:[page, file],
      hashes:{[file]:digest('new compiler'),[page]:digest('same page')}}}});

  await assert.rejects(updated.lifecycle('install'), /Offline/);
  assert.deepEqual(await updated.message('world-status'), {ready:false});
  assert.deepEqual(await old.message('world-status'), {ready:true});
  assert.equal(await (await old.request(page)).text(), 'same page');
  assert.equal(await (await old.request()).text(), 'old compiler');

  online = true;
  await updated.lifecycle('install');
  assert.deepEqual(fetches, [file, file]);
  assert.equal(stored.has(rustCache + legacyVersion), true);
  await updated.lifecycle('activate');
  assert.equal(stored.has(rustCache + legacyVersion), false);
  assert.equal(stored.has(other), true);
  online = false;
  assert.deepEqual(await updated.message('world-status'), {ready:true});
  assert.equal(await (await updated.request(page)).text(), 'same page');
  assert.equal(await (await updated.request()).text(), 'new compiler');
});
