import assert from 'node:assert/strict';
import test from 'node:test';
import quest from '../data/workbench/rate-limiter.mjs';
import { runWorkbench } from '../lib/workbench-runner.mjs';

const exercise = quest.stages.find(stage => stage.kind === 'code').exercise;
const run = source => runWorkbench({ language: 'javascript', source, tests: exercise.tests });

test('the rate limiter quest has a brief, debrief, and five graded stages', () => {
  assert.equal(quest.id, 'system-design-rate-limiter');
  assert.ok(quest.brief.trim() && quest.debrief.trim());
  assert.deepEqual(quest.stages.map(({ id, kind }) => [id, kind]), [
    ['identify-client', 'choice'],
    ['choose-token-bucket', 'choice'],
    ['consume-token', 'code'],
    ['update-atomically', 'choice'],
    ['handle-limiter-outage', 'choice'],
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

test('the reference token bucket passes and the starter fails', async () => {
  const reference = await run(exercise.reference);
  assert.equal(reference.status, 'passed', JSON.stringify(reference));
  assert.equal(reference.tests.length, exercise.tests.length);
  const starter = await run(exercise.starter);
  assert.equal(starter.status, 'failed', JSON.stringify(starter));
});

test('the suite rejects off-by-one, rounding, refill, and clock regressions', async () => {
  const mutants = [
    ['exact-token', exercise.reference.replace('available >= 1_000', 'available > 1_000')],
    ['ceil-wait', exercise.reference.replace('Math.ceil', 'Math.floor')],
    ['capacity-clamp', exercise.reference.replace('Math.min(capacityCredits, bucket.credits + elapsedMs * bucket.creditsPerMs)',
      'bucket.credits + elapsedMs * bucket.creditsPerMs')],
    ['incremental-refill', exercise.reference.replace('updatedAtMs: effectiveNow', 'updatedAtMs: allowed ? effectiveNow : bucket.updatedAtMs')],
    ['incremental-refill', exercise.reference.replace('available - 1_000 : available', 'available - 1_000 : 0')],
    ['clock-regression', exercise.reference.replace('Math.max(nowMs, bucket.updatedAtMs)', 'nowMs')],
    ['clock-regression', exercise.reference.replace('effectiveNow - nowMs + Math.ceil', 'Math.ceil')],
    ['fresh-state', exercise.reference.replace('bucket: { ...bucket, credits, updatedAtMs: effectiveNow }',
      'bucket: Object.assign(bucket, { credits, updatedAtMs: effectiveNow })')],
  ];
  for (const [id, source] of mutants) {
    assert.notEqual(source, exercise.reference);
    const result = await run(source);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.tests.find(fixture => fixture.id === id)?.status, 'failed', id);
  }
});
