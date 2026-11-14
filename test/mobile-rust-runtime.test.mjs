import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRustRuntimeLoader} from '../lib/mobile/rust-runtime.mjs';

test('canceled Rust resource loads abort and cannot poison retries or evict a newer cache', async () => {
  const attempts = [];
  const load = createRustRuntimeLoader(signal => new Promise((resolve, reject) => attempts.push({signal, resolve, reject})));
  const cancel = new AbortController();
  const first = load(cancel.signal);
  await Promise.resolve();
  cancel.abort();
  await assert.rejects(first, {name:'AbortError'});
  assert.equal(attempts[0].signal.aborted, true);
  const second = load(new AbortController().signal);
  await Promise.resolve();
  assert.equal(attempts.length, 2);
  attempts[0].reject(new Error('late failure'));
  const runtime = {compiler:'compiled module', sysroot:'verified bytes'};
  attempts[1].resolve(runtime);
  assert.equal(await second, runtime);
  assert.equal(await load(new AbortController().signal), runtime);
  assert.equal(attempts.length, 2);
});

test('failed Rust loads retry and completed resources survive job cancellation', async () => {
  let calls = 0;
  const runtime = {};
  const load = createRustRuntimeLoader(async () => {
    if (++calls === 1) throw new Error('offline');
    return runtime;
  });
  await assert.rejects(load(), /offline/);
  const cancel = new AbortController();
  assert.equal(await load(cancel.signal), runtime);
  cancel.abort();
  await assert.rejects(load(cancel.signal), {name:'AbortError'});
  assert.equal(await load(), runtime);
  assert.equal(calls, 2);
});
