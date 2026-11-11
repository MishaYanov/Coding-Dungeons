import assert from 'node:assert/strict';
import test from 'node:test';
import quest from '../data/workbench/refactoring.mjs';
import { runWorkbench } from '../lib/workbench-runner.mjs';

const [, boundary, pipeline] = quest.stages;
const run = (exercise, source) => runWorkbench({ language: 'javascript', source, tests: exercise.tests });
const runPipeline = (source, parser = boundary.exercise.reference) => run(pipeline.exercise, `${parser}\n\n${source}`);

test('the relay quest alternates planning, implementation, and rollout', () => {
  assert.deepEqual(quest.stages.map(({ id, kind }) => [id, kind]), [
    ['characterize', 'choice'], ['extract-boundary', 'code'], ['refactor-policy', 'code'], ['rollout', 'choice'],
  ]);
  assert.match(quest.legacyCode, /function routeRelayBatchLegacy\(/);
  for (const stage of quest.stages) {
    assert.ok(stage.prompt.trim());
    if (stage.kind === 'choice') {
      const optionIds = stage.options.map(({ id }) => id);
      assert.equal(new Set(optionIds).size, optionIds.length);
      assert.ok(optionIds.includes(stage.answer));
      assert.ok(stage.success.trim() && stage.retry.trim());
    } else {
      const { tests } = stage.exercise;
      assert.ok(tests.some(({ visibility }) => visibility === 'public'));
      assert.ok(tests.some(({ visibility }) => visibility === 'sealed'));
      assert.ok(tests.every(({ group }) => group.trim()));
      assert.equal(new Set(tests.map(({ id }) => id)).size, tests.length);
    }
  }
});

test('the two code stages pass in sequence, while their untouched starters fail', async () => {
  const boundaryResult = await run(boundary.exercise, boundary.exercise.reference);
  assert.equal(boundaryResult.status, 'passed', JSON.stringify(boundaryResult));
  assert.equal(boundaryResult.tests.length, boundary.exercise.tests.length);
  const boundaryStarter = await run(boundary.exercise, boundary.exercise.starter);
  assert.equal(boundaryStarter.status, 'failed', JSON.stringify(boundaryStarter));

  const pipelineResult = await runPipeline(pipeline.exercise.reference);
  assert.equal(pipelineResult.status, 'passed', JSON.stringify(pipelineResult));
  assert.equal(pipelineResult.tests.length, pipeline.exercise.tests.length);
  const pipelineStarter = await runPipeline(pipeline.exercise.starter);
  assert.equal(pipelineStarter.status, 'failed', JSON.stringify(pipelineStarter));
});

test('boundary fixtures reject coercion and serialization-only lookalikes', async () => {
  const reference = boundary.exercise.reference;
  const coercion = reference.replace('const { id, crates } = payload;', 'const { id } = payload;\n  const crates = Number(payload.crates);');
  assert.notEqual(coercion, reference);
  const coerced = await run(boundary.exercise, coercion);
  assert.equal(coerced.status, 'failed', JSON.stringify(coerced));
  assert.equal(coerced.tests.find(({ id }) => id === 'crate-count-validation')?.status, 'failed');

  const lookalike = await run(boundary.exercise, `function parseRelayOrder() {
    return { toJSON: () => ({ ok: true, order: { id: 'A-17', crates: 2, expedited: false } }) };
  }`);
  assert.equal(lookalike.status, 'failed', JSON.stringify(lookalike));
});

test('pipeline fixtures catch duplicate precedence, rejected reservations, and aliased state', async () => {
  const reference = pipeline.exercise.reference;
  const regressions = [
    ['duplicate-before-capacity', reference.replace('if (accepted.has(id))', 'if (crates <= remaining && accepted.has(id))')],
    ['no-reservation-on-rejection', reference.replace('if (crates > remaining)', 'accepted.add(id);\n    if (crates > remaining)')],
    ['independent-ledgers', reference.replace('  for (const raw of rows)', '  if (rows.length === 0) return { decisions, ledger };\n  for (const raw of rows)')],
    ['legacy-parity', reference.replace('const acceptedIds = [...ledger.acceptedIds];', 'const acceptedIds = ledger.acceptedIds;')],
    ['routes-in-input-order', reference.replace('  return { decisions, ledger: { remaining, acceptedIds } };',
      '  rows[0] = rows[0]?.toUpperCase();\n  return { decisions, ledger: { remaining, acceptedIds } };')],
  ];
  for (const [fixtureId, source] of regressions) {
    assert.notEqual(source, reference);
    const result = await runPipeline(source);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.tests.find(({ id }) => id === fixtureId)?.status, 'failed', fixtureId);
  }
});

test('editing the earlier parser cannot silently relax the pipeline contract', async () => {
  const parser = boundary.exercise.reference.replace('typeof payload.expedited !== \'boolean\'', 'false');
  assert.notEqual(parser, boundary.exercise.reference);
  const result = await runPipeline(pipeline.exercise.reference, parser);
  assert.equal(result.status, 'failed', JSON.stringify(result));
  assert.equal(result.tests.find(({ id }) => id === 'legacy-parity')?.status, 'failed');
});

test('legacy and refactored outputs match on diverse deterministic batches', async () => {
  const result = await runWorkbench({
    language: 'javascript',
    source: `${boundary.exercise.reference}\n\n${pipeline.exercise.reference}`,
    tests: [{
      id: 'deterministic-parity',
      code: `${quest.legacyCode}
const values = [undefined, null, false, true, 1, 'true'];
const quantities = [0, -1, 0.5, '1', 1, 2, 20, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
const ids = ['a', ' A ', 'ß', 'SS', 'é', ' E ', ' ', 'current', 'R-1', 5, undefined];
for (let seed = 0; seed < 24; seed++) {
  const rows = ['{', '[]', 'null'];
  for (let index = 0; index < 60; index++) {
    const crates = quantities[(seed + index * 5) % quantities.length];
    const expedited = values[(seed * 3 + index * 11) % values.length];
    const id = ids[(seed + index * 7) % ids.length];
    rows.push(JSON.stringify({ id, crates, expedited, metadata: { index } }));
  }
  const legacyLedger = { remaining: seed, acceptedIds: ['CURRENT'] };
  const input = Object.freeze({ remaining: seed, acceptedIds: Object.freeze(['CURRENT']) });
  const expected = routeRelayBatchLegacy(rows, legacyLedger);
  const actual = routeRelayBatch(Object.freeze(rows), input);
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Different outcome for batch ' + seed);
}`,
    }],
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
});
