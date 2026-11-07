import { engineOrigin } from './window-policy.mjs';

export function waitForEngine(worker, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The local engine timed out during startup.'));
    }, timeout);
    const onExit = (code) => {
      cleanup();
      reject(new Error(`The local engine exited during startup (${code}).`));
    };
    const onMessage = (message) => {
      const origin = engineOrigin(message);
      if (!origin) return;
      cleanup();
      resolve(origin);
    };
    function cleanup() {
      clearTimeout(timer);
      worker.off('exit', onExit);
      worker.off('message', onMessage);
    }
    worker.on('message', onMessage);
    worker.once('exit', onExit);
  });
}
