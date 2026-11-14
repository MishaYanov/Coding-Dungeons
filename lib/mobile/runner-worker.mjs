import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import { response, runWorkbenchSuite } from '../workbench-runner-core.mjs';

const memory = new WebAssembly.Memory({ initial:256, maximum:1_024 });
const variant = newVariant(releaseSync, { wasmLocation:wasmUrl, wasmMemory:memory });
const getQuickJS = () => newQuickJSWASMModuleFromVariant(variant);

self.addEventListener('message', async ({ data }) => {
  try {
    self.postMessage(await runWorkbenchSuite(data, { getQuickJS }));
  } catch {
    self.postMessage(response('runner_error', { diagnostics:[{ message:'The workbench worker could not finish the suite.' }] }));
  }
}, { once:true });
