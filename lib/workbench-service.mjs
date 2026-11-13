import { runWorkbench } from './workbench-runner.mjs';

function sum(rows, status) {
  return rows.filter(row => row.status === status).length;
}

export function fixtureMetadata(exercise) {
  if (typeof exercise.tests === 'string') {
    return exercise.testNames.map((id, index) => ({ id, visibility:index === 0 ? 'public' : 'sealed',
      group:index === 0 ? 'Examples' : 'Rust cases' }));
  }
  return [...exercise.tests, ...(exercise.typeTests ?? []).map(fixture => ({
    ...fixture, visibility:'sealed', group:'Type contract',
  }))];
}

export function workbenchSummary(exercise) {
  const fixtures = fixtureMetadata(exercise);
  return {id:exercise.id, level:exercise.level, title:exercise.title, description:exercise.description,
    signature:exercise.signature, starter:exercise.starter, suiteRevision:exercise.suiteRevision,
    testNames:fixtures.filter(fixture => fixture.visibility === 'public').map(({id}) => id),
    requiredCases:fixtures.length};
}

export function presentWorkbenchRun(raw, fixtures) {
  const allowed = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const results = new Map();
  for (const item of raw.tests) {
    if (!allowed.has(item.id) || results.has(item.id) || !['passed', 'failed', 'timeout'].includes(item.status)) {
      return {verdict:'error', output:'The workbench returned an invalid suite result.', passed:0, failed:0,
        passedTests:[], failedTests:[], groups:[], cases:[]};
    }
    results.set(item.id, item);
  }
  const rows = [...results.values()];
  const completePass = rows.length === fixtures.length && rows.every(row => row.status === 'passed');
  const verdicts = {passed:completePass ? 'pass' : 'error', failed:'fail', compile_error:'compile_error',
    timeout:'timeout', runner_error:'error', busy:'busy', unavailable:'unavailable', canceled:'canceled'};
  const verdict = verdicts[raw.status] ?? 'error';
  const cases = rows.filter(row => allowed.get(row.id).visibility === 'public')
    .map(({id, status, durationMs, message}) => ({id, status, durationMs, message}));
  const groups = new Map();
  for (const fixture of fixtures) {
    const group = groups.get(fixture.group) ?? {group:fixture.group, required:0, passed:0, failed:0};
    group.required += 1;
    const item = results.get(fixture.id);
    if (item?.status === 'passed') group.passed += 1;
    else if (item) group.failed += 1;
    groups.set(fixture.group, group);
  }
  const output = verdict === 'compile_error' || verdict === 'unavailable' || verdict === 'busy' || verdict === 'error'
    ? raw.diagnostics.map(({message}) => message).join('\n').slice(0, 4096)
    : '';
  return {verdict, output, passed:sum(rows, 'passed'), failed:sum(rows, 'failed') + sum(rows, 'timeout'),
    passedTests:cases.filter(row => row.status === 'passed').map(row => row.id),
    failedTests:cases.filter(row => row.status !== 'passed').map(row => row.id),
    cases, groups:[...groups.values()], compileMs:raw.compileMs, runtimeMs:raw.runtimeMs, elapsedMs:raw.elapsedMs};
}

export async function runCourseExercise(language, source, exercise, purpose, signal) {
  const full = purpose === 'submit';
  const tests = exercise.tests.filter(fixture => full || fixture.visibility === 'public');
  const typeTests = full ? exercise.typeTests : undefined;
  const fixtures = fixtureMetadata({...exercise, tests, typeTests});
  return presentWorkbenchRun(await runWorkbench({language, source, tests, typeTests, signal}), fixtures);
}
