import assert from 'node:assert/strict';
import test from 'node:test';
import rustExercises from '../data/exercises.json' with {type:'json'};
import { caseExport, rustWasiHarness } from '../lib/standalone-runner-harness.mjs';
import { runRustWorkbench } from '../lib/mobile/rust-runner.mjs';

const exercise = {
  id:'mobile-answer',
  tests:'#[test]\nfn answer_is_correct() { assert_eq!(answer(), 42); }',
  testNames:['answer_is_correct'],
};
const request = {source:'pub fn answer() -> i32 { 42 }', exercise};
const passed = {status:'passed', tests:[{id:'answer_is_correct', status:'passed', durationMs:1}], diagnostics:[]};

class TestWorker extends EventTarget {
  terminations = 0;
  postMessage(job) { this.job = job; }
  terminate() { this.terminations++; }
  send(data) { this.dispatchEvent(new MessageEvent('message', {data})); }
}

test('the Rust WASI harness can be generated without Node globals and still bounds UTF-8 fixtures', () => {
  const originalBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const harness = rustWasiHarness(exercise);
    assert.deepEqual(harness.ids, exercise.testNames);
    assert.ok(harness.source.includes(`pub extern "C" fn ${caseExport}`));
    assert.ok(harness.source.includes('use ferrum_submission::*;'));
    assert.equal(harness.source.includes('#[test]'), false);
    assert.throws(() => rustWasiHarness({...exercise, tests:exercise.tests + '\n//' + 'é'.repeat(70_000)}),
      /Invalid Rust suite source/);
  } finally {
    globalThis.Buffer = originalBuffer;
  }
});

test('portable Rust constants retain the complete dense-atlas generation retirement check', () => {
  const atlas = rustExercises.find(item => item.id === 'dense-atlas');
  const standard = rustWasiHarness(atlas);
  const portable = rustWasiHarness(atlas, {portableConstants:true});
  assert.ok(standard.source.includes('for value in 1..=u16::from(u8::MAX) {'));
  assert.equal(portable.source, standard.source.replace('u16::from(u8::MAX)', '255_u16'));
  assert.deepEqual(portable.ids, standard.ids);
  assert.ok(portable.source.includes('let replacement = arena.insert(256);'));
  assert.deepEqual(rustWasiHarness(exercise, {portableConstants:true}), rustWasiHarness(exercise));
  for (const tests of [
    atlas.tests.replace('u16::from(u8::MAX)', 'u16::from(u8::MAX - 1)'),
    atlas.tests + '\n// u16::from(u8::MAX)',
  ]) assert.throws(() => rustWasiHarness({...atlas, tests}, {portableConstants:true}), /portable constant/);
});

test('Rust runner sends a trusted harness and terminates its worker after the selected suite', async () => {
  const worker = new TestWorker();
  const pending = runRustWorkbench(request, () => worker);
  assert.equal(worker.job.source, request.source);
  assert.deepEqual(worker.job.harness.ids, exercise.testNames);
  assert.ok(worker.job.harness.source.includes('use ferrum_submission::*;'));
  worker.send({result:passed});
  assert.deepEqual(await pending, passed);
  assert.equal(worker.terminations, 1);
});

test('Rust runner rejects oversized sources and unknown or duplicate case IDs before creating a worker', async () => {
  const unexpected = () => assert.fail('Invalid Rust jobs must not create a worker.');
  for (const invalid of [
    {...request, source:'é'.repeat(25_000)},
    {...request, caseIds:[]},
    {...request, caseIds:['missing']},
    {...request, caseIds:['answer_is_correct','answer_is_correct']},
    {...request, exercise:{...exercise, tests:'#[test] fn different() {}'}},
  ]) assert.equal((await runRustWorkbench(invalid, unexpected)).status, 'runner_error');
  assert.equal((await runRustWorkbench({...request, signal:AbortSignal.abort()}, unexpected)).status, 'canceled');
});

test('Rust runner retains selected case identity and rejects incomplete or contradictory worker verdicts', async () => {
  const suite = {...exercise, tests:exercise.tests + '\n#[test]\nfn second_case() { assert_eq!(answer(), 42); }',
    testNames:['answer_is_correct','second_case']};
  const selected = {...request, exercise:suite, caseIds:['second_case']};
  const worker = new TestWorker();
  const pending = runRustWorkbench(selected, () => worker);
  assert.deepEqual(worker.job.caseIds, ['second_case']);
  worker.send({result:{...passed, tests:[{id:'second_case', status:'passed', durationMs:1}]}});
  assert.equal((await pending).status, 'passed');
  for (const incorrect of [
    {...passed, tests:[]},
    {...passed, tests:[{id:'answer_is_correct', status:'failed', durationMs:1}]},
    {...passed, tests:[{id:'different_case', status:'passed', durationMs:1}]},
  ]) {
    const invalid = new TestWorker();
    const verdict = runRustWorkbench(request, () => invalid);
    invalid.send({result:incorrect});
    assert.equal((await verdict).status, 'runner_error');
    assert.equal(invalid.terminations, 1);
  }
});

test('Rust runner permits only one job, cancels promptly and releases its slot for retry', async () => {
  const worker = new TestWorker();
  const controller = new AbortController();
  const pending = runRustWorkbench({...request, signal:controller.signal}, () => worker);
  assert.equal((await runRustWorkbench(request, () => assert.fail('A second compiler must not start.'))).status, 'busy');
  controller.abort();
  assert.equal((await pending).status, 'canceled');
  assert.equal(worker.terminations, 1);
  const next = new TestWorker();
  const retried = runRustWorkbench(request, () => next);
  next.send({result:passed});
  assert.equal((await retried).status, 'passed');
  assert.equal(next.terminations, 1);
});

test('Rust compiler and outer deadlines are infrastructure failures, while a running case can time out', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const compile = new TestWorker();
  const compiling = runRustWorkbench(request, () => compile);
  compile.send({phase:'compile'});
  t.mock.timers.tick(60_000);
  assert.equal((await compiling).status, 'runner_error');
  assert.equal(compile.terminations, 1);

  const guest = new TestWorker();
  const running = runRustWorkbench(request, () => guest);
  guest.send({phase:'compile'});
  guest.send({phase:'link'});
  guest.send({phase:'case', index:0});
  t.mock.timers.tick(2_000);
  assert.equal((await running).status, 'timeout');
  assert.equal(guest.terminations, 1);

  const outer = new TestWorker();
  const stalled = runRustWorkbench(request, () => outer);
  t.mock.timers.tick(50_000);
  outer.send({phase:'link'});
  t.mock.timers.tick(40_000);
  assert.equal((await stalled).status, 'runner_error');
  assert.equal(outer.terminations, 1);
});

test('Rust worker launch, event and message failures never claim a successful grade', async () => {
  assert.equal((await runRustWorkbench(request, () => { throw new Error('Worker unavailable'); })).status, 'runner_error');
  for (const kind of ['error','messageerror']) {
    const worker = new TestWorker();
    const pending = runRustWorkbench(request, () => worker);
    worker.dispatchEvent(new Event(kind));
    assert.equal((await pending).status, 'runner_error');
    assert.equal(worker.terminations, 1);
  }
  const malformed = new TestWorker();
  const pending = runRustWorkbench(request, () => malformed);
  malformed.send({result:true});
  assert.equal((await pending).status, 'runner_error');
  assert.equal(malformed.terminations, 1);
});
