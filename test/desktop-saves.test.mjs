import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { exportSaves, importSaves } from '../desktop/save-transfer.mjs';
import { openStore } from '../lib/store.mjs';

const rustName = 'ferrum.sqlite';
const jsName = 'ferrum.javascript.sqlite';

async function directories(t) {
  const root = await mkdtemp(join(tmpdir(), 'coding-dungeons-transfer-'));
  const openStores = [];
  t.after(async () => {
    for (const store of openStores) store.close();
    await rm(root, {recursive: true, force: true});
  });
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  await Promise.all([mkdir(source), mkdir(destination)]);
  async function seed(file, name) {
    const store = await openStore({file: join(source, file)});
    openStores.push(store);
    store.createHero({id: name, name});
    return store;
  }
  return {source, destination, seed};
}

function names(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    return db.prepare('SELECT name FROM heroes ORDER BY name').all().map(({name}) => name);
  } finally {
    db.close();
  }
}

test('desktop save export includes committed WAL records without overwriting other backup files', async (t) => {
  const {source, destination, seed} = await directories(t);
  const sourceStore = await seed(rustName, 'Rhea');
  const snapshot = await exportSaves(source, destination);
  assert.deepEqual(snapshot.files, [rustName]);
  assert.deepEqual(names(join(snapshot.directory, rustName)), ['Rhea']);
  sourceStore.createHero({id: 'later', name: 'Later'});
  assert.deepEqual(names(join(snapshot.directory, rustName)), ['Rhea']);
  assert.notEqual((await exportSaves(source, destination)).directory, snapshot.directory);
});

test('desktop imports into empty worlds and keeps occupied worlds intact', async (t) => {
  const {source, destination, seed} = await directories(t);
  await seed(rustName, 'Imported Rust');
  await seed(jsName, 'Imported JS');
  const empty = await openStore({file: join(destination, rustName)});
  empty.close();
  const occupied = await openStore({file: join(destination, jsName)});
  occupied.createHero({id: 'kept', name: 'Kept JS'});
  occupied.close();
  assert.deepEqual(await importSaves(source, destination), {imported: [rustName], skipped: [jsName]});
  assert.deepEqual(names(join(destination, rustName)), ['Imported Rust']);
  assert.deepEqual(names(join(destination, jsName)), ['Kept JS']);
  assert.deepEqual(await importSaves(source, destination), {imported: [], skipped: [rustName, jsName]});
});

test('desktop validates the selected source databases before changing destination saves', async (t) => {
  const {source, destination, seed} = await directories(t);
  await seed(rustName, 'Imported Rust');
  await writeFile(join(source, jsName), 'not a SQLite file');
  const empty = await openStore({file: join(destination, rustName)});
  empty.close();
  await assert.rejects(importSaves(source, destination), /ferrum\.javascript\.sqlite/);
  assert.deepEqual(names(join(destination, rustName)), []);
  await assert.rejects(importSaves(source, source), /different folder/i);
});
