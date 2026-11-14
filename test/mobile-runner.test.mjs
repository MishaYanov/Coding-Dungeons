import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserWorkbench } from '../lib/mobile/runner.mjs';

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
