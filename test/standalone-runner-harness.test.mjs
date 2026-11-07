import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { goWasiHarness, rustWasiHarness } from '../lib/standalone-runner-harness.mjs';

test('the Rust WASI harness preserves every catalog case ID and provides a portable admission case', async () => {
  const exercises = JSON.parse(await readFile(new URL('../data/exercises.json', import.meta.url), 'utf8'));
  for (const exercise of exercises) {
    const harness = rustWasiHarness(exercise);
    assert.deepEqual(harness.ids, exercise.testNames);
    assert.match(harness.source, /pub extern "C" fn coding_dungeons_run_case/);
    assert.doesNotMatch(harness.source, /#\[test\]|std::thread::spawn/);
    for (const [index, name] of exercise.testNames.entries()) {
      assert.ok(harness.source.includes(`${index} => ${name}(),`), name);
    }
  }
});

test('native fixtures reject a wrong case list or imports outside the standard library', () => {
  assert.throws(() => rustWasiHarness({ tests: '#[test]\nfn known() {}', testNames: ['unknown'] }));
  assert.throws(() => goWasiHarness([{ id: 'invalid', code: 't.Fatal("missing")', imports: ['example.com/network'] }]));
});

test('the Go WASI harness uses named test bodies and separates imports from code', () => {
  const harness = goWasiHarness([
    { id: 'valid-value', code: 'if !strings.Contains(badge(" hero "), "HERO") { t.Fatal("wrong badge") }', imports: ['strings'] },
    { id: 'empty-value', code: 'if badge("") != "" { t.Fatal("wrong badge") }', imports: ['strings'] },
  ]);
  assert.deepEqual(harness.ids, ['valid-value', 'empty-value']);
  assert.match(harness.source, /\/\/go:wasmexport coding_dungeons_run_case/);
  assert.equal(harness.source.match(/"strings"/g).length, 1);
  assert.match(harness.source, /cases\[index\]\(trial\)/);
  assert.match(harness.source, /if trial\.failed \{ return 0 \}/);
});
