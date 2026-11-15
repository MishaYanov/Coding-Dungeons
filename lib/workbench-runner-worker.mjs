import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from './quickjs-runtime.mjs';
import { response, runWorkbenchSuite } from './workbench-runner-core.mjs';

async function compileTypeScript(...options) {
  const compiler = await import('./workbench-runner-typescript.mjs');
  return compiler.compileTypeScript(...options);
}

try {
  parentPort.postMessage(await runWorkbenchSuite(workerData, { getQuickJS, compileTypeScript }));
} catch {
  parentPort.postMessage(response('runner_error', { diagnostics: [{ message: 'The workbench worker could not finish the suite.' }] }));
}
