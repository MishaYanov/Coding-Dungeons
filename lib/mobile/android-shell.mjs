import {mobileBackupLimit} from './input.mjs';

const androidOrigin = 'https://appassets.androidplatform.net';
const pendingBridges = new WeakSet();
const encoder = new TextEncoder();

export function isAndroidShell(host = globalThis) {
  return host?.location?.origin === androidOrigin && typeof host?.dungeonsSave?.postMessage === 'function';
}

export function createAndroidBackupSaver(host = globalThis, {
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  return async function saveBackup({filename, text, signal}) {
    signal?.throwIfAborted();
    if (!isAndroidShell(host)) throw new Error('Backup saving is unavailable outside the Android app.');
    if (typeof filename !== 'string' || filename.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename)) {
      throw new Error('Choose a safe JSON backup filename.');
    }
    if (typeof text !== 'string') throw new Error('Backup text must be a string.');
    if (text.length > mobileBackupLimit || encoder.encode(text).length > mobileBackupLimit) {
      throw new Error('The backup exceeds the 16 MiB transfer limit.');
    }
    const bridge = host.dungeonsSave;
    if (pendingBridges.has(bridge)) throw new Error('A backup save is already in progress.');
    const id = host.crypto.randomUUID();
    const payload = JSON.stringify({id, type:'save-backup', filename, text});
    pendingBridges.add(bridge);

    return new Promise((resolve, reject) => {
      const previous = bridge.onmessage;
      let settled = false;
      let timer;
      function finish(error, status) {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        host.removeEventListener('pagehide', departed);
        signal?.removeEventListener('abort', aborted);
        if (bridge.onmessage === received) bridge.onmessage = previous;
        pendingBridges.delete(bridge);
        if (error) reject(error);
        else resolve(status);
      }
      function aborted() {
        finish(signal.reason ?? new DOMException('Backup export was canceled.', 'AbortError'));
      }
      function departed() {
        finish(new DOMException('Backup export was canceled because the app closed.', 'AbortError'));
      }
      function received(event) {
        // Native replies arrive on this bridge, never through window.postMessage.
        if (!isAndroidShell(host) || host.dungeonsSave !== bridge ||
            (event?.origin && event.origin !== androidOrigin) ||
            typeof event?.data !== 'string' || event.data.length > 512) return;
        let reply;
        try { reply = JSON.parse(event.data); } catch { return; }
        if (!reply || typeof reply !== 'object' || Array.isArray(reply) || reply.id !== id ||
            !['saved', 'canceled', 'error'].includes(reply.status)) return;
        if (reply.status === 'error') finish(new Error('The backup could not be saved. Please try again.'));
        else finish(null, reply.status);
      }
      try {
        bridge.onmessage = received;
        host.addEventListener('pagehide', departed, {once:true});
        signal?.addEventListener('abort', aborted, {once:true});
        timer = setTimer(() => finish(new Error('Saving the backup timed out. Check the file picker before trying again.')), 300_000);
        if (signal?.aborted) aborted();
        else bridge.postMessage(payload);
      } catch (error) {
        finish(error);
      }
    });
  };
}

export const saveAndroidBackup = createAndroidBackupSaver();
