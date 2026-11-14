import { Worker } from 'node:worker_threads';
import { normalizeWorkbenchJob, result } from './workbench-runner-job.mjs';

// Only the engine selects fixtures from its trusted catalog. The worker can be
// terminated even if a compiler operation does not yield to its own limits.
export async function runWorkbench(request) {
  const job = normalizeWorkbenchJob(request);
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
