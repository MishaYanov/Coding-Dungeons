import { normalizeWorkbenchJob, result } from '../workbench-runner-job.mjs';

function createWorker() {
  return new Worker(new URL('./runner-worker.mjs', import.meta.url), { type: 'module' });
}

export async function runBrowserWorkbench(request, startWorker = createWorker) {
  const job = normalizeWorkbenchJob(request);
  if (!job || job.language !== 'javascript') {
    return result('runner_error', 'The workbench could not start this JavaScript suite.');
  }
  const { signal } = request;
  if (signal?.aborted) return result('canceled');

  return new Promise(resolve => {
    let worker;
    try {
      worker = startWorker();
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
      worker.terminate();
      resolve(value);
    };
    const failed = () => finish(result('runner_error', 'The workbench worker could not finish the suite.'));
    const deadline = setTimeout(() => finish(result('timeout', 'The suite reached its time limit.')), job.limits.totalMs);
    const cancel = () => finish(result('canceled'));
    signal?.addEventListener('abort', cancel, { once:true });
    worker.addEventListener('message', event => finish(event.data), { once:true });
    worker.addEventListener('error', failed, { once:true });
    worker.addEventListener('messageerror', failed, { once:true });
    try {
      worker.postMessage(job);
    } catch {
      failed();
    }
  });
}
