import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openReaderStorage } from '../desktop/reader-storage.mjs';
import { exportSaves, importSaves } from '../desktop/save-transfer.mjs';
import { openStore } from '../lib/store.mjs';

const rustName = 'ferrum.sqlite';
const jsName = 'ferrum.javascript.sqlite';
const rustHero = '11111111-aaaa-4aaa-aaaa-111111111111';
const jsHero = '22222222-aaaa-4aaa-aaaa-222222222222';
const staleHero = '33333333-aaaa-4aaa-aaaa-333333333333';
const draftsKey = (hero) => `ferrum-prompt-drafts-v2:${hero}`;
const pageKey = (hero) => `ferrum-last-page-v2:${hero}`;
const readerFile = 'reader-data.json';

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
  async function seed(file, name, id = name) {
    const store = await openStore({file: join(source, file)});
    openStores.push(store);
    store.createHero({id, name});
    return store;
  }
  function reader(folder) {
    const store = openReaderStorage(join(root, folder));
    openStores.push(store);
    return store;
  }
  return {source, destination, seed, reader};
}

function execute(path, sql) {
  const db = new DatabaseSync(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function replacePayload(path, table, column, value) {
  const db = new DatabaseSync(path);
  try {
    db.prepare(`UPDATE ${table} SET ${column} = ?`).run(value);
  } finally {
    db.close();
  }
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

test('desktop backup round-trips unsent drafts and reading position for imported heroes only', async (t) => {
  const {source, destination, seed, reader} = await directories(t);
  await seed(rustName, 'Imported Rust', rustHero);
  await seed(jsName, 'Imported JS', jsHero);
  const sourceReader = reader('source-reader');
  const destinationReader = reader('destination-reader');
  const draft = {'25:training-1-3': 'Unsent \u2728', 'diamond-goblin:code': 'fn main() {}'};
  assert.equal(sourceReader.set(draftsKey(rustHero), JSON.stringify(draft)), true);
  assert.equal(sourceReader.set(pageKey(rustHero), '25'), true);
  assert.equal(sourceReader.set(draftsKey(jsHero), '{"1:boss-1":"Different JS draft"}'), true);
  assert.equal(sourceReader.set(draftsKey(staleHero), '{"1:boss-1":"Orphan"}'), true);
  const backup = await exportSaves(source, destination, {readerStorage:sourceReader});
  const document = JSON.parse(await readFile(join(backup.directory, readerFile), 'utf8'));
  assert.equal(document.version, 1);
  assert.deepEqual(document.heroes.map(row => row.id), [rustHero, jsHero]);
  assert.deepEqual(document.heroes[0], {world:rustName, id:rustHero, drafts:draft, page:25});

  const occupied = await openStore({file:join(destination, jsName)});
  occupied.createHero({id:jsHero, name:'Kept JS'});
  occupied.close();
  assert.equal(destinationReader.set(draftsKey(jsHero), '{"1:boss-1":"Keep this"}'), true);
  const options = {readerStorage:destinationReader};
  const restored = await importSaves(backup.directory, destination, options);
  assert.deepEqual(restored.imported, [rustName]);
  assert.deepEqual(restored.skipped, [jsName]);
  assert.deepEqual(JSON.parse(destinationReader.get(draftsKey(rustHero))), draft);
  assert.equal(destinationReader.get(pageKey(rustHero)), '25');
  assert.equal(destinationReader.get(draftsKey(jsHero)), '{"1:boss-1":"Keep this"}');
  assert.equal(destinationReader.get(draftsKey(staleHero)), null);
  assert.deepEqual(names(join(destination, jsName)), ['Kept JS']);

  destinationReader.set(draftsKey(rustHero), '{"25:training-1-3":"Edited after restore"}');
  assert.deepEqual((await importSaves(backup.directory, destination, options)).imported, []);
  assert.equal(destinationReader.get(draftsKey(rustHero)), '{"25:training-1-3":"Edited after restore"}');
});

test('malformed or invalid reader data is rejected before changing any live world or draft', async (t) => {
  const {source, destination, seed, reader} = await directories(t);
  await seed(rustName, 'Imported Rust', rustHero);
  const live = await openStore({file:join(destination, rustName)});
  live.close();
  const destinationReader = reader('destination-reader');
  const good = {world:rustName, id:rustHero, drafts:{'25:training-1-3':'valid'}, page:25};
  const malformed = [
    '{broken',
    JSON.stringify({version:2, heroes:[good]}),
    JSON.stringify({version:1, heroes:[{...good, page:'25'}]}),
    JSON.stringify({version:1, heroes:[{...good, drafts:['wrong shape']}]}),
    JSON.stringify({version:1, heroes:[{...good, drafts:{'25:training-1-3':17}}]}),
    JSON.stringify({version:1, heroes:[{...good, drafts:{'../secret':'value'}}]}),
    JSON.stringify({version:1, heroes:[{...good, id:'not-a-uuid'}]}),
    JSON.stringify({version:1, heroes:[good, good]}),
  ];
  for (const content of malformed) {
    await writeFile(join(source, readerFile), content);
    await assert.rejects(importSaves(source, destination, {readerStorage:destinationReader}), /reader data/i);
    assert.deepEqual(names(join(destination, rustName)), []);
    assert.equal(destinationReader.get(draftsKey(rustHero)), null);
    assert.equal(destinationReader.get(pageKey(rustHero)), null);
  }
});

test('reader restore verifies hero membership, keeps existing keys, and accepts old backups', async (t) => {
  const {source, destination, seed, reader} = await directories(t);
  await seed(rustName, 'Imported Rust', rustHero);
  await seed(jsName, 'Imported JS', jsHero);
  const sourceReader = reader('source-reader');
  const destinationReader = reader('destination-reader');
  const backup = await exportSaves(source, destination, {readerStorage:sourceReader});
  await assert.rejects(readFile(join(backup.directory, readerFile)), {code:'ENOENT'});
  assert.equal(destinationReader.set(draftsKey(rustHero), '{"25:training-1-3":"Existing"}'), true);
  const options = {readerStorage:destinationReader};
  assert.deepEqual((await importSaves(backup.directory, destination, options)).imported, [rustName, jsName]);
  assert.equal(destinationReader.get(draftsKey(rustHero)), '{"25:training-1-3":"Existing"}');

  const nextDestination = join(destination, 'new-profile');
  await writeFile(join(backup.directory, readerFile), JSON.stringify({version:1, heroes:[
    {world:rustName, id:rustHero, drafts:{'25:training-1-3':'Imported'}, page:25},
    {world:rustName, id:jsHero, drafts:{'1:boss-1':'Wrong world'}, page:12},
    {world:jsName, id:staleHero, drafts:{'1:boss-1':'Missing hero'}, page:12},
  ]}));
  const imported = await importSaves(backup.directory, nextDestination, options);
  assert.deepEqual(imported.imported, [rustName, jsName]);
  assert.equal(destinationReader.get(draftsKey(rustHero)), '{"25:training-1-3":"Existing"}');
  assert.equal(destinationReader.get(pageKey(rustHero)), '25');
  assert.equal(destinationReader.get(draftsKey(jsHero)), null);
  assert.equal(destinationReader.get(pageKey(staleHero)), null);
});

test('reader restore skips an ID shared with an occupied world that was not in the backup', async (t) => {
  const {source, destination, seed, reader} = await directories(t);
  await seed(rustName, 'Imported Rust', rustHero);
  const occupied = await openStore({file:join(destination, jsName)});
  occupied.createHero({id:rustHero, name:'Kept JS'});
  occupied.close();
  await writeFile(join(source, readerFile), JSON.stringify({version:1, heroes:[
    {world:rustName, id:rustHero, drafts:{'25:training-1-3':'Wrong for existing JS'}, page:25},
  ]}));
  const destinationReader = reader('destination-reader');
  assert.deepEqual((await importSaves(source, destination, {readerStorage:destinationReader})).imported, [rustName]);
  assert.equal(destinationReader.get(draftsKey(rustHero)), null);
  assert.equal(destinationReader.get(pageKey(rustHero)), null);
  assert.deepEqual(names(join(destination, jsName)), ['Kept JS']);
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

test('desktop rejects a structurally valid SQLite file that installs a trigger on future saves', async (t) => {
  const {source, destination, seed} = await directories(t);
  await seed(rustName, 'Imported Rust');
  execute(join(source, rustName), `
    CREATE TRIGGER wipe_heroes AFTER INSERT ON heroes BEGIN
      DELETE FROM heroes WHERE id <> NEW.id;
    END;
  `);
  const target = join(destination, rustName);
  const empty = await openStore({file: target});
  empty.close();

  await assert.rejects(importSaves(source, destination), /unsupported save schema/i);
  assert.deepEqual(names(target), []);
});

test('desktop rejects malformed hero tables before importing any world', async (t) => {
  const {source, destination, seed} = await directories(t);
  await seed(rustName, 'Imported Rust');
  execute(join(source, jsName), 'CREATE TABLE heroes (payload TEXT); INSERT INTO heroes VALUES (\'not a hero\');');
  const target = join(destination, rustName);
  const empty = await openStore({file: target});
  empty.close();

  await assert.rejects(importSaves(source, destination), /ferrum\.javascript\.sqlite.*unsupported save schema/i);
  assert.deepEqual(names(target), []);
});

test('desktop imports legacy single-hero progress through the store migration', async (t) => {
  const {source, destination} = await directories(t);
  execute(join(source, rustName), `
    CREATE TABLE profile (id INTEGER PRIMARY KEY, callsign TEXT, path TEXT, last_page INTEGER);
    CREATE TABLE progress (level INTEGER PRIMARY KEY, scout INTEGER, forge INTEGER,
      explained INTEGER, side INTEGER, answer TEXT, code TEXT);
    INSERT INTO profile VALUES (1, 'Legacy Scout', 'warden', 31);
    INSERT INTO progress VALUES (1, 1, 0, 0, 0, 'Earlier answer', 'Earlier draft');
  `);

  assert.deepEqual(await importSaves(source, destination), {imported: [rustName], skipped: []});
  const migrated = await openStore({file: join(destination, rustName)});
  try {
    const [hero] = migrated.heroes();
    assert.equal(hero.name, 'Legacy Scout');
    assert.equal(hero.lastPage, 31);
    assert.equal(migrated.progress(hero.id).levels[0].code, 'Earlier draft');
  } finally {
    migrated.close();
  }
});

function serializedSaves(store) {
  const assessment = {status:'scored', score:60, feedback:'Partial credit', feedbackId:'partial', rubricVersion:'3-example',
    criteria:[{id:'borrow', status:'supported', points:60}]};
  const requestId = store.startAssessment(rustHero, 25, 'training-1-3', 'A supported answer');
  store.completeAssessment(rustHero, 25, 'training-1-3', requestId, assessment);
  store.startAssessment(rustHero, 25, 'training-1-1', 'A pending answer');
  const encounter = {correct:true, feedback:'The repair passed.', checks:[{label:'Passes', passed:true}], trace:['A trace']};
  store.recordEncounterStage(rustHero, 'ferric-scarab-elite', 'repair', encounter);
  const details = {mode:'guided', purpose:'submit', suiteRevision:'suite-example', compileMs:6, runtimeMs:2,
    groups:[{group:'Examples', required:2, passed:2, failed:0}],
    cases:[{id:'visible-case', status:'passed', durationMs:1, message:'Passed.'}]};
  store.recordAttempt(rustHero, {page:48, promptId:'boss-3', level:3, exerciseId:'rust-disjoint-regions',
    code:'A submission', verdict:'pass', output:'', passed:2, failed:0, runId:'run-1', ...details});
  const choice = {correct:false, feedback:'Try again.'};
  const receipts = [
    ['written', {feedback:'Saved.', correct:null, assessment}],
    ['choice', choice],
    ['encounter', {completed:['repair'], result:encounter}],
    ['diamond', {result:{...choice, verdict:'fail', output:'', passed:0, failed:1}}],
    ['workbench', {verdict:'pass', output:'', passed:2, failed:0, passedTests:['visible-case'], failedTests:[],
      runId:'run-1', newClear:true, hardClear:false, ...details}],
    ['trial', {correct:false, passed:0, total:1, feedback:[{id:'one', correct:false, explanation:'A reason.'}]}],
    ['potion', null],
  ];
  for (const [id, value] of receipts) {
    store.settleCombat(rustHero, {id, fingerprint:`fingerprint-${id}`}, () => value);
  }
  return {assessment, encounter, details, receipts};
}

test('desktop save transfer preserves valid stored assessments, receipts, encounters and Workbench details', async (t) => {
  const {source, destination, seed} = await directories(t);
  const store = await seed(rustName, 'Imported Rust', rustHero);
  const expected = serializedSaves(store);
  const backup = await exportSaves(source, destination);
  await importSaves(backup.directory, destination);
  const restored = await openStore({file:join(destination, rustName)});
  try {
    const progress = restored.progress(rustHero);
    assert.equal(progress.responses.find(row => row.promptId === 'training-1-1').assessment, undefined);
    assert.deepEqual(progress.responses.find(row => row.promptId === 'training-1-3').assessment, expected.assessment);
    assert.equal(progress.attempts[0].runtimeMs, expected.details.runtimeMs);
    assert.deepEqual(progress.attempts[0].cases, expected.details.cases);
    assert.deepEqual(restored.encounterResults(rustHero, 'ferric-scarab-elite').get('repair'), expected.encounter);
    for (const [id, value] of expected.receipts) {
      assert.deepEqual(restored.combatReceipt(rustHero, {id, fingerprint:`fingerprint-${id}`}).result, value);
    }
  } finally {
    restored.close();
  }
});

test('desktop rejects a malformed persisted JSON assessment before importing any world', async (t) => {
  const {source, destination, seed} = await directories(t);
  await seed(rustName, 'Valid earlier world', rustHero);
  const store = await seed(jsName, 'Broken later world', jsHero);
  const requestId = store.startAssessment(jsHero, 5, 'side-1', 'A draft');
  store.completeAssessment(jsHero, 5, 'side-1', requestId, {status:'scored', score:60, rubricVersion:1});
  replacePayload(join(source, jsName), 'written_assessments', 'result', '{');
  assert.throws(() => store.progress(jsHero), SyntaxError);
  const earlier = await openStore({file:join(destination, rustName)});
  earlier.close();
  await assert.rejects(importSaves(source, destination), /ferrum\.javascript\.sqlite.*written_assessments\.result/i);
  assert.deepEqual(names(join(destination, rustName)), []);
});

for (const [table, column, samples] of [
  ['written_assessments', 'result', [Buffer.from('{}'), '[]', '{"status":"scored","score":101,"rubricVersion":1}',
    '{"status":"unavailable","score":100,"rubricVersion":1}']],
  ['combat_receipts', 'result', ['[', '"plain text"', '{"correct":"yes"}', '{"result":{"correct":true,"feedback":[]}}']],
  ['encounter_completions', 'result', ['[', 'null', '{"correct":false,"feedback":"Failed"}',
    '{"correct":true,"feedback":"Saved","checks":[{"label":"Check","passed":"yes"}]}']],
  ['workbench_attempt_details', 'details', ['[', '[]', '{"runtimeMs":"12"}', '{"verdict":"pass"}',
    '{"cases":[{"id":"sample","status":"passed","durationMs":"10"}]}']],
]) {
  test(`desktop rejects invalid ${table}.${column} payloads without changing the destination`, async (t) => {
    const {source, destination, seed} = await directories(t);
    const store = await seed(rustName, 'Invalid payload', rustHero);
    serializedSaves(store);
    const live = await openStore({file:join(destination, rustName)});
    live.close();
    for (const value of samples) {
      replacePayload(join(source, rustName), table, column, value);
      await assert.rejects(importSaves(source, destination), error => error.message.includes(`${table}.${column}`));
      assert.deepEqual(names(join(destination, rustName)), []);
    }
  });
}
