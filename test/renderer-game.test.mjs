import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createGame } from '../src/renderer/game.mjs';

const rememberedHero = { id: 'remembered', name: 'Remembered Hero', lastPage: 1 };
const chosenHero = { id: 'chosen', name: 'Chosen Hero', lastPage: 3 };
const selectionKey = 'ferrum-selected-hero-v1';
const positionKey = 'ferrum-last-page-v2';

function deferredResponse() {
  const requested = Promise.withResolvers();
  const response = Promise.withResolvers();
  return {
    requested: requested.promise,
    resolve: response.resolve,
    wait() {
      requested.resolve();
      return response.promise;
    },
  };
}

function fixture(t, intercept = () => undefined) {
  const location = { search: '?world=rust', hash: '',
    get href() { return `http://127.0.0.1:4173/${this.search}${this.hash}`; } };
  const sessionStorage = new Map([[selectionKey, rememberedHero.id]]);
  const localStorage = new Map();
  const requests = [];
  const store = (map) => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  });
  const globals = {
    location,
    history: { replaceState(_state, _title, url) { location.hash = new URL(url, location.href).hash; } },
    sessionStorage: store(sessionStorage),
    localStorage: store(localStorage),
    window: {},
    async fetch(path, { headers, body, method }) {
      const heroId = headers['X-Ferrum-Hero'];
      const request = { path, heroId, method, body: body && JSON.parse(body) };
      requests.push(request);
      const result = intercept(request);
      if (result !== undefined) return await result;
      if (path === '/api/worlds') return Response.json({ worlds: [{ id: 'rust', name: 'Rust' }] });
      if (path === '/api/campaign') return Response.json({ total: 20 });
      if (path === '/api/status') return Response.json({ runner: 'available' });
      if (path === '/api/heroes/load') return Response.json({ hero: rememberedHero });
      if (path === '/api/heroes') return Response.json({ hero: chosenHero });
      if (path === '/api/progress') {
        const hero = heroId === rememberedHero.id ? rememberedHero : chosenHero;
        return Response.json({ profile: { callsign: hero.name, lastPage: hero.lastPage } });
      }
      if (path.startsWith('/api/pages/')) return Response.json({ page: Number(path.split('/').at(-1)), total: 20 });
      if (path === '/api/profile' || path.startsWith('/api/diamond?')) return Response.json({});
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  };
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { ...createGame(), location, localStorage, sessionStorage, requests };
}

test('a delayed startup restore cannot replace an explicitly chosen hero or save their page to the old hero', async (t) => {
  const restore = deferredResponse();
  const game = fixture(t, ({ path }) => path === '/api/heroes/load' ? restore.wait() : undefined);
  const boot = game.actions.boot();
  await restore.requested;

  game.actions.openDialog('hero');
  assert.equal(game.getSnapshot().dialog, 'hero');
  await game.actions.selectHero('/api/heroes', { name: chosenHero.name });
  assert.equal(game.getSnapshot().hero.id, chosenHero.id);

  restore.resolve(Response.json({ hero: rememberedHero }));
  await boot;

  assert.equal(game.getSnapshot().hero.id, chosenHero.id);
  assert.equal(game.getSnapshot().page.page, chosenHero.lastPage);
  assert.equal(game.sessionStorage.get(selectionKey), chosenHero.id);
  assert.equal(game.localStorage.has(`${positionKey}:${rememberedHero.id}`), false);
  assert.equal(game.requests.some(({ path, heroId }) => path === '/api/profile' && heroId === rememberedHero.id), false);
});

test('a stale startup progress response cannot redirect the manually chosen hero', async (t) => {
  const progress = deferredResponse();
  const game = fixture(t, ({ path, heroId }) => path === '/api/progress' && heroId === rememberedHero.id
    ? progress.wait() : undefined);
  game.localStorage.set(`${positionKey}:${rememberedHero.id}`, '7');
  const boot = game.actions.boot();
  await progress.requested;
  await game.actions.selectHero('/api/heroes', { name: chosenHero.name });

  progress.resolve(Response.json({ profile: rememberedHero }));
  await boot;

  assert.equal(game.getSnapshot().hero.id, chosenHero.id);
  assert.equal(game.getSnapshot().page.page, chosenHero.lastPage);
  assert.equal(game.location.hash, `#page=${chosenHero.lastPage}`);
  assert.equal(game.requests.some(({ path }) => path === '/api/pages/7'), false);
});

test('a late startup restore failure cannot reopen the hero picker or clear the chosen hero', async (t) => {
  const restore = deferredResponse();
  const game = fixture(t, ({ path }) => path === '/api/heroes/load' ? restore.wait() : undefined);
  const boot = game.actions.boot();
  await restore.requested;
  await game.actions.selectHero('/api/heroes', { name: chosenHero.name });

  restore.resolve(Response.json({ error: 'No such hero' }, { status: 404 }));
  await boot;

  assert.equal(game.getSnapshot().dialog, null);
  assert.equal(game.getSnapshot().hero.id, chosenHero.id);
  assert.equal(game.sessionStorage.get(selectionKey), chosenHero.id);
});

test('Back after a failed page fetch shows the previous page without refetching it', async (t) => {
  const game = fixture(t, ({ path }) => path === '/api/pages/2'
    ? Response.json({ error: 'Page request failed' }, { status: 500 }) : undefined);
  await game.actions.boot();
  game.location.hash = '#page=2';
  await game.actions.loadPage(2);
  assert.equal(game.getSnapshot().pageError, 2);

  game.location.hash = '#page=1';
  game.actions.readHash();

  assert.equal(game.getSnapshot().loading, false);
  assert.equal(game.getSnapshot().pageError, null);
  assert.equal(game.getSnapshot().page.page, 1);
  assert.equal(game.requests.filter(({ path }) => path === '/api/pages/1').length, 1);
});

test('Back while a page is loading keeps the previous page even if the abandoned fetch succeeds', async (t) => {
  const page = deferredResponse();
  const game = fixture(t, ({ path }) => path === '/api/pages/2' ? page.wait() : undefined);
  await game.actions.boot();
  game.location.hash = '#page=2';
  game.actions.readHash();
  await page.requested;

  game.location.hash = '#page=1';
  game.actions.readHash();
  page.resolve(Response.json({ page: 2, total: 20 }));
  await setImmediate();

  assert.equal(game.getSnapshot().loading, false);
  assert.equal(game.getSnapshot().pageError, null);
  assert.equal(game.getSnapshot().page.page, 1);
  assert.equal(game.requests.filter(({ path }) => path === '/api/pages/1').length, 1);
  assert.equal(game.localStorage.get(`${positionKey}:${rememberedHero.id}`), '1');
});

test('deleting the active hero clears their state without restoring a pending page or touching another hero', async (t) => {
  const page = deferredResponse();
  const deletePath = `/api/heroes/${rememberedHero.id}`;
  const game = fixture(t, ({ path, method }) => {
    if (path === deletePath && method === 'DELETE') return Response.json({deleted: true, clearReaderData: true});
    if (path === '/api/pages/2') return page.wait();
  });
  await game.actions.boot();
  game.actions.persistDraft('1:notes', 'remove this');
  const otherDraft = `ferrum-prompt-drafts-v2:${chosenHero.id}`;
  game.localStorage.set(otherDraft, '{"3:notes":"keep this"}');
  const pending = game.actions.loadPage(2);
  await page.requested;
  game.actions.openDialog('hero');
  assert.deepEqual(await game.actions.deleteHero(rememberedHero.id), {deleted: true, readerDataCleared: true});
  page.resolve(Response.json({page: 2, total: 20}));
  await pending;

  assert.equal(game.getSnapshot().hero, null);
  assert.equal(game.getSnapshot().page, null);
  assert.equal(game.getSnapshot().drafts.size, 0);
  assert.equal(game.getSnapshot().dialog, 'hero');
  assert.equal(game.getSnapshot().switchingHero, false);
  assert.equal(game.location.hash, '');
  assert.equal(game.sessionStorage.has(selectionKey), false);
  assert.equal(game.localStorage.has(`ferrum-prompt-drafts-v2:${rememberedHero.id}`), false);
  assert.equal(game.localStorage.has(`${positionKey}:${rememberedHero.id}`), false);
  assert.equal(game.localStorage.get(otherDraft), '{"3:notes":"keep this"}');
});

test('deleting an inactive hero preserves reader data shared with another world', async (t) => {
  const deletePath = `/api/heroes/${chosenHero.id}`;
  const game = fixture(t, ({ path, method }) => path === deletePath && method === 'DELETE'
    ? Response.json({deleted: true, clearReaderData: false}) : undefined);
  await game.actions.boot();
  const sharedDraft = `ferrum-prompt-drafts-v2:${chosenHero.id}`;
  game.localStorage.set(sharedDraft, '{"3:notes":"another world uses this"}');
  assert.deepEqual(await game.actions.deleteHero(chosenHero.id), {deleted: true, readerDataCleared: true});
  assert.equal(game.getSnapshot().hero.id, rememberedHero.id);
  assert.equal(game.sessionStorage.get(selectionKey), rememberedHero.id);
  assert.equal(game.localStorage.has(sharedDraft), true);
});
