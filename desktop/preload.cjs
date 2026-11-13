const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codingDungeonsStorage', {
  get: (key) => ipcRenderer.sendSync('ferrum-reader:get', key),
  set: (key, value) => ipcRenderer.sendSync('ferrum-reader:set', key, value),
  removeHero: (id) => ipcRenderer.sendSync('ferrum-reader:remove-hero', id),
});

document.addEventListener('click', (event) => {
  if (!event.isTrusted || event.button !== 0 || event.defaultPrevented) return;
  const anchor = event.target?.closest?.('a.page-hotspot[target="_blank"]');
  if (!anchor) return;
  event.preventDefault();
  ipcRenderer.send('ferrum-reader:open-link', anchor.href);
});
