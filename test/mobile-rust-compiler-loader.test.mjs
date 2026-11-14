import assert from 'node:assert/strict';
import test from 'node:test';
import {createRustCompilerLoader} from '../lib/mobile/rust-compiler.mjs';

const binary = Uint8Array.of(0,97,115,109,1,0,0,0,5,3,1,0,1);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('canceled noncancelable Rust compilation settles before another compiler fetch or compile starts', async () => {
  const compiles = [];
  let fetched = 0;
  let active = 0;
  let peak = 0;
  const load = createRustCompilerLoader(() => {
    const task = deferred();
    peak = Math.max(peak, ++active);
    compiles.push(task);
    return task.promise.finally(() => active--);
  });
  const asset = async () => { fetched++; return binary; };
  const cancel = new AbortController();
  const first = load(asset, cancel.signal);
  const firstRejected = assert.rejects(first, {name:'AbortError'});
  await tick();
  assert.equal(compiles.length, 1);
  cancel.abort();
  const second = load(asset);
  await tick();
  assert.equal(fetched, 1);
  assert.equal(compiles.length, 1);
  compiles[0].resolve('discarded module');
  await firstRejected;
  await tick();
  assert.equal(fetched, 2);
  assert.equal(compiles.length, 2);
  compiles[1].resolve('ready module');
  assert.equal(await second, 'ready module');
  assert.equal(peak, 1);
});

test('an aborted queued compiler load never downloads bytes and does not block a later retry', async () => {
  const firstCompile = deferred();
  let fetched = 0;
  let compiled = 0;
  const load = createRustCompilerLoader(() => ++compiled === 1 ? firstCompile.promise : Promise.resolve('next module'));
  const asset = async () => { fetched++; return binary; };
  const first = load(asset);
  await tick();
  const cancel = new AbortController();
  const queued = load(asset, cancel.signal);
  const queuedRejected = assert.rejects(queued, {name:'AbortError'});
  cancel.abort();
  const retry = load(asset);
  firstCompile.resolve('first module');
  assert.equal(await first, 'first module');
  await queuedRejected;
  assert.equal(await retry, 'next module');
  assert.equal(fetched, 2);
  assert.equal(compiled, 2);
});

test('a failed browser compilation releases the compiler queue for another attempt', async () => {
  let calls = 0;
  const load = createRustCompilerLoader(async () => {
    if (++calls === 1) throw new Error('Browser compilation failed.');
    return 'ready module';
  });
  await assert.rejects(load(async () => binary), /compilation failed/);
  assert.equal(await load(async () => binary), 'ready module');
  assert.equal(calls, 2);
});

test('canceling during a compiler download prevents module compilation', async () => {
  const cancel = new AbortController();
  const load = createRustCompilerLoader(() => assert.fail('Canceled bytes must not be compiled.'));
  await assert.rejects(load(async () => { cancel.abort(); return binary; }, cancel.signal), {name:'AbortError'});
});
