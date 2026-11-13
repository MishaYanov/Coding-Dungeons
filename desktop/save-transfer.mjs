import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createSaveSchema, openStore } from '../lib/store.mjs';
import { isReaderHeroId, maxReaderValueBytes } from './reader-storage.mjs';

const files = ['ferrum.sqlite', 'ferrum.javascript.sqlite', 'ferrum.typescript.sqlite', 'ferrum.go.sqlite'];
const readerDataFile = 'reader-data.json';
const maxReaderDataBytes = 32 * 1024 * 1024;
const maxSavePayloadBytes = 1024 * 1024;
const maxSaveDatabaseBytes = 256 * 1024 * 1024;
const maxSaveWalBytes = 2 * maxSaveDatabaseBytes;
const maxSavedTextBytes = 64 * 1024;
const maxSavedKeyBytes = 1024;
const maxSavedRows = 10_000;
const maxSavedProgressBytes = 16 * 1024 * 1024;
const maxDraftLength = 49_152;
const promptDraftKey = /^([1-9]\d{0,15}):[a-z0-9][a-z0-9_-]{0,79}$/i;
const draftsKey = (id) => `ferrum-prompt-drafts-v2:${id}`;
const pageKey = (id) => `ferrum-last-page-v2:${id}`;
const saveTables = ['heroes', 'profile', 'progress', 'responses', 'attempts'];
const legacyColumns = new Map([
  ['profile', ['id', 'callsign', 'path', 'last_page']],
  ['progress', ['level', 'scout', 'forge', 'explained', 'side', 'answer', 'code']],
  ['responses', ['page', 'prompt_id', 'value', 'feedback', 'correct']],
  ['attempts', ['id', 'page', 'prompt_id', 'level', 'exercise_id', 'source', 'verdict', 'output', 'passed', 'failed', 'created_at']],
]);

function schemaObjects(db) {
  return db.prepare('SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema').all();
}

function schemaSignature({type, name, tableName, sql}) {
  return JSON.stringify([type, name, tableName, sql?.trim().replace(/\s+/g, ' ') ?? null]);
}

const sequenceTable = schemaSignature({type:'table', name:'sqlite_sequence', tableName:'sqlite_sequence',
  sql:'CREATE TABLE sqlite_sequence(name,seq)'});

function expectedSchema() {
  const db = new DatabaseSync(':memory:');
  try {
    createSaveSchema(db);
    return new Set([sequenceTable, ...schemaObjects(db).map(schemaSignature)]);
  } finally {
    db.close();
  }
}

const allowedSchema = expectedSchema();

async function hasFile(path, maxBytes = Infinity) {
  try {
    const file = await lstat(path);
    if (!file.isFile()) throw new Error('Expected a regular save file.');
    if (file.size > maxBytes) throw new Error('SQLite save exceeds the size limit.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function checkDatabaseSize(db, maxBytes) {
  const {page_count: pageCount} = db.prepare('PRAGMA main.page_count').get();
  const {page_size: pageSize} = db.prepare('PRAGMA main.page_size').get();
  if (pageCount * pageSize > maxBytes) throw new Error('SQLite save exceeds the size limit.');
}

function openReadOnly(path) {
  const db = new DatabaseSync(path, {readOnly: true, timeout: 5_000});
  try {
    db.exec('PRAGMA trusted_schema = OFF;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function supportedLegacy(db, objects) {
  const tableKinds = new Map(db.prepare('PRAGMA main.table_list').all().map(({name, type}) => [name, type]));
  return objects.every((object) => {
    if (schemaSignature(object) === sequenceTable) return true;
    const {type, name, tableName, sql} = object;
    if (!legacyColumns.has(tableName)) return false;
    if (type === 'index') return sql === null && name.startsWith(`sqlite_autoindex_${tableName}_`);
    if (type !== 'table' || tableKinds.get(name) !== 'table') return false;
    const columns = db.prepare('SELECT name, hidden FROM pragma_table_xinfo(?)').all(name);
    return columns.every(({hidden}) => hidden === 0) && legacyColumns.get(name).every((required) =>
      columns.some(({name}) => name === required));
  });
}

function inspect(db, {allowLegacy = true, validatePayloads = false, validateRows = false} = {}) {
  const objects = schemaObjects(db);
  const tables = new Set(objects.filter(({type}) => type === 'table').map(({name}) => name));
  const legacy = !tables.has('heroes') && [...legacyColumns.keys()].some(name => tables.has(name));
  const supported = legacy ? allowLegacy && supportedLegacy(db, objects)
    : tables.has('heroes') && objects.every(object => allowedSchema.has(schemaSignature(object)));
  if (!supported) throw new Error('Unsupported save schema.');
  if (db.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok') {
    throw new Error('SQLite integrity check failed.');
  }
  if (!legacy && db.prepare('PRAGMA foreign_key_check').get()) {
    throw new Error('SQLite save contains records with missing references.');
  }
  if (validateRows) {
    inspectSavedText(db, tables);
    if (!legacy) inspectSavedRows(db, tables);
  }
  if (validatePayloads && !legacy) inspectSavedPayloads(db, tables);
  const occupied = saveTables.some(table => tables.has(table) && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
  return {legacy, occupied};
}

function inspectSavedRows(db, tables) {
  if (db.prepare(`SELECT 1 FROM heroes WHERE typeof(id) != 'text' OR length(id) != 36 OR instr(id, char(0)) > 0
    OR typeof(last_page) != 'integer' OR last_page NOT BETWEEN 1 AND ? LIMIT 1`).get(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid hero record.');
  }
  for (const {id} of db.prepare('SELECT id FROM heroes').iterate()) {
    if (!isReaderHeroId(id)) throw new Error('Invalid hero record.');
  }
  if (tables.has('one_life_heroes') && db.prepare(`SELECT 1 FROM one_life_heroes
    WHERE typeof(hp) != 'integer' OR hp NOT BETWEEN 0 AND 100
    OR typeof(potions) != 'integer' OR potions NOT BETWEEN 0 AND ? LIMIT 1`).get(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid One Life record.');
  }

  for (const table of ['heroes', 'progress', 'workbench_modes', 'workbench_clears',
    'encounter_completions', 'combat_rewards']) {
    if (!tables.has(table)) continue;
    const group = table === 'heroes' ? '' : 'GROUP BY hero_id';
    if (db.prepare(`SELECT count(*) FROM ${table} ${group} HAVING count(*) > ? LIMIT 1`).get(maxSavedRows)) {
      throw new Error(`Too many saved rows in ${table}.`);
    }
  }
  if (tables.has('responses')) {
    const hasAssessments = tables.has('written_assessments');
    const join = hasAssessments ? 'LEFT JOIN written_assessments a USING (hero_id, page, prompt_id)' : '';
    const assessmentBytes = hasAssessments ? '+ coalesce(length(CAST(a.result AS BLOB)), 0)' : '';
    if (db.prepare(`SELECT 1 FROM responses r ${join} GROUP BY r.hero_id HAVING count(*) > ? OR
      sum(length(CAST(r.prompt_id AS BLOB)) + length(CAST(r.value AS BLOB))
        + length(CAST(r.feedback AS BLOB)) ${assessmentBytes}) > ? LIMIT 1`)
      .get(maxSavedRows, maxSavedProgressBytes)) {
      throw new Error('Too many saved responses or response bytes for one hero.');
    }
  }
  if (tables.has('progress') && db.prepare(`SELECT 1 FROM progress GROUP BY hero_id HAVING
    sum(coalesce(length(CAST(answer AS BLOB)), 0) + coalesce(length(CAST(code AS BLOB)), 0)) > ? LIMIT 1`)
    .get(maxSavedProgressBytes)) {
    throw new Error('Too many saved progress bytes for one hero.');
  }
  if (tables.has('attempts')) {
    if (db.prepare(`SELECT 1 FROM attempts WHERE verdict = 'pass' GROUP BY hero_id
      HAVING count(DISTINCT exercise_id) > ? LIMIT 1`).get(maxSavedRows)) {
      throw new Error('Too many saved exercise clears for one hero.');
    }
    const hasDetails = tables.has('workbench_attempt_details');
    const join = hasDetails ? 'LEFT JOIN workbench_attempt_details d ON (a.hero_id = d.hero_id AND a.id = d.attempt_id)' : '';
    const detailBytes = hasDetails ? '+ coalesce(length(CAST(d.details AS BLOB)), 0)' : '';
    if (db.prepare(`WITH recent AS (SELECT a.hero_id, a.id, a.output,
      row_number() OVER (PARTITION BY a.hero_id ORDER BY a.id DESC) AS rank FROM attempts a)
      SELECT 1 FROM recent a ${join} WHERE a.rank <= 100 GROUP BY a.hero_id
      HAVING sum(length(CAST(a.output AS BLOB)) ${detailBytes}) > ? LIMIT 1`).get(maxSavedProgressBytes)) {
      throw new Error('Too many saved attempt bytes for one hero.');
    }
  }
}

const savedTextFields = [
  ['heroes', ['name', 'name_key', 'path', 'updated_at'], []],
  ['profile', ['callsign', 'path'], []],
  ['progress', [], ['answer', 'code']],
  ['responses', ['prompt_id'], ['value', 'feedback']],
  ['attempts', ['prompt_id', 'exercise_id', 'verdict', 'created_at'], ['source', 'output']],
  ['diamond_encounters', [], ['draft']],
  ['encounter_completions', ['encounter_id', 'stage_id'], []],
  ['workbench_clears', ['exercise_id'], []],
  ['combat_rewards', ['reward_key'], []],
];

function inspectSavedText(db, tables) {
  for (const [table, keys, fields] of savedTextFields) {
    if (!tables.has(table)) continue;
    const columns = [...keys.map(column => [column, maxSavedKeyBytes]),
      ...fields.map(column => [column, maxSavedTextBytes])];
    const conditions = columns.map(([column]) => `(${column} IS NOT NULL
      AND (typeof(${column}) != 'text' OR length(CAST(${column} AS BLOB)) > ?))`);
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${conditions.join(' OR ')} LIMIT 1`)
      .get(...columns.map(([, limit]) => limit))) {
      throw new Error(`Invalid or oversized save text in ${table}.`);
    }
  }
}

function heroIds(directory, name) {
  const db = openReadOnly(join(directory, name));
  try {
    if (inspect(db).legacy) return [];
    return db.prepare('SELECT id FROM heroes ORDER BY id').all().map(({id}) => id).filter(isReaderHeroId);
  } finally {
    db.close();
  }
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPage(value) {
  return Number.isSafeInteger(value) && value > 0;
}

const text = value => typeof value === 'string';
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const revision = value => validPage(value) || (text(value) && value.trim().length > 0);
const milliseconds = value => Number.isFinite(value) && value >= 0;
const boolean = value => typeof value === 'boolean';
const strings = value => Array.isArray(value) && value.every(text);
const optional = (value, key, valid) => !Object.hasOwn(value, key) || valid(value[key]);
const rows = (value, valid) => Array.isArray(value) && value.every(item => record(item) && valid(item));

function assessment(value) {
  return record(value) && ['scored', 'clarify', 'unavailable'].includes(value.status)
    && (value.status === 'scored' ? nonnegativeInteger(value.score) && value.score <= 100 : value.score === null)
    && revision(value.rubricVersion) && optional(value, 'feedback', text) && optional(value, 'feedbackId', text)
    && optional(value, 'criteria', items => rows(items, item => text(item.id)
      && ['supported', 'contradicted', 'not_detected', 'unclear'].includes(item.status)
      && nonnegativeInteger(item.points) && item.points <= 100));
}

const workbenchDetailKeys = ['mode', 'purpose', 'suiteRevision', 'compileMs', 'runtimeMs', 'elapsedMs', 'groups', 'cases'];
function workbenchMetadata(value) {
  return optional(value, 'mode', mode => ['guided', 'hard'].includes(mode))
    && optional(value, 'purpose', purpose => ['examples', 'submit'].includes(purpose))
    && optional(value, 'suiteRevision', revision)
    && ['compileMs', 'runtimeMs', 'elapsedMs'].every(key => optional(value, key, milliseconds))
    && optional(value, 'groups', items => rows(items, item => text(item.group)
      && [item.required, item.passed, item.failed].every(nonnegativeInteger) && item.passed + item.failed <= item.required))
    && optional(value, 'cases', items => rows(items, item => text(item.id) && ['passed', 'failed', 'timeout'].includes(item.status)
      && optional(item, 'durationMs', milliseconds) && optional(item, 'message', text)));
}

function workbenchReport(value) {
  return record(value) && ['pass', 'fail', 'compile_error', 'timeout', 'busy', 'unavailable', 'error', 'canceled'].includes(value.verdict)
    && text(value.output) && nonnegativeInteger(value.passed) && nonnegativeInteger(value.failed)
    && optional(value, 'passedTests', strings) && optional(value, 'failedTests', strings)
    && optional(value, 'runId', text) && optional(value, 'newClear', boolean) && optional(value, 'hardClear', boolean)
    && workbenchMetadata(value);
}

function encounterResult(value) {
  return record(value) && boolean(value.correct) && text(value.feedback)
    && optional(value, 'checks', items => rows(items, item => text(item.label) && boolean(item.passed)))
    && optional(value, 'trace', strings)
    && (!Object.hasOwn(value, 'verdict') || workbenchReport(value));
}

function receipt(value) {
  if (value === null) return true;
  if (!record(value)) return false;
  if (Object.hasOwn(value, 'assessment')) {
    return value.correct === null && text(value.feedback) && assessment(value.assessment);
  }
  if (Object.hasOwn(value, 'result')) return encounterResult(value.result) && optional(value, 'completed', strings);
  if (Object.hasOwn(value, 'verdict')) return workbenchReport(value);
  if (!boolean(value.correct)) return false;
  if (!Array.isArray(value.feedback)) return optional(value, 'feedback', text);
  return nonnegativeInteger(value.passed) && nonnegativeInteger(value.total) && value.passed <= value.total
    && value.feedback.length === value.total && rows(value.feedback, item => text(item.id)
      && boolean(item.correct) && text(item.explanation));
}

const savedPayloads = [
  ['written_assessments', 'result', assessment],
  ['combat_receipts', 'result', receipt],
  ['encounter_completions', 'result', value => encounterResult(value) && value.correct],
  ['workbench_attempt_details', 'details', value => record(value)
    && Object.keys(value).every(key => workbenchDetailKeys.includes(key)) && workbenchMetadata(value)],
];

function inspectSavedPayloads(db, tables) {
  for (const [table, column, valid] of savedPayloads) {
    if (!tables.has(table)) continue;
    const message = `Invalid save payload in ${table}.${column}.`;
    // Bound SQLite values before reading their contents into JavaScript.
    if (db.prepare(`SELECT 1 FROM ${table} WHERE length(CAST(${column} AS BLOB)) > ? LIMIT 1`).get(maxSavePayloadBytes)) {
      throw new Error(message);
    }
    for (const {payload} of db.prepare(`SELECT ${column} AS payload FROM ${table}`).iterate()) {
      if (payload === null && table === 'written_assessments') continue;
      if (!text(payload)) throw new Error(message);
      let value;
      try { value = JSON.parse(payload); }
      catch (error) { throw new Error(message, {cause:error}); }
      if (!valid(value)) throw new Error(message);
    }
  }
}

function validDrafts(drafts) {
  return record(drafts) && Object.entries(drafts).every(([key, value]) =>
    typeof value === 'string' && value.length <= maxDraftLength
    && (key === 'diamond-goblin:code' || validPage(Number(promptDraftKey.exec(key)?.[1]))))
    && Buffer.byteLength(JSON.stringify(drafts)) <= maxReaderValueBytes;
}

function readerData(document) {
  if (!record(document) || document.version !== 1 || !Array.isArray(document.heroes)
    || Object.keys(document).length !== 2) throw new Error('Unsupported reader data format.');
  const seen = new Set();
  for (const row of document.heroes) {
    if (!record(row) || !files.includes(row.world) || !isReaderHeroId(row.id)
      || Object.keys(row).some(key => !['world', 'id', 'drafts', 'page'].includes(key))) throw new Error('Invalid reader data.');
    const hasDrafts = Object.hasOwn(row, 'drafts');
    const hasPage = Object.hasOwn(row, 'page');
    if ((!hasDrafts && !hasPage) || (hasDrafts && !validDrafts(row.drafts)) || (hasPage && !validPage(row.page))) {
      throw new Error('Invalid reader data.');
    }
    const identity = `${row.world}:${row.id}`;
    if (seen.has(identity)) throw new Error('Duplicate hero in reader data.');
    seen.add(identity);
  }
  return document.heroes;
}

async function readReaderData(directory) {
  const path = join(directory, readerDataFile);
  let input;
  try {
    if (!await hasFile(path)) return [];
    input = await open(path, 'r');
    const info = await input.stat();
    if (!info.isFile() || info.size > maxReaderDataBytes) throw new Error('Reader data exceeds the backup size limit.');
    const buffer = Buffer.alloc(info.size + 1);
    const {bytesRead} = await input.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size) throw new Error('Reader data changed while reading.');
    const text = new TextDecoder('utf-8', {fatal:true}).decode(buffer.subarray(0, bytesRead));
    return readerData(JSON.parse(text));
  } catch (error) {
    throw new Error('Unable to read the backup reader data.', {cause:error});
  } finally {
    await input?.close();
  }
}

async function writeReaderData(directory, copied, readerStorage) {
  const heroes = [];
  for (const world of copied) {
    for (const id of heroIds(directory, world)) {
      const rawDrafts = readerStorage.get(draftsKey(id));
      const rawPage = readerStorage.get(pageKey(id));
      if (rawDrafts === null && rawPage === null) continue;
      const row = {world, id};
      if (rawDrafts !== null) {
        try { row.drafts = JSON.parse(rawDrafts); }
        catch (error) { throw new Error('Unable to read saved reader data.', {cause:error}); }
      }
      if (rawPage !== null) row.page = Number(rawPage);
      heroes.push(row);
    }
  }
  if (!heroes.length) return;
  const document = {version:1, heroes};
  readerData(document);
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json) > maxReaderDataBytes) throw new Error('Reader data exceeds the backup size limit.');
  await writeFile(join(directory, readerDataFile), json, {encoding:'utf8', flag:'wx', mode:0o600});
}

async function restorePlan(rows, incoming, destination, available) {
  const selected = new Map(available.map(world => [world, new Set(heroIds(incoming, world))]));
  // The reader database keys use a hero ID without a world. Ignore IDs that
  // would attach the imported draft or page to another world's hero.
  const counts = new Map();
  for (const world of files) {
    const ids = selected.get(world) ?? (await hasFile(join(destination, world)) ? heroIds(destination, world) : []);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const entries = new Map();
  for (const {world, id, drafts, page} of rows) {
    if (!selected.get(world)?.has(id) || counts.get(id) !== 1) continue;
    const values = entries.get(world) ?? [];
    if (drafts !== undefined) values.push([draftsKey(id), JSON.stringify(drafts)]);
    if (page !== undefined) values.push([pageKey(id), String(page)]);
    entries.set(world, values);
  }
  return entries;
}

async function snapshotSaves(source, destination, {forImport = false, maxDatabaseBytes = maxSaveDatabaseBytes} = {}) {
  const copied = [];
  for (const name of files) {
    const file = join(source, name);
    try {
      if (!await hasFile(file, maxDatabaseBytes)) continue;
      await hasFile(`${file}-wal`, maxSaveWalBytes);
      await hasFile(`${file}-shm`, maxSaveDatabaseBytes);
      const snapshotPath = join(destination, name);
      const db = openReadOnly(file);
      try {
        // Pin the same committed snapshot that SQLite will copy, including WAL pages.
        db.exec('BEGIN');
        checkDatabaseSize(db, maxDatabaseBytes);
        await backup(db, snapshotPath);
      } finally {
        db.close();
      }
      const snapshot = openReadOnly(snapshotPath);
      let legacy;
      try {
        checkDatabaseSize(snapshot, maxDatabaseBytes);
        ({legacy} = inspect(snapshot, {validatePayloads:true, validateRows:forImport}));
      } finally {
        snapshot.close();
      }
      if (legacy && forImport) {
        const migrated = await openStore({file: snapshotPath});
        migrated.close();
        const verified = openReadOnly(snapshotPath);
        try {
          checkDatabaseSize(verified, maxDatabaseBytes);
          inspect(verified, {allowLegacy:false, validatePayloads:true, validateRows:true});
        } finally {
          verified.close();
        }
      }
      copied.push(name);
    } catch (error) {
      throw new Error(`Unable to read ${name}: ${error.message}`, {cause: error});
    }
  }
  if (!copied.length) throw new Error('Choose a folder containing Coding Dungeons save files.');
  return copied;
}

export async function exportSaves(source, parent, {readerStorage} = {}) {
  const directory = await mkdtemp(join(parent, 'Coding Dungeons backup '));
  try {
    const copied = await snapshotSaves(source, directory);
    if (readerStorage) await writeReaderData(directory, copied, readerStorage);
    return {directory, files:copied};
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

// The desktop stops its engine before importing, so occupied worlds cannot
// change between the inspection and SQLite's transactional backup.
export async function importSaves(source, destination, {readerStorage, maxDatabaseBytes = maxSaveDatabaseBytes} = {}) {
  const from = await realpath(source);
  const readerRows = await readReaderData(from);
  await mkdir(destination, {recursive: true});
  const to = await realpath(destination);
  const canonical = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (canonical(from) === canonical(to)) throw new Error('Choose a different folder to import from.');

  const incoming = await mkdtemp(join(to, '.incoming-'));
  try {
    const copied = await snapshotSaves(from, incoming, {forImport:true, maxDatabaseBytes});
    const available = [];
    const skipped = [];
    for (const name of copied) {
      const target = join(to, name);
      if (await hasFile(target)) {
        const db = openReadOnly(target);
        try {
          if (inspect(db).occupied) {
            skipped.push(name);
            continue;
          }
        } finally {
          db.close();
        }
      }
      available.push(name);
    }
    const readers = readerStorage && readerRows.length && available.length
      ? await restorePlan(readerRows, incoming, to, available) : new Map();
    for (const name of available) {
      const snapshot = openReadOnly(join(incoming, name));
      try {
        await backup(snapshot, join(to, name));
      } finally {
        snapshot.close();
      }
      const values = readers.get(name);
      if (values) readerStorage.restore(values);
    }
    return {imported: available, skipped};
  } finally {
    await rm(incoming, {recursive: true, force: true});
  }
}
