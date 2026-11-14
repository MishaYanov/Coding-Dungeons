import {containsGoDirective, goWasiHarness} from '../standalone-runner-harness.mjs';
import {result} from '../workbench-runner-job.mjs';
import {codeInput} from './input.mjs';

let active = false;

export async function runGoWorkbench({source, tests, signal}) {
  if (signal?.aborted) return result('canceled');
  if (active) return result('busy', 'A Go workbench run is already in progress.');
  let harness;
  try {
    codeInput({code:source});
    harness = goWasiHarness(tests);
  } catch {
    return result('runner_error', 'The Go workbench could not start this suite.');
  }
  if (containsGoDirective(source)) return result('compile_error', 'Remove Go compiler directives before running this challenge.');
  let worker;
  try {
    worker = new Worker(new URL('./go-worker.mjs', import.meta.url), {type:'module'});
  } catch {
    return result('runner_error', 'The Go workbench worker could not start.');
  }
  active = true;
  return new Promise(resolve => {
    let finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      active = false;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      resolve(value);
    }
    const cancel = () => finish(result('canceled'));
    const fail = () => finish(result('runner_error', 'The Go workbench is unavailable.'));
    // Bounds downloads and compilation too, but does not count as a wrong answer.
    const deadline = setTimeout(() => finish(result('timeout', 'The Go workbench reached its time limit.')), 35_000);
    signal?.addEventListener('abort', cancel, {once:true});
    worker.addEventListener('message', event => finish(event.data), {once:true});
    worker.addEventListener('error', fail, {once:true});
    worker.addEventListener('messageerror', fail, {once:true});
    try {
      worker.postMessage({source, harness});
    } catch {
      fail();
    }
  });
}
