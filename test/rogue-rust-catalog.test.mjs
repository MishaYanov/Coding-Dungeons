import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import quest from '../data/workbench/rogue-rust.mjs';
import { fixtureMetadata } from '../lib/workbench-report.mjs';
import { rustWasiHarness } from '../lib/standalone-runner-harness.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../server.mjs', import.meta.url)));
const rustc = process.env.FERRUM_TEST_RUSTC ?? 'rustc';
const options = { cwd:root, timeout:30_000, windowsHide:true, maxBuffer:128 * 1024 };
const exercises = quest.stages.filter(stage => stage.kind === 'code').map(stage => stage.exercise);

test('the Rust incident has ordered repairs, explicit runtime limits, and sealed named suites', () => {
  assert.equal(quest.id, 'rust-runaway-dispatch');
  assert.equal(quest.stages.length, 8);
  assert.equal(exercises.length, 3);
  assert.equal(new Set(quest.stages.map(stage => stage.id)).size, quest.stages.length);
  assert.equal(new Set(exercises.map(exercise => exercise.id)).size, exercises.length);
  assert.match(quest.legacyCode, /thread::spawn/);
  assert.match(quest.legacyCode, /carrier\.send/);
  assert.match(quest.legacyCode, /process::exit/);
  assert.match(quest.brief, /WASI.*no OS thread creation/);
  assert.match(quest.debrief, /does not spawn or join workers/);
  assert.match(quest.debrief, /in one process only/);
  assert.match(quest.debrief, /outbox/);
  for (const stage of quest.stages) {
    assert.ok(stage.title && stage.prompt);
    if (stage.kind === 'choice') {
      assert.equal(stage.options.filter(option => option.id === stage.answer).length, 1);
      assert.equal(new Set(stage.options.map(option => option.id)).size, stage.options.length);
      assert.ok(stage.success && stage.retry);
    }
  }
  for (const exercise of exercises) {
    assert.equal(exercise.language, 'rust');
    assert.ok(Buffer.byteLength(exercise.starter) < 48 * 1024);
    assert.ok(Buffer.byteLength(exercise.reference) < 48 * 1024);
    assert.doesNotMatch(exercise.starter, /\btodo!\s*\(/);
    assert.deepEqual([...exercise.tests.matchAll(/#\[test\]\s*fn ([a-z_][a-z0-9_]*)\(\)/g)].map(match => match[1]), exercise.testNames);
    assert.equal(new Set(exercise.testNames).size, exercise.testNames.length);
    const fixtures = fixtureMetadata(exercise);
    assert.equal(fixtures[0].visibility, 'public');
    assert.ok(fixtures.slice(1).every(fixture => fixture.visibility === 'sealed'));
    assert.doesNotMatch(exercise.tests + exercise.reference, /std::thread|thread::spawn/);
    const wasmHarness = rustWasiHarness(exercise, {portableConstants:true});
    assert.match(wasmHarness.source, /coding_dungeons_run_case/);
    assert.deepEqual(wasmHarness.ids, exercise.testNames);
    for (const id of exercise.testNames) assert.ok(wasmHarness.source.includes(id));
  }
});

async function compile(directory, source, tests) {
  const submission = join(directory, 'submission.rs');
  const library = join(directory, 'libferrum_submission.rlib');
  const harness = join(directory, 'harness.rs');
  const executable = join(directory, process.platform === 'win32' ? 'suite.exe' : 'suite');
  const local = {...options, cwd:directory};
  const flags = ['--edition=2024', '--color=never'];
  await writeFile(submission, source, 'utf8');
  await exec(rustc, [...flags, '--crate-type=rlib', '--crate-name=ferrum_submission', '-o', library, submission], local);
  await writeFile(harness, `mod incident_tests { use ferrum_submission::*;\n${tests}\n}`, 'utf8');
  await exec(rustc, [...flags, '--test', '--crate-name=ferrum_harness', '--extern', `ferrum_submission=${library}`,
    '-o', executable, harness], local);
  return executable;
}

async function inScratch(run) {
  const base = join(root, 'state');
  await mkdir(base, {recursive:true});
  const directory = await mkdtemp(join(base, 'coding-dungeons-rogue-rust-'));
  try { return await run(directory); }
  finally {
    await Promise.all((await readdir(directory)).map(name => unlink(join(directory, name))));
    await rmdir(directory);
  }
}

async function expectFail(executable, directory, filter) {
  await assert.rejects(exec(executable, ['--test-threads=1', '--color=never', ...(filter ? [filter] : [])], {...options, cwd:directory}), error => {
    assert.equal(error.code, 101, error.stdout || error.stderr);
    assert.match(error.stdout, /test result: FAILED/);
    return true;
  });
}

const hostLedger = `
#[test]
fn host_threads_reserve_one_owner_and_share_receipt() {
    use std::sync::{Arc, Barrier};
    let ledger = Ledger::default();
    let barrier = Arc::new(Barrier::new(24));
    let handles: Vec<_> = (0..24).map(|_| {
        let ledger = ledger.clone(); let barrier = barrier.clone();
        std::thread::spawn(move || { barrier.wait(); ledger.claim("K7", "same-body") })
    }).collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| **r == Claim::Started).count(), 1);
    assert_eq!(results.iter().filter(|r| **r == Claim::Busy).count(), 23);
    assert!(ledger.complete("K7", "same-body", 700));
    let other = ledger.clone();
    assert_eq!(std::thread::spawn(move || other.claim("K7", "same-body")).join().unwrap(), Claim::Replayed(700));
}
#[test]
fn host_poison_is_reported_without_overwriting_the_ledger() {
    let ledger = Ledger::default();
    let worker = ledger.clone();
    assert!(std::thread::spawn(move || worker.poison_for_author_test()).join().is_err());
    assert_eq!(ledger.claim("K7", "body"), Claim::Unavailable);
    assert!(!ledger.complete("K7", "body", 7));
}`;
const poisonHelper = `
// This author-only fault injection is never sent to the game runner.
impl Ledger {
    pub fn poison_for_author_test(&self) {
        let _guard = self.entries.lock().unwrap();
        panic!("author-injected panic while holding the ledger lock");
    }
}`;
const hostGate = `
#[test]
fn host_threads_bound_intake_and_drain_accepted_work() {
    use std::sync::{Arc, Barrier};
    let gate = Gate::new(3);
    let start = Arc::new(Barrier::new(17));
    let claimed = Arc::new(Barrier::new(17));
    let release = Arc::new(Barrier::new(17));
    let handles: Vec<_> = (0..16).map(|_| {
        let gate = gate.clone(); let start = start.clone();
        let claimed = claimed.clone(); let release = release.clone();
        std::thread::spawn(move || {
            start.wait();
            let permit = gate.try_acquire();
            claimed.wait(); release.wait();
            let admitted = permit.is_some(); drop(permit); admitted
        })
    }).collect();
    start.wait(); claimed.wait();
    let active = gate.active(); gate.drain();
    let admitted_after_drain = gate.try_acquire().is_some();
    let drained_before_release = gate.is_drained();
    // Release threads before asserting, including on a regression.
    release.wait();
    let admitted = handles.into_iter().map(|h| h.join().unwrap()).filter(|admitted| *admitted).count();
    assert_eq!(active, 3); assert_eq!(admitted, 3);
    assert!(!admitted_after_drain); assert!(!drained_before_release);
    assert_eq!(gate.active(), 0); assert!(gate.is_drained());
}
#[test]
fn host_worker_unwind_releases_its_permit() {
    let gate = Gate::new(1); let worker = gate.clone();
    assert!(std::thread::spawn(move || {
        let _permit = worker.try_acquire().unwrap();
        panic!("author-injected handler failure outside the gate lock");
    }).join().is_err());
    assert_eq!(gate.active(), 0); gate.drain(); assert!(gate.is_drained());
}`;

const regressions = [
  ['rust-rogue-idempotency', 'changed payload cannot replay the original result', 'Some((original, _)) if original != payload', 'Some((original, _)) if false', 'payload_conflicts_do_not_replace_original'],
  ['rust-rogue-idempotency', 'a second pending claimant cannot start work', 'Some((_, None)) => Claim::Busy', 'Some((_, None)) => Claim::Started', 'overlapping_claims_have_one_owner'],
  ['rust-rogue-idempotency', 'terminal receipt is immutable', 'original == payload && saved.is_none()', 'original == payload', 'completion_requires_pending_owner'],
  ['rust-rogue-retry-budget', 'maximum includes the original attempt', 'attempt >= max_attempts', 'attempt > max_attempts', 'attempt_budget_counts_original_attempt'],
  ['rust-rogue-retry-budget', 'first window respects its cap', 'base_ms.min(cap_ms)', 'base_ms', 'invalid_windows_and_positive_jitter'],
  ['rust-rogue-retry-budget', 'a delay at the deadline is rejected', 'delay < remaining_ms', 'delay <= remaining_ms', 'delay_leaves_time_inside_deadline'],
  ['rust-rogue-retry-budget', 'large exponential growth saturates', 'window > cap_ms - window', 'false', 'backoff_saturates_without_wrapping'],
  ['rust-rogue-drain-gate', 'capacity is checked before reservation', 'state.active >= state.capacity', 'state.active > state.capacity', 'capacity_is_released_by_drop'],
  ['rust-rogue-drain-gate', 'closing admission is permanent', '!state.accepting || state.active', 'state.active', 'drain_rejects_new_work_and_waits_for_old'],
];

test('Rust incident references, broken patches, real threads, and plausible regressions are discriminated', {timeout:180_000}, async t => {
  try { t.diagnostic((await exec(rustc, ['--version'], options)).stdout.trim()); }
  catch (error) {
    if (error.code !== 'ENOENT' || process.env.FERRUM_TEST_RUSTC || process.env.FERRUM_REQUIRE_RUSTC === '1') throw error;
    t.skip('Install rustc to verify the Rust incident catalog.'); return;
  }
  for (const exercise of exercises) {
    await t.test(exercise.id, async () => inScratch(async directory => {
      const reference = await compile(directory, exercise.reference, exercise.tests);
      const listing = (await exec(reference, ['--list'], {...options, cwd:directory})).stdout;
      assert.deepEqual([...listing.matchAll(/^incident_tests::([^\r\n]+): test\r?$/gm)].map(match => match[1]).toSorted(), exercise.testNames.toSorted());
      assert.match((await exec(reference, ['--test-threads=1'], {...options, cwd:directory})).stdout,
        new RegExp(`test result: ok\\. ${exercise.testNames.length} passed; 0 failed`));
      const broken = await compile(directory, exercise.starter, exercise.tests);
      await expectFail(broken, directory);
    }));
  }
  await t.test('real Rust threads share reservations, honor capacity, and release on unwind', async () => inScratch(async directory => {
    const ledger = exercises.find(exercise => exercise.id === 'rust-rogue-idempotency');
    const ledgerSuite = await compile(directory, ledger.reference + poisonHelper, hostLedger);
    assert.match((await exec(ledgerSuite, ['--test-threads=1'], {...options, cwd:directory})).stdout, /2 passed; 0 failed/);
    const gate = exercises.find(exercise => exercise.id === 'rust-rogue-drain-gate');
    const gateSuite = await compile(directory, gate.reference, hostGate);
    assert.match((await exec(gateSuite, ['--test-threads=1'], {...options, cwd:directory})).stdout, /2 passed; 0 failed/);
  }));
  for (const [id, label, from, to, filter] of regressions) {
    await t.test(label, async () => inScratch(async directory => {
      const exercise = exercises.find(exercise => exercise.id === id);
      assert.equal(exercise.reference.split(from).length, 2, 'The mutation must replace exactly one intended expression.');
      const executable = await compile(directory, exercise.reference.replace(from, to), exercise.tests);
      await expectFail(executable, directory, filter);
    }));
  }
});
