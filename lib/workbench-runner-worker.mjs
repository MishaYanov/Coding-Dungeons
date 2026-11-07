import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

const pendingJobLimit = 2_048;
const diagnosticLimit = 300;
const submissionModule = 'workbench:submission';
const harnessBuiltins = [
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'Function', 'JSON', 'Map', 'Math',
  'Number', 'Object', 'Promise', 'RangeError', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'SyntaxError',
  'TypeError', 'Uint8Array', 'WeakMap', 'WeakSet',
].join(', ');

function milliseconds(start) {
  return Math.round(performance.now() - start);
}

function response(status, { tests = [], compileMs = 0, runtimeMs = 0, diagnostics = [] } = {}) {
  return { status, tests, compileMs, runtimeMs, diagnostics };
}

function withContext(QuickJS, limits, run) {
  const runtime = QuickJS.newRuntime();
  const deadline = performance.now() + limits.timeoutMs;
  const expired = () => performance.now() >= deadline;
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(320 * 1024);
  runtime.setInterruptHandler(expired);
  try {
    const context = runtime.newContext();
    try {
      return run(context, runtime, expired);
    } finally {
      context.dispose();
    }
  } finally {
    runtime.dispose();
  }
}

function parse(context, source, module) {
  const compiled = context.evalCode(source, submissionModule, { type: module ? 'module' : 'global', compileOnly: true });
  if (compiled.error) {
    try {
      // This error belongs to the engine. Learner code has not run in this context.
      return context.getProp(compiled.error, 'message').consume(handle => context.getString(handle).slice(0, diagnosticLimit));
    } finally {
      compiled.error.dispose();
    }
  }
  compiled.value.dispose();
  return null;
}

// Construct this closure before the submission runs so fixtures keep their
// assertion helpers and built-ins when a learner shadows global names.
function trustedHarness(code, module) {
  const load = module ? `const submission = await import(${JSON.stringify(submissionModule)});` : '';
  return `(() => {
    const { ${harnessBuiltins} } = globalThis;
    const errors = new WeakMap();
    const saveMessage = errors.set.bind(errors);
    const readMessage = errors.get.bind(errors);
    const assert = (condition, message) => {
      if (condition) return;
      const failure = Object.create(null);
      saveMessage(failure, typeof message === 'string' ? message : 'An assertion failed.');
      throw failure;
    };
    for (const builtin of [${harnessBuiltins}]) {
      if (builtin.prototype) Object.freeze(builtin.prototype);
      Object.freeze(builtin);
    }
    return [async () => {\n${load}\n${code}\n}, readMessage];
  })()`;
}

function classifyPromise(context, runtime, expired, promise, readMessage) {
  let jobsRun = 0;
  while (!expired() && jobsRun < pendingJobLimit) {
    const state = context.getPromiseState(promise);
    if (state.type === 'fulfilled') {
      state.value.dispose();
      return { status: 'passed' };
    }
    if (state.type === 'rejected') {
      try {
        const message = context.callFunction(readMessage, context.undefined, state.error);
        if (message.error) {
          message.error.dispose();
          return { status: 'failed', message: 'The test threw an exception.' };
        }
        return message.value.consume(handle => ({
          status: 'failed',
          message: context.typeof(handle) === 'string'
            ? context.getString(handle).slice(0, diagnosticLimit)
            : 'The test threw an exception.',
        }));
      } finally {
        state.error.dispose();
      }
    }

    const jobs = runtime.executePendingJobs(16);
    if (jobs.error) {
      jobs.error.dispose();
      if (!expired()) return { status: 'failed', message: 'An asynchronous operation threw an exception.' };
      break;
    }
    if (!jobs.value) return { status: 'timeout', message: 'The asynchronous test did not settle.' };
    jobsRun += jobs.value;
  }
  return { status: 'timeout', message: 'The test reached its execution limit.' };
}

function runCase(QuickJS, source, module, fixture, limits) {
  return withContext(QuickJS, limits, (context, runtime, expired) => {
    if (module) runtime.setModuleLoader(name => name === submissionModule
      ? source : { error: new Error('The workbench only loads the submission module.') });
    const harness = context.evalCode(trustedHarness(fixture.code, module), 'fixture.js', { type: 'global' });
    if (harness.error) {
      harness.error.dispose();
      throw new Error('Invalid workbench fixture');
    }
    return harness.value.consume(helpers => {
      if (!module) {
        const evaluation = context.evalCode(source, submissionModule, { type: 'global' });
        if (evaluation.error) {
          evaluation.error.dispose();
          return expired()
            ? { status: 'timeout', message: 'The submission reached its execution limit.' }
            : { status: 'failed', message: 'The submission threw an exception before the test started.' };
        }
        evaluation.value.dispose();
      }
      return context.getProp(helpers, 0).consume(test => context.getProp(helpers, 1).consume(readMessage => {
        const execution = context.callFunction(test, context.undefined);
        if (execution.error) {
          execution.error.dispose();
          return expired()
            ? { status: 'timeout', message: 'The test reached its execution limit.' }
            : { status: 'failed', message: 'The test threw an exception.' };
        }
        return execution.value.consume(promise => classifyPromise(context, runtime, expired, promise, readMessage));
      }));
    });
  });
}

async function run({ language, source, tests, typeTests, limits }) {
  const started = performance.now();
  const QuickJS = await getQuickJS();
  let reports = [];
  let module = false;
  if (language === 'typescript') {
    const { compileTypeScript } = await import('./workbench-runner-typescript.mjs');
    const compiled = compileTypeScript(source, typeTests);
    if (compiled.diagnostics.length) {
      return response('compile_error', { compileMs: milliseconds(started), diagnostics: compiled.diagnostics });
    }
    source = compiled.source;
    module = compiled.module;
    reports = compiled.tests;
  }

  const syntax = withContext(QuickJS, limits, context => parse(context, source, module));
  const compileMs = milliseconds(started);
  if (syntax !== null) return response('compile_error', { compileMs, diagnostics: [{ message: syntax }] });

  const runtime = performance.now();
  for (const fixture of tests) {
    const start = performance.now();
    const verdict = runCase(QuickJS, source, module, fixture, limits);
    reports.push({ id: fixture.id, durationMs: milliseconds(start), ...verdict });
    if (verdict.status === 'timeout') break;
  }
  const status = reports.some(report => report.status === 'timeout') ? 'timeout'
    : reports.every(report => report.status === 'passed') ? 'passed' : 'failed';
  return response(status, { tests: reports, compileMs, runtimeMs: milliseconds(runtime) });
}

try {
  parentPort.postMessage(await run(workerData));
} catch {
  parentPort.postMessage(response('runner_error', { diagnostics: [{ message: 'The workbench worker could not finish the suite.' }] }));
}
