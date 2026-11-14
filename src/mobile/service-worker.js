/* global offline */
const shellPrefix = 'coding-dungeons-mobile-shell-';
const worldPrefix = 'coding-dungeons-mobile-world-';
const shellCache = shellPrefix + offline.shellVersion;
const worldCache = worldPrefix + offline.worldVersion;
const shellFiles = new Set(offline.shellFiles);
const worldFiles = new Set(offline.worldFiles);

function requests(files) {
  return [...files].map(path => new Request(new URL(path, self.location.origin), {cache:'reload'}));
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(shellCache).then(cache => cache.addAll(requests(shellFiles))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(shellPrefix) && name !== shellCache)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

let downloading;

async function hasWorld() {
  if (!await caches.has(worldCache)) return false;
  const cache = await caches.open(worldCache);
  const cached = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
  return [...worldFiles].every(path => cached.has(path));
}

function downloadWorld() {
  downloading ??= (async () => {
    const cache = await caches.open(worldCache);
    await cache.addAll(requests(worldFiles));
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(worldPrefix) && name !== worldCache)
      .map(name => caches.delete(name)));
  })().finally(() => { downloading = undefined; });
  return downloading;
}

self.addEventListener('message', event => {
  const port = event.ports[0];
  if (!port || !['world-status', 'download-world'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'download-world' && !await hasWorld()) await downloadWorld();
      port.postMessage({ready:await hasWorld()});
    } catch {
      port.postMessage({error:'World 1 could not finish downloading. Check your connection and free space, then try again.'});
    }
  })());
});

self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(caches.open(shellCache).then(async cache => await cache.match('/index.html') || fetch(request)));
  } else if (shellFiles.has(url.pathname) || worldFiles.has(url.pathname)) {
    const name = shellFiles.has(url.pathname) ? shellCache : worldCache;
    event.respondWith(caches.open(name).then(async cache => await cache.match(url.pathname) || fetch(request)));
  }
});
