// One active workbench job owns a pending load. Completed immutable resources
// can be reused; canceled loads must never poison a later attempt.
export function createRustRuntimeLoader(load) {
  let ready;
  let pending;
  return async signal => {
    signal?.throwIfAborted();
    if (ready) return ready;
    if (!pending) {
      const entry = {controller:new AbortController()};
      pending = entry;
      entry.promise = Promise.resolve().then(() => load(entry.controller.signal)).then(value => {
        if (pending === entry) { ready = value; pending = undefined; }
        return value;
      }, error => {
        if (pending === entry) pending = undefined;
        throw error;
      });
    }
    const entry = pending;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (pending === entry) { pending = undefined; entry.controller.abort(); }
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, {once:true});
      entry.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
    });
  };
}

export const loadRustRuntime = createRustRuntimeLoader(async signal => {
  const module = await import('./rust-compiler.mjs');
  signal.throwIfAborted();
  return module.loadRustRuntime(undefined, signal);
});
