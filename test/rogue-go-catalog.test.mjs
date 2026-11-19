import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, rmdir, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import quest from '../data/workbench/rogue-go.mjs';
import {goWasiHarness} from '../lib/standalone-runner-harness.mjs';

const exec = promisify(execFile);
const env = {
  ...process.env, GO111MODULE:'off', GOENV:'off', GOFLAGS:'', GOPROXY:'off', GOSUMDB:'off',
  GOTOOLCHAIN:'local', GOWORK:'off', CGO_ENABLED:'0', GOMAXPROCS:'2',
};
delete env.GOOS;
delete env.GOARCH;
const command = {env, timeout:90_000, maxBuffer:64 * 1024, windowsHide:true};
const goAvailable = await exec('go', ['version'], command).then(() => true, () => false);
if (process.env.FERRUM_REQUIRE_GO === '1' && !goAvailable) throw new Error('Go is required to verify the incident catalog.');

const repairs = quest.stages.filter(stage => stage.kind === 'code').map(stage => stage.exercise);
function harness(fixtures) {
  const imports = new Set(['testing']);
  for (const fixture of fixtures) for (const path of fixture.imports ?? []) imports.add(path);
  return `package main\nimport (\n${[...imports].map(path => JSON.stringify(path)).join('\n')}\n)\n` +
    fixtures.map(({code}, index) => `func TestIncident${index}(t *testing.T) {\n${code}\n}`).join('\n');
}

// This developer test executes only checked-in reference, starter and mutant
// sources. Learner code uses the isolated Workbench backend instead.
async function runFixture(directory, source) {
  await writeFile(join(directory, 'submission.go'), source, 'utf8');
  try {
    await exec('go', ['test', '-p=2', '-vet=off', '-timeout=5s', '-count=1'], {...command, cwd:directory});
    return {passed:true};
  } catch (error) {
    assert.equal(error.code, 1, error.message);
    return {passed:false, report:`${error.stdout}\n${error.stderr}`};
  }
}

async function withFixtures(fixtures, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dungeons-go-incident-'));
  try {
    await writeFile(join(directory, 'incident_test.go'), harness(fixtures), 'utf8');
    await callback(directory);
  } finally {
    await Promise.allSettled([
      unlink(join(directory, 'submission.go')), unlink(join(directory, 'incident_test.go')),
    ]);
    await rmdir(directory);
  }
}

test('the Go runaway service has eight ordered, independent repairs and explicit production limits', () => {
  assert.equal(quest.id, 'rogue-go-dispatch');
  assert.equal(quest.stages.length, 8);
  assert.equal(new Set(quest.stages.map(stage => stage.id)).size, 8);
  assert.equal(repairs.length, 3);
  assert.match(quest.legacyCode, /DispatchService/);
  assert.match(quest.debrief, /durable shared transaction/);
  assert.match(quest.debrief, /does not coordinate replicas or survive restart/);
  assert.match(quest.debrief, /does not forcibly stop/);
  for (const stage of quest.stages) {
    assert.ok(stage.title?.trim() && stage.prompt?.trim(), stage.id);
    if (stage.kind === 'choice') {
      assert.equal(stage.options.filter(option => option.id === stage.answer).length, 1, stage.id);
      assert.ok(stage.success && stage.retry, stage.id);
    } else {
      const exercise = stage.exercise;
      assert.ok(exercise.tests.some(fixture => fixture.visibility === 'public'), stage.id);
      assert.ok(exercise.tests.some(fixture => fixture.visibility === 'sealed'), stage.id);
      assert.equal(new Set(exercise.tests.map(fixture => fixture.id)).size, exercise.tests.length, stage.id);
      assert.match(exercise.starter, /^package main/);
      assert.match(exercise.reference, /^package main/);
      assert.ok(exercise.tests.every(fixture => fixture.group?.trim()), stage.id);
      assert.ok(!stage.carryFrom, stage.id);
      assert.doesNotMatch(exercise.tests.map(fixture => fixture.code).join('\n'), /time\.Sleep|time\.After|time\.NewTimer/);
      const portable = goWasiHarness(exercise.tests);
      assert.deepEqual(portable.ids, exercise.tests.map(fixture => fixture.id));
      for (const fixture of exercise.tests) assert.ok(portable.source.includes(fixture.code), fixture.id);
    }
  }
});

for (const exercise of repairs) {
  test(`${exercise.id} passes the repaired Go module and rejects the broken module`, {
    skip:!goAvailable && 'Go is unavailable',
  }, async () => {
    await withFixtures(exercise.tests, async directory => {
      const correct = await runFixture(directory, exercise.reference);
      assert.equal(correct.passed, true, correct.report);
      const starter = await runFixture(directory, exercise.starter);
      assert.equal(starter.passed, false, exercise.id);
      assert.match(starter.report, /FAIL:\s+TestIncident|panic: test timed out/, starter.report);
    });
  });
}

test('Go incident fixtures reject conflicting claims, exhausted retries, overflow and leaked admission', {
  skip:!goAvailable && 'Go is unavailable',
}, async () => {
  const byId = new Map(repairs.map(exercise => [exercise.id, exercise]));
  const mutations = [
    ['go-rogue-idempotency', 'payload-conflict-keeps-original',
      'if old.payload != payload { return Claim{Kind:"conflict"} }',
      'if false { return Claim{Kind:"conflict"} }'],
    ['go-rogue-idempotency', 'stable-terminal-receipt',
      'if old.done { return old.receipt == receipt }',
      'if old.done { return true }'],
    ['go-rogue-retry-budget', 'retry-window-and-attempt-budget',
      'attempt >= maxAttempts', 'attempt > maxAttempts'],
    ['go-rogue-retry-budget', 'classify-before-retry',
      'failure != "transient"', 'failure == ""'],
    ['go-rogue-retry-budget', 'saturate-before-overflow',
      'if window > capMs / 2 { window = capMs } else { window *= 2 }',
      'window *= 2'],
    ['go-rogue-drain-workers', 'join-peers-and-stop-after-failure',
      'if first != nil { return confirmed, first }',
      'if false && first != nil { return confirmed, first }'],
    ['go-rogue-drain-workers', 'recall-stops-next-batch',
      'errs[index-offset] = send(ctx, ids[index])',
      'errs[index-offset] = send(context.Background(), ids[index])'],
  ];
  for (const [id, caseId, before, after] of mutations) {
    const exercise = byId.get(id);
    const fixture = exercise.tests.find(item => item.id === caseId);
    assert.ok(exercise.reference.includes(before), `${id}: mutation still targets its intended behavior`);
    await withFixtures([fixture], async directory => {
      const result = await runFixture(directory, exercise.reference.replace(before, after));
      assert.equal(result.passed, false, `${id}/${caseId}`);
      assert.match(result.report, /FAIL:\s+TestIncident0|panic: test timed out/, result.report);
    });
  }
});
