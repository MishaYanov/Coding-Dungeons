import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const files = ['ferrum.sqlite', 'ferrum.javascript.sqlite', 'ferrum.typescript.sqlite', 'ferrum.go.sqlite'];
const saveTables = ['heroes', 'profile', 'progress', 'responses', 'attempts'];

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
  return new DatabaseSync(path, {readOnly: true, timeout: 5_000});
}

function inspect(db) {
  if (db.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok') {
    throw new Error('SQLite integrity check failed.');
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all().map(({name}) => name));
  if (!tables.has('heroes') && !tables.has('profile')) {
    throw new Error('This SQLite database is missing the Coding Dungeons save schema.');
  }
  return saveTables.some(table => tables.has(table)
    && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
}

async function snapshotSaves(source, destination) {
  const copied = [];
  for (const name of files) {
    const file = join(source, name);
    try {
      if (!await hasFile(file)) continue;
      const db = openReadOnly(file);
      try {
        await backup(db, join(destination, name));
      } finally {
        db.close();
      }
      const snapshot = openReadOnly(join(destination, name));
      try {
        inspect(snapshot);
      } finally {
        snapshot.close();
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
    const copied = await snapshotSaves(from, incoming);
    const available = [];
    const skipped = [];
    for (const name of copied) {
      const target = join(to, name);
      if (await hasFile(target)) {
        const db = openReadOnly(target);
        try {
          if (inspect(db)) {
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
