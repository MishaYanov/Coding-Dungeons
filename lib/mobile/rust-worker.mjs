import {runRustJob} from './rust-compiler.mjs';
import {result} from '../workbench-runner-job.mjs';

let job;
let started = false;
self.addEventListener('message', async ({data}) => {
  if (!job) {
    job = data;
    self.postMessage({phase:'load'});
    return;
  }
  if (started || !(data?.compiler instanceof WebAssembly.Module) || !(data.sysroot instanceof Uint8Array)) return;
  started = true;
  try {
    self.postMessage({result:await runRustJob(job, phase => self.postMessage(phase), undefined, data.compiler, data.sysroot)});
  } catch {
    self.postMessage({result:result('runner_error', 'The experimental Rust workbench is unavailable. Download World 3 and try again.')});
  }
});
