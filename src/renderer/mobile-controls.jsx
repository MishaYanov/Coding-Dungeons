import React, {useEffect, useRef, useState} from 'react';
import {mobileBackupLimit} from '../../lib/mobile/input.mjs';
import {isAndroidShell, saveAndroidBackup} from '../../lib/mobile/android-shell.mjs';
import {getMobileEngine} from './mobile-engine.mjs';
import rustInfo from 'virtual:mobile-rust-info';
import './mobile-controls.css';

const backupSizeMessage = 'The backup exceeds the 16 MiB transfer limit.';
const partialRestore = 'Heroes were restored. This browser could not restore some drafts or reading positions.';
const backupNotice = 'coding-dungeons-mobile-backup-notice';
let workerRegistration;

function registerOfflineWorker() {
  workerRegistration ??= navigator.serviceWorker.register('/sw.js').catch(error => {
    workerRegistration = undefined;
    throw error;
  });
  return workerRegistration;
}

async function requestWorker(type, world) {
  const registration = await registerOfflineWorker();
  const active = navigator.serviceWorker.controller ?? registration.active;
  const worker = active?.state === 'activated' ? active : (await navigator.serviceWorker.ready).active;
  if (!worker) throw new Error('The offline installer is still starting.');
  const {port1, port2} = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      port1.close();
      reject(new Error(`World ${world.number} could not finish downloading. Please try again.`));
    }, type === 'download-world' ? 600_000 : 30_000);
    port1.onmessage = ({data}) => {
      clearTimeout(timer);
      port1.close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.ready);
    };
    worker.postMessage({type, world:world.id}, [port2]);
  });
}

export function MobileControls({game}) {
  const world = game.world;
  const worldLabel = 'World ' + world.number;
  const androidShell = isAndroidShell();
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);
  const lifetime = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(backupNotice)) {
        setMessage(partialRestore);
        sessionStorage.removeItem(backupNotice);
      }
    } catch {
      // Browser session storage is optional.
    }
  }, []);

  useEffect(() => {
    if (androidShell) {
      setStarting(false);
      return;
    }
    if (!navigator.serviceWorker) {
      setMessage('Offline downloads require HTTPS or localhost.');
      setStarting(false);
      return;
    }
    let current = true;
    const check = () => {
      void requestWorker('world-status', world).then(value => {
        if (current) setReady(value);
      }).catch(() => {
        if (current) setMessage('Offline downloads could not start. Reload or try again.');
      }).finally(() => {
        if (current) setStarting(false);
      });
    };
    check();
    navigator.serviceWorker.addEventListener('controllerchange', check);
    return () => {
      current = false;
      navigator.serviceWorker.removeEventListener('controllerchange', check);
    };
  }, [world, androidShell]);

  async function download() {
    if (busy) return;
    setBusy('download');
    setMessage('');
    try {
      if (!await requestWorker('download-world', world)) throw new Error(`${worldLabel} did not finish downloading.`);
      setReady(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  async function exportBackup() {
    if (busy) return;
    const signal = lifetime.current?.signal;
    setBusy('export');
    setMessage('');
    try {
      const backup = await (await getMobileEngine(world.id)).exportBackup();
      signal?.throwIfAborted();
      const text = JSON.stringify(backup);
      const filename = `coding-dungeons-world-${world.number}-backup.json`;
      if (androidShell) {
        const status = await saveAndroidBackup({filename, text, signal});
        signal?.throwIfAborted();
        setMessage(status === 'saved' ? 'Backup saved.' : 'Backup save canceled.');
        return;
      }
      const blob = new Blob([text], {type:'application/json'});
      if (blob.size > mobileBackupLimit) throw new Error(backupSizeMessage);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
      setMessage('Backup downloaded.');
    } catch (error) {
      if (!signal?.aborted) setMessage(error.message);
    } finally {
      if (!signal?.aborted) setBusy('');
    }
  }

  async function importBackup(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy || game.hero) return;
    setBusy('import');
    setMessage('');
    try {
      if (file.size > mobileBackupLimit) throw new Error(backupSizeMessage);
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error(`Choose a Coding Dungeons ${worldLabel} JSON backup.`);
      }
      const {readerRestored} = await (await getMobileEngine(world.id)).importBackup(backup);
      if (!readerRestored) {
        try {
          sessionStorage.setItem(backupNotice, '1');
        } catch {
          window.alert(partialRestore);
        }
      }
      location.reload();
    } catch (error) {
      setMessage(error.message);
      setBusy('');
    }
  }

  return (
    <section className="mobile-offline" aria-label="Offline world and backups">
      {androidShell ? <span role="status">{worldLabel} included offline</span> : ready ? <span role="status">{worldLabel} ready offline</span> : <button type="button" className="button button-quiet"
        onClick={download} disabled={starting || Boolean(busy)}>
        {busy === 'download' ? `Downloading ${worldLabel}…` : `Download ${worldLabel}`}
      </button>}
      {world.id === 'rust' && rustInfo && <p className="fine-print">
        Includes the experimental Rust {rustInfo.version} Workbench.
        {' '}{androidShell ? 'Code tests run offline using the workbench included in the app.' : `After downloading ${worldLabel}, code tests run offline.`}
        {' '}{androidShell ? 'The bundled workbench uses about 152 MiB.' : 'The workbench adds about 152 MiB.'}
        {' '}Some Rust features are unavailable; 2 GB phones are not yet verified.
      </p>}
      {world.id === 'csharp' && <p className="fine-print">
        Read the book, answer checkpoints, and save code drafts offline. Run the field kit on a computer with the .NET 10 SDK.
      </p>}
      <details>
        <summary>Save backup</summary>
        <div>
          <button type="button" className="button button-quiet" disabled={Boolean(busy)} onClick={exportBackup}>Export backup</button>
          {!game.hero && <button type="button" className="button button-quiet" disabled={Boolean(busy)}
            onClick={() => fileInput.current?.click()}>Import into empty {worldLabel}</button>}
          <input ref={fileInput} type="file" hidden accept=".json,application/json" onChange={importBackup} />
        </div>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
