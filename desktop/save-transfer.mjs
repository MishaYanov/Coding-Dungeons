import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createSaveSchema, openStore } from '../lib/store.mjs';

const files = ['ferrum.sqlite', 'ferrum.javascript.sqlite', 'ferrum.typescript.sqlite', 'ferrum.go.sqlite'];
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

async function hasFile(path) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('Expected a regular save file.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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

function inspect(db, allowLegacy = true) {
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
  const occupied = saveTables.some(table => tables.has(table) && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
  return {legacy, occupied};
}

async function snapshotSaves(source, destination, forImport = false) {
  const copied = [];
  for (const name of files) {
    const file = join(source, name);
    try {
      if (!await hasFile(file)) continue;
      const snapshotPath = join(destination, name);
      const db = openReadOnly(file);
      try {
        await backup(db, snapshotPath);
      } finally {
        db.close();
      }
      const snapshot = openReadOnly(snapshotPath);
      let legacy;
      try {
        ({legacy} = inspect(snapshot));
      } finally {
        snapshot.close();
      }
      if (legacy && forImport) {
        const migrated = await openStore({file: snapshotPath});
        migrated.close();
        const verified = openReadOnly(snapshotPath);
        try {
          inspect(verified, false);
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

export async function exportSaves(source, parent) {
  const directory = await mkdtemp(join(parent, 'Coding Dungeons backup '));
  try {
    return {directory, files: await snapshotSaves(source, directory)};
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

// The desktop stops its engine before importing, so occupied worlds cannot
// change between the inspection and SQLite's transactional backup.
export async function importSaves(source, destination) {
  await mkdir(destination, {recursive: true});
  const [from, to] = await Promise.all([realpath(source), realpath(destination)]);
  const canonical = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (canonical(from) === canonical(to)) throw new Error('Choose a different folder to import from.');

  const incoming = await mkdtemp(join(to, '.incoming-'));
  try {
    const copied = await snapshotSaves(from, incoming, true);
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
    for (const name of available) {
      const snapshot = openReadOnly(join(incoming, name));
      try {
        await backup(snapshot, join(to, name));
      } finally {
        snapshot.close();
      }
    }
    return {imported: available, skipped};
  } finally {
    await rm(incoming, {recursive: true, force: true});
  }
}
