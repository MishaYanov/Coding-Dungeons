/* global offline */
const shellPrefix = 'coding-dungeons-mobile-shell-';
const worldPrefix = 'coding-dungeons-mobile-world-';
const shellCache = shellPrefix + offline.shellVersion;
const shellFiles = new Set(offline.shellFiles);
const integrity = offline.integrity ?? {};
const worlds = new Map(Object.entries(offline.worlds).map(([id, world]) => {
  // Reuse an unchanged World 1 download from the single-world app.
  const prefix = id === 'javascript' ? worldPrefix : `${worldPrefix}${id}-`;
  return [id, {...world, prefix, cache:prefix + world.version}];
}));
const worldCaches = new Map([...worlds.values()].flatMap(world => world.files.map(path => [path, world.cache])));

function requests(files) {
  return [...files].map(path => new Request(new URL(path, self.location.origin), {cache:'reload', redirect:'error'}));
}

async function verify(response, path) {
  if (!response.ok || response.redirected) throw new Error('Runtime asset could not load.');
  const expected = integrity[path];
  if (expected) {
    const bytes = await response.clone().arrayBuffer();
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) throw new Error('Runtime asset integrity check failed.');
  }
  return response;
}

async function fetchAsset(request) {
  return verify(await fetch(new Request(request, {redirect:'error'})), new URL(request.url).pathname);
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

const downloads = new Map();

async function hasWorld(world) {
  if (!await caches.has(world.cache)) return false;
  const cache = await caches.open(world.cache);
  const cached = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
  return world.files.every(path => cached.has(path));
}

function downloadWorld(world) {
  if (downloads.has(world.cache)) return downloads.get(world.cache);
  const pending = (async () => {
    const cache = await caches.open(world.cache);
    await cache.addAll(requests(world.files.filter(path => !integrity[path])));
    // Hash one runtime asset at a time, keeping a large compiler download bounded.
    for (const request of requests(world.files.filter(path => integrity[path]))) {
      await cache.put(request, await fetchAsset(request));
    }
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(world.prefix) && name !== world.cache
      && /^[0-9a-f]{16}$/.test(name.slice(world.prefix.length)))
      .map(name => caches.delete(name)));
  })().finally(() => downloads.delete(world.cache));
  downloads.set(world.cache, pending);
  return pending;
}

self.addEventListener('message', event => {
  const port = event.ports[0];
  const world = worlds.get(event.data?.world ?? 'javascript');
  if (!port || !world || !['world-status', 'download-world'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'download-world' && !await hasWorld(world)) await downloadWorld(world);
      port.postMessage({ready:await hasWorld(world)});
    } catch {
      port.postMessage({error:`World ${world.number} could not finish downloading. Check your connection and free space, then try again.`});
    }
  })());
});

self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(caches.open(shellCache).then(async cache => await cache.match('/index.html') || fetch(request)));
    return;
  }
  const name = shellFiles.has(url.pathname) ? shellCache : worldCaches.get(url.pathname);
  if (name) {
    event.respondWith((async () => {
      if (!await caches.has(name)) return fetchAsset(request);
      const cache = await caches.open(name);
      const cached = await cache.match(url.pathname);
      if (!cached) return fetchAsset(request);
      try {
        return await verify(cached, url.pathname);
      } catch (error) {
        await cache.delete(url.pathname);
        throw error;
      }
    })());
  }
});
