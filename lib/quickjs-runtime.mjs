import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten-core';

// Both editions use the one pinned, patched release-sync variant. Avoid the
// umbrella package, which also brings unused debug and Asyncify interpreters.
let modulePromise;
export function getQuickJS() {
  modulePromise ??= newQuickJSWASMModuleFromVariant(releaseSync).catch(error => {
    modulePromise = undefined;
    throw error;
  });
  return modulePromise;
}
