import assert from 'node:assert/strict';
import test from 'node:test';
import quest from '../data/workbench/system-design.mjs';
import { runWorkbench } from '../lib/workbench-runner.mjs';

const exercise = quest.stages.find(stage => stage.kind === 'code').exercise;
const run = source => runWorkbench({ language: 'javascript', source, tests: exercise.tests });

test('the URL shortener quest has a brief, debrief, and graded stages', () => {
  assert.equal(quest.id, 'system-design-url-shortener');
  assert.ok(quest.brief.trim() && quest.debrief.trim());
  assert.deepEqual(quest.stages.map(({ id, kind }) => [id, kind]), [
    ['estimate-load', 'choice'],
    ['choose-storage', 'choice'],
    ['allocate-code', 'code'],
    ['cache-expiry', 'choice'],
    ['handle-incident', 'choice'],
  ]);
  for (const { kind, options, answer, success, retry } of quest.stages) {
    if (kind === 'choice') {
      assert.ok(options.some(({ id }) => id === answer));
      assert.equal(new Set(options.map(({ id }) => id)).size, options.length);
      assert.ok(success.trim() && retry.trim());
    }
  }
  assert.ok(exercise.tests.some(({ visibility }) => visibility === 'public'));
  assert.ok(exercise.tests.some(({ visibility }) => visibility === 'sealed'));
  assert.ok(exercise.tests.every(({ group }) => group.trim()));
  assert.equal(new Set(exercise.tests.map(({ id }) => id)).size, exercise.tests.length);
});

test('the bounded allocator passes the workbench suite and the starter fails', async () => {
  const reference = await run(exercise.reference);
  assert.equal(reference.status, 'passed', JSON.stringify(reference));
  assert.equal(reference.tests.length, exercise.tests.length);
  const starter = await run(exercise.starter);
  assert.equal(starter.status, 'failed', JSON.stringify(starter));
});

test('the suite catches incorrect bounds, false success, and masked storage errors', async () => {
  const mutants = [
    ['last-attempt-success', exercise.reference.replace('attempt < 5', 'attempt < 4')],
    ['retry-exhaustion', exercise.reference.replace('attempt < 5', 'attempt <= 5')],
    ['retries-conflict', exercise.reference.replace('if (insertIfAbsent(code, url)) return code;', 'insertIfAbsent(code, url);\n    return code;')],
    ['storage-failure', exercise.reference.replace('if (insertIfAbsent(code, url)) return code;', 'try { if (insertIfAbsent(code, url)) return code; } catch {}')],
    ['first-try', exercise.reference.replace('insertIfAbsent(code, url)', 'insertIfAbsent(code, url.toLowerCase())')],
  ];
  for (const [id, source] of mutants) {
    assert.notEqual(source, exercise.reference);
    const result = await run(source);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.tests.find(fixture => fixture.id === id)?.status, 'failed', id);
  }
});
