import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserWorkbench } from '../lib/mobile/runner.mjs';
import { runGoWorkbench } from '../lib/mobile/go-runner.mjs';
import { capWasmMemory } from '../lib/mobile/wasm-memory.mjs';

const request = {
  language:'javascript',
  source:'function answer() { return 42; }',
  tests:[{ id:'answer', code:'assert(answer() === 42);' }],
};

class TestWorker extends EventTarget {
  terminations = 0;
  postMessage(job) { this.job = job; }
  terminate() { this.terminations += 1; }
}

test('the Go download and compile watchdog reports an infrastructure failure and releases the runner', async t => {
  const previousWorker = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class extends TestWorker {
    constructor() { super(); workers.push(this); }
  };
  t.after(() => {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  });
  t.mock.timers.enable({ apis:['setTimeout'] });
  const job = { source:'package main\nfunc answer() int { return 42 }',
    tests:[{ id:'answer', code:'if answer() != 42 { t.Error("wrong answer") }' }] };
  const stalled = runGoWorkbench(job);
  assert.equal((await runGoWorkbench(job)).status, 'busy');
  t.mock.timers.tick(35_000);
  assert.equal((await stalled).status, 'runner_error');
  assert.equal(workers[0].terminations, 1);

  const next = runGoWorkbench(job);
  workers[1].dispatchEvent(new MessageEvent('message', { data:{ status:'passed' } }));
  assert.equal((await next).status, 'passed');
  assert.equal(workers[1].terminations, 1);
});

test('the mobile runner sends just the bounded job and closes the worker after a result', async () => {
  const worker = new TestWorker();
  const pending = runBrowserWorkbench({ ...request, limits:{ timeoutMs:10_000 }, ignored:true }, () => worker);
  assert.deepEqual(worker.job, { ...request, typeTests:[], limits:{ timeoutMs:2_000, totalMs:8_000, memoryBytes:32 * 1024 * 1024 } });
  const data = { status:'passed', tests:[{ id:'answer', status:'passed', durationMs:1 }] };
  worker.dispatchEvent(new MessageEvent('message', { data }));
  assert.deepEqual(await pending, data);
  assert.equal(worker.terminations, 1);
});

test('the mobile runner passes TypeScript contracts alongside runnable fixtures', async () => {
  const worker = new TestWorker();
  const typeTests = [{ id:'contract', code:'const value: number = answer();' }];
  const pending = runBrowserWorkbench({ ...request, language:'typescript', typeTests }, () => worker);
  assert.equal(worker.job.language, 'typescript');
  assert.deepEqual(worker.job.typeTests, typeTests);
  assert.deepEqual(worker.job.tests, request.tests);
  worker.dispatchEvent(new MessageEvent('message', { data:{ status:'passed' } }));
  assert.equal((await pending).status, 'passed');
});

test('the mobile runner closes a worker if the route cancels or the worker misses its deadline', async () => {
  const worker = new TestWorker();
  const controller = new AbortController();
  const pending = runBrowserWorkbench({ ...request, signal:controller.signal }, () => worker);
  controller.abort();
  assert.equal((await pending).status, 'canceled');
  assert.equal(worker.terminations, 1);

  const stalled = new TestWorker();
  const timed = await runBrowserWorkbench({ ...request, limits:{ totalMs:100 } }, () => stalled);
  assert.equal(timed.status, 'timeout');
  assert.equal(stalled.terminations, 1);
});

test('the mobile runner rejects unsupported languages and oversized UTF-8 sources before spawning', async () => {
  const unexpected = () => assert.fail('An invalid request must not start a worker.');
  for (const invalid of [
    { ...request, language:'rust' },
    { ...request, source:'🚧'.repeat(13_000) },
    { ...request, tests:new Array(33).fill(request.tests[0]) },
  ]) assert.equal((await runBrowserWorkbench(invalid, unexpected)).status, 'runner_error');
  assert.equal((await runBrowserWorkbench({ ...request, signal:AbortSignal.abort() }, unexpected)).status, 'canceled');
});
test('the Go worker caps an exported memory before running a guest', async () => {
  const module = Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0, // module header
    5, 3, 1, 0, 1, // one memory, minimum one page, no maximum
    7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0, // export memory
  );
  const {instance} = await WebAssembly.instantiate(capWasmMemory(module, 2));
  assert.equal(instance.exports.memory.grow(1), 1);
  assert.throws(() => instance.exports.memory.grow(1), RangeError);
  assert.throws(() => capWasmMemory(module, 0), /Invalid WASM memory limit/);
  assert.throws(() => capWasmMemory(module.subarray(0, 12), 2), /Incomplete WASM section/);
});
