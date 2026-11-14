import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/mobile/service-worker.js', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://dungeons.test';
const file = '/runtime/rust/compiler.wasm';

function worker(fetchAsset, integrity = {[file]:digest('compiler')}) {
  const handlers = new Map();
  const stored = new Map();
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
    offline:{shellVersion:'shell', shellFiles:[], integrity,
      worlds:{rust:{number:3, version:'0123456789abcdef', files:[file]}}},
    self:{location:{origin}, clients:{claim:async () => {}}, addEventListener:(event, callback) => handlers.set(event, callback)},
  });
  async function message(type) {
    let pending;
    let answer;
    handlers.get('message')({data:{type, world:'rust'}, ports:[{postMessage:value => { answer = value; }}],
      waitUntil:promise => { pending = promise; }});
    await pending;
    return structuredClone(answer);
  }
  function request() {
    let pending;
    handlers.get('fetch')({request:new Request(origin + file), respondWith:promise => { pending = promise; }});
    return pending;
  }
  return {message, request, stored};
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

test('online Rust asset requests and corrupted cached bytes cannot bypass the pinned digest', async () => {
  const wrong = worker(() => new Response('changed compiler'));
  await assert.rejects(wrong.request(), /integrity/i);

  const valid = worker(() => new Response('compiler'));
  assert.deepEqual(await valid.message('download-world'), {ready:true});
  valid.stored.get('coding-dungeons-mobile-world-rust-0123456789abcdef').set(file, new Response('changed compiler'));
  await assert.rejects(valid.request(), /integrity/i);
  assert.deepEqual(await valid.message('world-status'), {ready:false});
  assert.deepEqual(await valid.message('download-world'), {ready:true});
});
