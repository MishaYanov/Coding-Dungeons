import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openReaderStorage } from '../desktop/reader-storage.mjs';

const hero = '11111111-aaaa-4aaa-aaaa-111111111111';
const drafts = `ferrum-prompt-drafts-v2:${hero}`;
const page = `ferrum-last-page-v2:${hero}`;

async function directory(t) {
  const folder = await mkdtemp(join(tmpdir(), 'coding-dungeons-drafts-'));
  const stores = [];
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(folder, {recursive: true, force: true});
  });
  return {
    folder,
    open() {
      const store = openReaderStorage(folder);
      stores.push(store);
      return store;
    },
  };
}

test('desktop unsent reader state survives reopening with a different engine origin', async (t) => {
  const {open} = await directory(t);
  const first = open();
  assert.equal(first.get(drafts), null);
  assert.equal(first.set(drafts, '{"1:example":"draft"}'), true);
  assert.equal(first.set(page, '2'), true);
  const reopened = open();
  assert.equal(reopened.get(drafts), '{"1:example":"draft"}');
  assert.equal(reopened.get(page), '2');
  assert.equal(reopened.set(drafts, '{}'), true);
  assert.equal(first.get(drafts), '{}');
});

test('desktop storage accepts only bounded reader keys and values', async (t) => {
  const {folder, open} = await directory(t);
  const storage = open();
  const initialFiles = (await readdir(folder)).sort();
  for (const key of ['../../secrets', 'ferrum-prompt-drafts-v2:../../state', 'custom:feature', undefined]) {
    assert.equal(storage.get(key), null);
    assert.equal(storage.set(key, 'stolen'), false);
  }
  assert.equal(storage.set(drafts, null), false);
  assert.equal(storage.set(drafts, 'x'.repeat(2 * 1024 * 1024 + 1)), false);
  assert.deepEqual((await readdir(folder)).sort(), initialFiles);
});
