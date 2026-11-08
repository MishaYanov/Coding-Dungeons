import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import goExercises from '../data/workbench/go.mjs';
import { diamondExercise } from '../lib/diamond-encounter.mjs';
import { caseExport, goWasiHarness, rustWasiHarness } from '../lib/standalone-runner-harness.mjs';

const exec = promisify(execFile);
const worker = process.env.DUNGEONS_TEST_WASM_WORKER;
const rustc = process.env.DUNGEONS_TEST_RUSTC_WASM;
const scratch = process.env.DUNGEONS_TEST_NATIVE_SCRATCH ?? tmpdir();
const section = (kind, body) => [kind, body.length, ...body];
const bytes = value => [Buffer.byteLength(value), ...Buffer.from(value)];

function fixture(body, importExit = false) {
  const types = [importExit ? 2 : 1, 0x60, 1, 0x7f, 1, 0x7f];
  if (importExit) types.push(0x60, 1, 0x7f, 0);
  const imports = importExit ? section(2, [1, ...bytes('wasi_snapshot_preview1'), ...bytes('proc_exit'), 0, 1]) : [];
  const memory = importExit ? section(5, [1, 0, 1]) : [];
  const exports = [importExit ? 2 : 1, ...bytes(caseExport), 0, importExit ? 1 : 0];
  if (importExit) exports.push(...bytes('memory'), 2, 0);
  const code = [0, ...body, 0x0b];
  return Buffer.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, types), ...imports, ...section(3, [1, 0]),
    ...memory, ...section(7, exports),
    ...section(10, [1, code.length, ...code]),
  ]);
}

async function verdict(path, index) {
  try {
    await exec(worker, [path, String(index)], { windowsHide: true, timeout: 10_000 });
    return 0;
  } catch (error) {
    if (typeof error.code === 'number') return error.code;
    throw error;
  }
}

test('the real Wasmtime worker distinguishes return, early exit, and fuel exhaustion', { skip: !worker }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-dungeons-wasm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const passing = join(directory, 'return.wasm');
  await writeFile(passing, fixture([0x20, 0, 0x45]));
  assert.equal(await verdict(passing, 0), 0);
  assert.equal(await verdict(passing, 1), 10);
  const exiting = join(directory, 'exit.wasm');
  await writeFile(exiting, fixture([0x41, 0, 0x10, 0, 0x41, 1], true));
  assert.equal(await verdict(exiting, 0), 10);
  const spinning = join(directory, 'spin.wasm');
  await writeFile(spinning, fixture([0x03, 0x40, 0x0c, 0, 0x0b, 0x41, 1]));
  assert.equal(await verdict(spinning, 0), 11);
});

test('a trusted Go fixture builds as a WASI reactor and returns a real case verdict', {
  skip: !worker || process.env.DUNGEONS_TEST_GO_WASM !== '1',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-dungeons-go-wasm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const submission = 'package main\nfunc badge(value string) string { return value }\nfunc main() {}\n';
  const harness = goWasiHarness([
    { id: 'correct', code: 'if badge("ok") != "ok" { t.Fatal("wrong result") }' },
    { id: 'wrong', code: 'if badge("ok") != "no" { t.Fatal("wrong result") }' },
  ]);
  await writeFile(join(directory, 'submission.go'), submission);
  await writeFile(join(directory, 'harness.go'), harness.source);
  const output = join(directory, 'trial.wasm');
  const environment = { ...process.env, GOTOOLCHAIN: 'local', GOENV: 'off', GOPROXY: 'off', GOSUMDB: 'off',
    GO111MODULE: 'off', GOWORK: 'off', GOCACHE: join(directory, 'cache'), GOOS: 'wasip1', GOARCH: 'wasm', CGO_ENABLED: '0' };
  await exec('go', ['build', '-buildmode=c-shared', '-p=1', '-ldflags=-s -w', '-o', output, 'submission.go', 'harness.go'],
    { cwd: directory, env: environment, windowsHide: true, timeout: 120_000 });
  const artifact = new WebAssembly.Module(await readFile(output));
  assert.ok(WebAssembly.Module.exports(artifact).some(entry => entry.name === caseExport));
  assert.equal(await verdict(output, 0), 0);
  assert.equal(await verdict(output, 1), 10);
});

test('all authored Go reference cases run in the real WASI worker', {
  skip: !worker || process.env.DUNGEONS_TEST_GO_WASM !== '1',
}, async t => {
  const directory = await mkdtemp(join(scratch, 'coding-dungeons-go-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = { ...process.env, GOTOOLCHAIN: 'local', GOENV: 'off', GOPROXY: 'off', GOSUMDB: 'off',
    GO111MODULE: 'off', GOWORK: 'off', GOCACHE: join(directory, 'cache'), GOOS: 'wasip1', GOARCH: 'wasm', CGO_ENABLED: '0' };
  const goblin = diamondExercise('go');
  const wrongGoblin = {...goblin, id:'go-diamond-example-only', reference:goblin.starter.replace('return 0', 'return 9'),
    expectedVerdicts:[0, 10, 10]};
  for (const exercise of [...goExercises, goblin, wrongGoblin]) {
    const harness = goWasiHarness(exercise.tests);
    const output = join(directory, 'trial.wasm');
    await writeFile(join(directory, 'submission.go'), exercise.reference);
    await writeFile(join(directory, 'harness.go'), harness.source);
    await exec('go', ['build', '-buildmode=c-shared', '-p=1', '-ldflags=-s -w', '-o', output, 'submission.go', 'harness.go'],
      { cwd: directory, env: environment, windowsHide: true, timeout: 120_000 });
    for (const [index, id] of harness.ids.entries()) {
      assert.equal(await verdict(output, index), exercise.expectedVerdicts?.[index] ?? 0, `${exercise.id}/${id}`);
    }
  }
});

test('the Rust WASI harness runs every reference case using the pinned compiler', {
  skip: !worker || !rustc,
}, async t => {
  const exercises = JSON.parse(await readFile(new URL('../data/exercises.json', import.meta.url), 'utf8'));
  const directory = await mkdtemp(join(scratch, 'coding-dungeons-rust-wasm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = join(directory, 'libferrum_submission.rlib');
  const artifact = join(directory, 'trial.wasm');
  const flags = ['--target', 'wasm32-wasip1', '--edition=2024', '-Cpanic=abort', '-Cdebuginfo=0', '-Awarnings'];
  const options = { cwd: directory, env: { ...process.env, TEMP: directory, TMP: directory }, windowsHide: true, timeout: 20_000 };
  const goblin = diamondExercise('rust');
  const correctGoblin = {...goblin, solution:goblin.reference};
  const wrongGoblin = {...goblin, id:'rust-diamond-example-only', solution:goblin.starter.replace('todo!()', '9'),
    expectedVerdicts:[0, 10, 10]};
  for (const exercise of [...exercises, correctGoblin, wrongGoblin]) {
    const harness = rustWasiHarness(exercise);
    await writeFile(join(directory, 'submission.rs'), exercise.solution);
    await exec(rustc, [...flags, '--crate-type=rlib', '--crate-name=ferrum_submission', '-o', 'libferrum_submission.rlib', 'submission.rs'], options);
    await writeFile(join(directory, 'harness.rs'), harness.source);
    await exec(rustc, [...flags, '--crate-type=cdylib', '--crate-name=ferrum_harness', '--extern', `ferrum_submission=${library}`,
      '-o', artifact, 'harness.rs'], options);
    for (const [index, id] of harness.ids.entries()) {
      assert.equal(await verdict(artifact, index), exercise.expectedVerdicts?.[index] ?? 0, `${exercise.id}/${id}`);
    }
  }
});
