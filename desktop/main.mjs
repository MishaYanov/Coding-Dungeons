import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, utilityProcess } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { trustedBookLinks } from './book-links.mjs';
import { waitForEngine } from './engine-lifecycle.mjs';
import { exportSaves, importSaves } from './save-transfer.mjs';
import { openReaderStorage } from './reader-storage.mjs';
import { discoverRuntime } from './runtime-config.mjs';
import { engineEnvironment, engineHeaders, isEngineUrl } from './window-policy.mjs';

let engine;
let mainWindow;
let stopping;
let saveTransferActive = false;
let readerStorage;

function localSession(origin, token) {
  const partition = session.fromPartition('coding-dungeons', {cache: false});
  partition.setPermissionCheckHandler(() => false);
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setDevicePermissionHandler(() => false);
  partition.webRequest.onBeforeRequest(({url}, callback) => callback({cancel: !isEngineUrl(url, origin)}));
  partition.webRequest.onBeforeSendHeaders(({url, requestHeaders}, callback) => {
    callback({requestHeaders: engineHeaders(url, origin, token, requestHeaders)});
  });
  return partition;
}

function registerReaderActions(window, origin, directory, links) {
  readerStorage = openReaderStorage(directory);
  const contents = window.webContents;
  const isReader = (event) => event.sender === contents && event.senderFrame === contents.mainFrame
    && isEngineUrl(event.senderFrame?.url, origin);
  ipcMain.on('ferrum-reader:get', (event, key) => {
    event.returnValue = isReader(event) ? readerStorage.get(key) : null;
  });
  ipcMain.on('ferrum-reader:set', (event, key, value) => {
    event.returnValue = isReader(event) && readerStorage.set(key, value);
  });
  ipcMain.on('ferrum-reader:open-link', (event, url) => {
    if (!isReader(event) || !links.has(url)) return;
    void shell.openExternal(url).catch(() => {
      dialog.showErrorBox('Coding Dungeons', 'Your default browser could not open this book reference.');
    });
  });
}

async function showRuntimeDiagnostics(origin, token, runtime) {
  const window = mainWindow;
  const component = (label, included) => `${label} · ${included ? 'Included' : 'Missing'}`;
  const detail = [
    component('JavaScript engine', runtime.available.javascript),
    component('TypeScript and JavaScript tools', runtime.available.typescript),
    component('Offline GM model and executable', runtime.available.model),
    component('Rust sandbox files', runtime.nativeLanguages.includes('rust')),
    component('Go sandbox files', runtime.nativeLanguages.includes('go')),
    '',
  ];
  const statuses = await Promise.all([['Rust', 'rust'], ['Go', 'go']].map(async ([label, world]) => {
    try {
      const response = await fetch(`${origin}/api/status`, {
        headers: {'X-Ferrum-Desktop-Token': token, 'X-Ferrum-World': world},
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error('Status request failed.');
      const status = await response.json();
      return `${label} runner · ${status.runner === 'available' ? 'Ready' : status.runnerDetail || 'Unavailable'}`;
    } catch {
      return `${label} runner · Could not check the local engine.`;
    }
  }));
  if (!window || window.isDestroyed()) return;
  await dialog.showMessageBox(window, {
    message: `Coding Dungeons ${app.getVersion()} runtime diagnostics`,
    detail: [...detail, ...statuses].join('\n'),
  });
}

async function start() {
  const appPath = app.getAppPath();
  const userData = app.getPath('userData');
  if (!existsSync(join(appPath, 'dist', 'renderer', 'index.html'))) {
    throw new Error('The desktop reader bundle is missing. Reinstall Coding Dungeons or run npm run desktop:bundle in a development checkout.');
  }
  const runtimeDirectory = app.isPackaged
    ? join(process.resourcesPath, 'runtime')
    : join(appPath, 'desktop', 'runtime');
  const runtime = discoverRuntime(runtimeDirectory);
  const token = randomBytes(32).toString('hex');
  const worker = utilityProcess.fork(join(appPath, 'server.mjs'), [], {
    env: engineEnvironment({appPath, userData, token, model: runtime.model, nativeRunner: runtime.nativeRunner}),
    serviceName: 'Coding Dungeons local engine',
  });
  engine = worker;
  let origin;
  worker.once('exit', (code) => {
    engine = undefined;
    if (stopping || !origin) return;
    dialog.showErrorBox('Coding Dungeons', `The local engine stopped unexpectedly (${code}). Reopen the app to continue.`);
    app.quit();
  });
  origin = await waitForEngine(worker);

  mainWindow = new BrowserWindow({
    title: 'Coding Dungeons',
    width: 1360,
    height: 900,
    minWidth: 550,
    minHeight: 620,
    show: false,
    backgroundColor: '#101821',
    webPreferences: {
      session: localSession(origin, token),
      preload: join(appPath, 'desktop', 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!isEngineUrl(event.url, origin)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (saveTransferActive) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  registerReaderActions(mainWindow, origin, join(userData, 'reader'), await trustedBookLinks(appPath));
  await mainWindow.loadURL(origin);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Saves',
      submenu: [
        {label: 'Import existing saves…', click: () => void transferSaves('import')},
        {label: 'Export save backup…', click: () => void transferSaves('export')},
        {type: 'separator'},
        {role: 'quit'},
      ],
    },
    {
      label: 'Help',
      submenu: [{
        label: 'Runtime diagnostics',
        click: () => void showRuntimeDiagnostics(origin, token, runtime),
      }],
    },
  ]));
}

function stopEngine() {
  if (stopping) return stopping;
  const worker = engine;
  if (!worker) return Promise.resolve();
  stopping = new Promise((resolve, reject) => {
    const force = setTimeout(() => worker.kill(), 2_000);
    const deadline = setTimeout(() => {
      worker.off('exit', exited);
      reject(new Error('The local engine did not shut down.'));
    }, 4_000);
    function exited() {
      clearTimeout(force);
      clearTimeout(deadline);
      resolve();
    }
    worker.once('exit', exited);
  });
  try {
    worker.postMessage({type: 'ferrum-shutdown'});
  } catch {
    worker.kill();
  }
  return stopping;
}

function beforeQuit(event) {
  if (saveTransferActive || engine) event.preventDefault();
  if (!saveTransferActive && engine) {
    void stopEngine().then(() => app.quit(), () => app.exit(1));
  }
}

async function transferSaves(action) {
  const window = mainWindow;
  if (!window || saveTransferActive || stopping) return;
  saveTransferActive = true;
  let restart = false;
  try {
    const importing = action === 'import';
    const {canceled, filePaths} = await dialog.showOpenDialog(window, {
      title: importing ? 'Choose the folder containing your save files' : 'Choose a folder for the backup',
      properties: ['openDirectory'],
    });
    if (canceled) return;
    const selected = filePaths[0];
    const statePath = join(app.getPath('userData'), 'state');
    if (importing) {
      const {response} = await dialog.showMessageBox(window, {
        type: 'question',
        message: 'Import saves into empty worlds?',
        detail: 'Worlds with heroes already saved will be skipped. The app will reopen after the import.',
        buttons: ['Import and reopen', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
      restart = true;
      await stopEngine();
      const {imported, skipped} = await importSaves(selected, statePath);
      await dialog.showMessageBox(window, {
        message: `Imported ${imported.length} world saves. Skipped ${skipped.length} occupied worlds.`,
      });
    } else {
      const backup = await exportSaves(statePath, selected);
      await dialog.showMessageBox(window, {message: 'Save backup created.', detail: backup.directory});
    }
  } catch (error) {
    await dialog.showMessageBox(window, {type: 'error', message: error.message});
  } finally {
    saveTransferActive = false;
    if (restart) {
      app.relaunch();
      app.quit();
    }
  }
}

if (squirrelStartup || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.squirrel.CodingDungeons.Coding Dungeons');
  app.commandLine.appendSwitch('disable-background-networking');
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', beforeQuit);
  app.on('will-quit', () => readerStorage?.close());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    return start();
  }).catch((error) => {
    if (stopping) return;
    dialog.showErrorBox('Coding Dungeons could not start', error.message);
    app.quit();
  });
}
