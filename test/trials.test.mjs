import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateTrial, trialsFor } from '../lib/trials.mjs';

const expected = [
  ['javascript', 'dispatch-floor-trial', { 'relay-order': 'b', 'badge-identity': 'c' }],
  ['typescript', 'signal-harbor-trial', { 'read-signal': 'a', 'missing-signal': 'c' }],
  ['rust', 'foundry-trial', { 'pack-ownership': 'b', 'repair-borrow': 'a' }],
  ['go', 'relay-guild-trial', { 'shared-crates': 'c', 'deferred-ledger': 'b' }],
];

test('each world publishes one two-question trial without answer keys or explanations', () => {
  for (const [worldId, trialId, answers] of expected) {
    const catalog = trialsFor(worldId);
    assert.equal(catalog.length, 1);
    const [trial] = catalog;
    assert.equal(trial.id, trialId);
    assert.ok(trial.title.trim() && trial.description.trim());
    assert.deepEqual(Object.keys(trial).sort(), ['description', 'id', 'questions', 'title']);
    assert.deepEqual(trial.questions.map(({id}) => id), Object.keys(answers));
    for (const question of trial.questions) {
      assert.ok(question.text.trim());
      assert.deepEqual(Object.keys(question).sort(), ['id', 'options', 'text']);
      assert.deepEqual(question.options.map(({id}) => id), ['a', 'b', 'c']);
      for (const option of question.options) {
        assert.ok(option.text.trim());
        assert.deepEqual(Object.keys(option).sort(), ['id', 'text']);
      }
    }
  }
  assert.deepEqual(trialsFor('constructor'), []);
});

test('grading requires both correct answers and returns ordered feedback deterministically', () => {
  for (const [worldId, trialId, answers] of expected) {
    const [first, second] = Object.keys(answers);
    const [trial] = trialsFor(worldId);
    for (const left of trial.questions[0].options) {
      for (const right of trial.questions[1].options) {
        const result = evaluateTrial(worldId, trialId, { [second]: right.id, [first]: left.id });
        const correct = [left.id === answers[first], right.id === answers[second]];
        const passed = correct.filter(Boolean).length;
        assert.equal(result.correct, passed === 2);
        assert.equal(result.passed, passed);
        assert.equal(result.total, 2);
        assert.deepEqual(result.feedback.map(({id, correct}) => [id, correct]), [
          [first, correct[0]], [second, correct[1]],
        ]);
        assert.ok(result.feedback.every(({explanation}) => explanation.trim()));
        assert.deepEqual(result, evaluateTrial(worldId, trialId, { [first]: left.id, [second]: right.id }));
      }
    }
  }
});

test('grading rejects missing, extra, inherited, and unknown answers and cross-world trials', () => {
  const [worldId, trialId, answers] = expected[0];
  const [first, second] = Object.keys(answers);
  for (const invalid of [
    undefined, null, [], 'b,c', {}, { [first]: answers[first] },
    { ...answers, foreign: 'a' }, { ...answers, [first]: 'unknown' },
    { ...answers, [first]: 1 }, { ...answers, [first]: ['b'] },
    { ...answers, [first]: { id: 'b' } },
    { __proto__: { [first]: answers[first] }, [second]: answers[second], foreign: 'a' },
    { ...answers, ...JSON.parse('{"__proto__":"a"}') },
  ]) {
    assert.equal(evaluateTrial(worldId, trialId, invalid), null);
  }
  assert.equal(evaluateTrial('typescript', trialId, answers), null);
  assert.equal(evaluateTrial(worldId, 'constructor', answers), null);
});

test('editing a public trial copy cannot change the next listing or grading', () => {
  const [worldId, trialId, answers] = expected[0];
  const [trial] = trialsFor(worldId);
  const [copy] = trialsFor(worldId);
  copy.questions[0].options[0].id = 'changed';
  copy.questions.splice(1);
  assert.deepEqual(trialsFor(worldId), [trial]);
  assert.equal(evaluateTrial(worldId, trialId, answers).correct, true);
});
