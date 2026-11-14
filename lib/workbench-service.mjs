import { runWorkbench } from './workbench-runner.mjs';
import { fixtureMetadata, presentWorkbenchRun } from './workbench-report.mjs';

export { fixtureMetadata, presentWorkbenchRun, workbenchSummary } from './workbench-report.mjs';

export async function runCourseExercise(language, source, exercise, purpose, signal) {
  const full = purpose === 'submit';
  const tests = exercise.tests.filter(fixture => full || fixture.visibility === 'public');
  const typeTests = full ? exercise.typeTests : undefined;
  const fixtures = fixtureMetadata({...exercise, tests, typeTests});
  return presentWorkbenchRun(await runWorkbench({language, source, tests, typeTests, signal}), fixtures);
}
