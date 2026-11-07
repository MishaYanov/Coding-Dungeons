import { Worker } from 'node:worker_threads';

const sourceLimit = 48 * 1024;
const fixtureLimit = 16 * 1024;
const suiteLimit = 128 * 1024;
const fixtureCount = 32;
const fixtureId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function result(status, message) {
  return { status, tests: [], compileMs: 0, runtimeMs: 0, diagnostics: message ? [{ message }] : [] };
}

function limit(value, defaultValue, minimum, maximum) {
  if (!Number.isFinite(value)) return defaultValue;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function normalize(request) {
  const { language, source, tests, typeTests = [], limits = {} } = request ?? {};
  if (!['javascript', 'typescript'].includes(language)) return null;
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > sourceLimit) return null;
  if (!Array.isArray(tests) || !Array.isArray(typeTests)) return null;
  if (typeTests.length && language !== 'typescript') return null;
  const fixtures = [...tests, ...typeTests];
  if (!fixtures.length || fixtures.length > fixtureCount) return null;

  const ids = new Set();
  let total = 0;
  for (const fixture of fixtures) {
    if (typeof fixture?.id !== 'string' || !fixtureId.test(fixture.id) || ids.has(fixture.id)) return null;
    if (typeof fixture.code !== 'string' || !fixture.code.trim()) return null;
    const bytes = Buffer.byteLength(fixture.code);
    if (bytes > fixtureLimit || (total += bytes) > suiteLimit) return null;
    ids.add(fixture.id);
  }

  const copy = ({ id, code }) => ({ id, code });
  return {
    language, source, tests: tests.map(copy), typeTests: typeTests.map(copy),
    limits: {
      timeoutMs: limit(limits?.timeoutMs, 500, 25, 2_000),
      totalMs: limit(limits?.totalMs, 8_000, 100, 15_000),
      memoryBytes: limit(limits?.memoryBytes, 32 * 1024 * 1024, 1024 * 1024, 48 * 1024 * 1024),
    },
  };
}

// Only the engine selects fixtures from its trusted catalog. The worker can be
// terminated even if a compiler operation does not yield to its own limits.
export async function runWorkbench(request) {
  const job = normalize(request);
  if (!job) return result('runner_error', 'The workbench could not start this suite.');
  const { signal } = request;
  if (signal?.aborted) return result('canceled');

  return new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(new URL('./workbench-runner-worker.mjs', import.meta.url), {
        workerData: job,
        execArgv: [],
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch {
      resolve(result('runner_error', 'The workbench worker could not start.'));
      return;
    }

    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate().then(() => resolve(value), () => resolve(value));
    };
    const deadline = setTimeout(() => finish(result('timeout', 'The suite reached its time limit.')), job.limits.totalMs);
    const cancel = () => finish(result('canceled'));
    signal?.addEventListener('abort', cancel, {once:true});
    worker.once('message', finish);
    worker.once('error', () => finish(result('runner_error', 'The workbench worker could not finish the suite.')));
    worker.once('exit', () => finish(result('runner_error', 'The workbench worker exited before reporting results.')));
  });
}
