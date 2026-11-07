import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openStore } from '../lib/store.mjs';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'ferrum-store-'));
  const file = join(folder, 'ferrum.sqlite');
  t.after(async () => {
    for (const suffix of ['', '-wal', '-shm']) {
      await unlink(file + suffix).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await rmdir(folder);
  });
  return file;
}

function inDatabase(file, callback) {
  const db = new DatabaseSync(file);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

const attempt = {
  page: 26, promptId: 'boss-1', level: 1, exerciseId: 'cargo-handoff',
  code: 'submitted Rust', verdict: 'pass', output: 'completed test report', passed: 3, failed: 0,
};

test('separate SQLite connections preserve partial upserts and isolate hero records', async t => {
  const file = await fixture(t);
  const store = await openStore({ file });
  const second = await openStore({ file });
  try {
    assert.deepEqual(store.heroes(), []);
    assert.equal(store.progress(randomUUID()), undefined);
    const a = store.createHero({ id: randomUUID(), name: '  Fern  ' });
    const b = second.createHero({ id: randomUUID(), name: 'Ward', path: 'warden' });
    assert.equal(a.name, 'Fern');
    assert.equal(a.path, 'all');
    assert.equal(a.lastPage, 1);
    assert.throws(() => second.createHero({ id: randomUUID(), name: 'ＦＥＲＮ' }), { code: 'HERO_EXISTS' });
    assert.throws(() => store.saveProfile(b.id, { callsign: 'FERN', last_page: 40 }), { code: 'HERO_EXISTS' });
    assert.equal(store.hero(b.id).lastPage, 1);
    assert.throws(() => store.saveLevel(randomUUID(), 1, { scout: true }), { errcode: 787 });

    second.saveProfile(a.id, { callsign: 'Fern the Delver', path: 'delver' });
    store.saveProfile(a.id, { last_page: 18 });
    store.saveLevel(a.id, 2, { scout: true, answer: 'Reasoning', nonexistent: 'ignored' });
    second.saveLevel(a.id, 2, { explained: true, side: false });
    second.saveLevel(b.id, 2, { side: true, code: 'Different draft' });
    store.saveResponse(a.id, 18, 'checkpoint-1', '1', 'first feedback', false);
    second.saveResponse(a.id, 18, 'checkpoint-1', '2', 'second feedback', true);
    second.saveResponse(b.id, 18, 'checkpoint-1', '4', 'other feedback', false);
    second.saveResponse(b.id, 18, 'notes', 'other hero notes', 'saved');

    const pa = second.progress(a.id);
    assert.deepEqual(pa.profile, { id: a.id, callsign: 'Fern the Delver', path: 'delver', lastPage: 18 });
    assert.deepEqual(pa.levels, [{
      level: 2, scout: true, forge: false, explain: true, side: false, answer: 'Reasoning', code: '',
    }]);
    assert.deepEqual(pa.responses, [{
      page: 18, promptId: 'checkpoint-1', value: '2', feedback: 'second feedback', correct: true,
    }]);
    const pb = store.progress(b.id);
    assert.deepEqual(pb.levels, [{
      level: 2, scout: false, forge: false, explain: false, side: true, answer: '', code: 'Different draft',
    }]);
    assert.deepEqual(pb.responses.map(row => [row.value, row.correct]), [
      ['4', false], ['other hero notes', null],
    ]);
    assert.deepEqual(store.response(a.id, 18, 'checkpoint-1'), { value: '2' });
    assert.equal(store.response(a.id, 18, 'notes'), undefined);
  } finally {
    second.close();
    store.close();
  }
});

test('attempt and Forge updates commit together, history is bounded, and pass is retained after a later failure', async t => {
  const file = await fixture(t);
  const store = await openStore({ file });
  const second = await openStore({ file });
  try {
    const a = store.createHero({ id: randomUUID(), name: 'Forge Keeper' });
    const b = second.createHero({ id: randomUUID(), name: 'Archivist' });
    assert.throws(() => store.recordAttempt(a.id, { ...attempt, output: null }), { errcode: 1299 });
    assert.deepEqual(store.progress(a.id).attempts, []);
    assert.deepEqual(store.progress(a.id).levels, []);

    store.saveLevel(a.id, 1, { scout: true });
    second.recordAttempt(a.id, attempt);
    assert.deepEqual(store.progress(a.id).levels, [{
      level: 1, scout: true, forge: true, explain: false, side: false, answer: '', code: '',
    }]);
    const failure = { ...attempt, verdict: 'fail', passed: 1, failed: 2 };
    for (let index = 0; index < 101; index += 1) {
      const writer = index % 2 ? store : second;
      writer.recordAttempt(a.id, { ...failure, output: `failure ${index}` });
    }
    second.recordAttempt(b.id, failure);
    const pa = store.progress(a.id);
    const pb = store.progress(b.id);
    assert.equal(pa.levels[0].forge, true);
    assert.equal(pa.attempts.length, 100);
    assert.equal(pa.attempts[0].output, 'failure 100');
    assert.equal(pa.attempts.at(-1).output, 'failure 1');
    assert.ok(!Object.hasOwn(pa.attempts[0], 'source'));
    assert.equal(pb.attempts.length, 1);
    assert.deepEqual(pb.levels, []);
    inDatabase(file, db => {
      assert.equal(db.prepare('SELECT source FROM attempts WHERE hero_id = ? AND id = 1').get(a.id).source, attempt.code);
      assert.equal(db.prepare('SELECT COUNT(*) AS size FROM attempts WHERE hero_id = ?').get(a.id).size, 102);
    });
  } finally {
    second.close();
    store.close();
  }
});

test('an earlier single-hero database migrates profile, progress, responses, and attempts once', async t => {
  const file = await fixture(t);
  inDatabase(file, db => db.exec(`
    CREATE TABLE profile (id INTEGER PRIMARY KEY, callsign TEXT, path TEXT, last_page INTEGER);
    CREATE TABLE progress (level INTEGER PRIMARY KEY, scout INTEGER, forge INTEGER,
      explained INTEGER, side INTEGER, answer TEXT, code TEXT);
    CREATE TABLE responses (page INTEGER, prompt_id TEXT, value TEXT, feedback TEXT, correct INTEGER,
      PRIMARY KEY (page, prompt_id));
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, page INTEGER, prompt_id TEXT, level INTEGER,
      exercise_id TEXT, source TEXT, verdict TEXT, output TEXT, passed INTEGER, failed INTEGER, created_at TEXT);
    INSERT INTO profile VALUES (1, 'Saved Explorer', 'warden', 31);
    INSERT INTO progress VALUES (1, 1, 1, 0, 0, 'Earlier answer', 'Earlier draft');
    INSERT INTO responses VALUES (18, 'checkpoint-1', '2', 'Earlier feedback', 1);
    INSERT INTO attempts VALUES (7, 26, 'boss-1', 1, 'cargo-handoff', 'Earlier code',
      'pass', 'Earlier report', 3, 0, '2026-11-07T00:00:00.000Z');
  `));
  const first = await openStore({ file });
  let recovered;
  try {
    [recovered] = first.heroes();
    const progress = first.progress(recovered.id);
    assert.deepEqual(progress.profile, {
      id: recovered.id, callsign: 'Saved Explorer', path: 'warden', lastPage: 31,
    });
    assert.equal(progress.levels[0].answer, 'Earlier answer');
    assert.equal(progress.levels[0].code, 'Earlier draft');
    assert.equal(progress.responses[0].correct, true);
    assert.equal(progress.attempts[0].output, 'Earlier report');
    first.recordAttempt(recovered.id, attempt);
  } finally {
    first.close();
  }
  const reopened = await openStore({ file });
  try {
    assert.equal(reopened.heroes().length, 1);
    assert.equal(reopened.heroes()[0].id, recovered.id);
    assert.equal(reopened.progress(recovered.id).attempts.length, 2);
    const newHero = reopened.createHero({ id: randomUUID(), name: 'New Explorer' });
    assert.deepEqual(reopened.progress(newHero.id).attempts, []);
  } finally {
    reopened.close();
  }
  inDatabase(file, db => {
    const rows = db.prepare('SELECT id FROM attempts ORDER BY id').all();
    assert.deepEqual(rows.map(row => row.id), [7, 8]);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '_legacy_%'").all(), []);
  });
});

test('null legacy names recover without abandoning existing data', async t => {
  const file = await fixture(t);
  inDatabase(file, db => db.exec(`
    CREATE TABLE profile (id INTEGER PRIMARY KEY, callsign TEXT, path TEXT, last_page INTEGER);
    INSERT INTO profile VALUES (1, NULL, NULL, 48);
  `));
  const store = await openStore({ file });
  try {
    const [hero] = store.heroes();
    assert.equal(hero.name, 'Recovered Hero');
    assert.equal(hero.path, 'all');
    assert.equal(hero.lastPage, 48);
  } finally {
    store.close();
  }
});

test('incompatible legacy schema rolls back without losing rows and can be retried after repair', async t => {
  const file = await fixture(t);
  inDatabase(file, db => db.exec(`
    CREATE TABLE responses (page INTEGER, prompt_id TEXT, value TEXT, correct INTEGER);
    INSERT INTO responses VALUES (1, 'notes', 'Retained data', NULL);
  `));
  await assert.rejects(openStore({ file }), /no such column: feedback/);
  inDatabase(file, db => {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
    assert.deepEqual(tables.map(row => row.name), ['responses']);
    assert.equal(db.prepare('SELECT value FROM responses').get().value, 'Retained data');
    db.exec("ALTER TABLE responses ADD COLUMN feedback TEXT NOT NULL DEFAULT 'Recovered feedback'");
  });
  const store = await openStore({ file });
  try {
    const [hero] = store.heroes();
    assert.equal(hero.name, 'Recovered Hero');
    assert.equal(store.progress(hero.id).responses[0].value, 'Retained data');
  } finally {
    store.close();
  }
});
