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
const worldByFile = new Map([...worlds.values()].flatMap(world => world.files.map(path => [path, world])));
const completeKey = new URL('/.coding-dungeons/offline-world-complete', self.location.origin).href;
const downloads = new Map();

function requests(files) {
  return [...files].map(path => new Request(new URL(path, self.location.origin), {cache:'reload', redirect:'error'}));
}

const expectedHash = (world, path) => integrity[path] ?? world?.hashes?.[path];

async function verify(response, expected) {
  if (!response.ok || response.redirected) throw new Error('Runtime asset could not load.');
  if (expected) {
    const bytes = await response.clone().arrayBuffer();
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) throw new Error('Runtime asset integrity check failed.');
  }
  return response;
}

async function fetchAsset(request, expected) {
  const full = new Request(request, {redirect:'error'});
  // Validate the full resource even if a PDF viewer asks for one range.
  if (expected) full.headers.delete('range');
  return verify(await fetch(full), expected);
}

function previousNames(world, names) {
  return names.filter(name => name !== world.cache && name.startsWith(world.prefix)
    && /^[0-9a-f]{16}$/.test(name.slice(world.prefix.length))).reverse();
}

async function hasWorld(world) {
  if (!await caches.has(world.cache)) return false;
  const cache = await caches.open(world.cache);
  const marker = await cache.match(completeKey);
  if (marker && await marker.text() !== 'ready') return false;
  const cached = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
  return world.files.every(path => cached.has(path));
}

async function hasPreviousDownload(world) {
  for (const name of previousNames(world, await caches.keys())) {
    const cache = await caches.open(name);
    const marker = await cache.match(completeKey);
    if (marker) {
      if (await marker.text() === 'ready') return true;
      continue;
    }
    const paths = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
    // Legacy workers wrote the book in one batch, before compiler assets.
    // Recognize that download even if this edition adds pages or a runner.
    if (world.files.every(path => paths.has(path)) || world.files.some(path => path.endsWith('.pdf') && paths.has(path))) return true;
  }
  return false;
}

async function verifiedMatch(cache, request, expected) {
  const response = await cache.match(request);
  if (!response) return null;
  try {
    return await verify(response, expected);
  } catch {
    return null;
  }
}

function downloadWorld(world) {
  if (downloads.has(world.cache)) return downloads.get(world.cache);
  const pending = (async () => {
    const cache = await caches.open(world.cache);
    await cache.put(completeKey, new Response('pending'));
    const previous = await Promise.all(previousNames(world, await caches.keys()).map(name => caches.open(name)));
    // Stage a file at a time, allowing partial downloads to resume without
    // refetching bytes that already match this edition.
    for (const request of requests(world.files)) {
      const path = new URL(request.url).pathname;
      const expected = expectedHash(world, path);
      if (await verifiedMatch(cache, request, expected)) continue;
      let response;
      if (expected) {
        for (const old of previous) {
          response = await verifiedMatch(old, request, expected);
          if (response) break;
        }
      }
      await cache.put(request, response ?? await fetchAsset(request, expected));
    }
    await cache.put(completeKey, new Response('ready'));
  })().finally(() => downloads.delete(world.cache));
  downloads.set(world.cache, pending);
  return pending;
}

async function discardPrevious(world) {
  await Promise.all(previousNames(world, await caches.keys()).map(name => caches.delete(name)));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    await cache.addAll(requests(shellFiles));
    // Keep the old shell and its downloaded worlds together if an upgrade
    // cannot finish. The browser keeps the active worker on an install failure.
    for (const world of worlds.values()) {
      if (!await hasWorld(world) && await hasPreviousDownload(world)) await downloadWorld(world);
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(shellPrefix) && name !== shellCache)
      .map(name => caches.delete(name)));
    for (const world of worlds.values()) {
      if (await hasWorld(world)) await discardPrevious(world);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const port = event.ports[0];
  const world = worlds.get(event.data?.world ?? 'javascript');
  if (!port || !world || !['world-status', 'download-world'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'download-world' && !await hasWorld(world)) {
        await downloadWorld(world);
        await discardPrevious(world);
      }
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
  const world = worldByFile.get(url.pathname);
  const name = shellFiles.has(url.pathname) ? shellCache : world?.cache;
  if (name) {
    event.respondWith((async () => {
      const path = url.pathname;
      const expected = expectedHash(world, path);
      if (!await caches.has(name)) return fetchAsset(request, expected);
      const cache = await caches.open(name);
      const cached = await cache.match(path);
      if (cached) {
        try {
          return await verify(cached, expected);
        } catch {
          await cache.delete(path);
        }
      }
      const repaired = await fetchAsset(new Request(request, {cache:'reload'}), expected);
      // A valid online response is still usable if storage is full.
      if (world) await cache.put(path, repaired.clone()).catch(() => {});
      return repaired;
    })());
  }
});
