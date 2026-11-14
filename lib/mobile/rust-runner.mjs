import {rustWasiHarness} from '../standalone-runner-harness.mjs';
import {result} from '../workbench-runner-job.mjs';
import {codeInput} from './input.mjs';
import {loadRustRuntime} from './rust-runtime.mjs';

let active = false;
const startWorker = () => new Worker(new URL('./rust-worker.mjs', import.meta.url), {type:'module'});
const bounded = (value, maximum) => Number.isFinite(value) ? Math.max(25, Math.min(maximum, Math.trunc(value))) : maximum;

function validResult(value, ids) {
  if (!value || typeof value !== 'object' || !['passed','failed','compile_error','runner_error','timeout'].includes(value.status)
    || !Array.isArray(value.tests) || !Array.isArray(value.diagnostics)) return false;
  if (['passed','failed'].includes(value.status)) {
    if (value.tests.length !== ids.length || value.tests.some((test, index) => !test || test.id !== ids[index]
      || !['passed','failed'].includes(test.status) || !Number.isFinite(test.durationMs))) return false;
    if ((value.status === 'passed') !== value.tests.every(test => test.status === 'passed')) return false;
  }
  return true;
}

export async function runRustWorkbench({source, exercise, caseIds = exercise?.testNames, signal, limits = {}}, factory = startWorker) {
  if (signal?.aborted) return result('canceled');
  if (active) return result('busy', 'A Rust workbench run is already in progress.');
  let harness;
  try {
    codeInput({code:source});
    harness = rustWasiHarness(exercise, {portableConstants:true});
    if (!Array.isArray(caseIds) || !caseIds.length || caseIds.length > harness.ids.length
      || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !harness.ids.includes(id))) throw new Error('Invalid cases');
  } catch {
    return result('runner_error', 'The Rust workbench could not start this suite.');
  }
  let worker;
  try { worker = factory(); } catch { return result('runner_error', 'The Rust workbench worker could not start.'); }
  active = true;
  return new Promise(resolve => {
    let finished = false;
    let loading = false;
    const loadController = new AbortController();
    let phaseTimer;
    const finish = value => {
      if (finished) return;
      finished = true;
      loadController.abort();
      active = false;
      clearTimeout(phaseTimer);
      clearTimeout(outerTimer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      resolve(value);
    };
    const infrastructure = () => finish(result('runner_error',
      'The experimental Rust workbench could not finish. Check the World 3 download and try again. If it still stalls, reload the app.'));
    const cancel = () => finish(result('canceled'));
    const outerTimer = setTimeout(infrastructure, bounded(limits.totalMs, 90_000));
    const phase = name => {
      clearTimeout(phaseTimer);
      phaseTimer = setTimeout(name === 'case' ? () => finish(result('timeout', 'The Rust test exceeded its time limit.'))
        : infrastructure, bounded(name === 'case' ? limits.testMs : limits.compileMs, name === 'case' ? 2_000 : 60_000));
    };
    phase('compile');
    signal?.addEventListener('abort', cancel, {once:true});
    worker.addEventListener('error', infrastructure, {once:true});
    worker.addEventListener('messageerror', infrastructure, {once:true});
    worker.addEventListener('message', ({data}) => {
      if (!data || typeof data !== 'object') return infrastructure();
      if (Object.hasOwn(data, 'result')) return validResult(data.result, caseIds) ? finish(data.result) : infrastructure();
      if (data.phase === 'load' && !loading) {
        loading = true;
        void loadRustRuntime(loadController.signal).then(runtime => {
          if (!finished) worker.postMessage(runtime);
        }).catch(() => { if (!finished) infrastructure(); });
        return;
      }
      if (!['compile','link','case'].includes(data.phase)
        || data.phase === 'case' && (!Number.isInteger(data.index) || data.index < 0 || data.index >= caseIds.length)) return infrastructure();
      phase(data.phase);
    });
    try { worker.postMessage({source, harness, caseIds:[...caseIds]}); } catch { infrastructure(); }
  });
}
