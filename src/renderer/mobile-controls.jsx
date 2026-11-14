import React, {useEffect, useRef, useState} from 'react';
import {mobileBackupLimit} from '../../lib/mobile/input.mjs';
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
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);

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
  }, [world]);

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
    setBusy('export');
    setMessage('');
    try {
      const backup = await (await getMobileEngine(world.id)).exportBackup();
      const blob = new Blob([JSON.stringify(backup)], {type:'application/json'});
      if (blob.size > mobileBackupLimit) throw new Error(backupSizeMessage);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `coding-dungeons-world-${world.number}-backup.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
      setMessage('Backup downloaded.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
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
      {ready ? <span role="status">{worldLabel} ready offline</span> : <button type="button" className="button button-quiet"
        onClick={download} disabled={starting || Boolean(busy)}>
        {busy === 'download' ? `Downloading ${worldLabel}…` : `Download ${worldLabel}`}
      </button>}
      {world.id === 'rust' && rustInfo && <p className="fine-print">
        Includes the experimental Rust {rustInfo.version} Workbench. After downloading World 3, code tests run offline.
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
