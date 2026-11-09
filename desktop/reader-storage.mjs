import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const maxReaderValueBytes = 2 * 1024 * 1024;
const heroIdPattern = '[\\da-f]{8}(?:-[\\da-f]{4}){3}-[\\da-f]{12}';
const heroId = new RegExp(`^${heroIdPattern}$`, 'i');
const readerKey = new RegExp(`^ferrum-(?:prompt-drafts-v2|last-page-v2):${heroIdPattern}$`, 'i');

export function isReaderHeroId(value) {
  return typeof value === 'string' && heroId.test(value);
}

function validValue(key, value) {
  return typeof key === 'string' && readerKey.test(key)
    && typeof value === 'string' && Buffer.byteLength(value) <= maxReaderValueBytes;
}

export function openReaderStorage(directory) {
  mkdirSync(directory, {recursive: true});
  const db = new DatabaseSync(join(directory, 'reader.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS reader_values (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const read = db.prepare('SELECT value FROM reader_values WHERE key = ?');
  const write = db.prepare(`
    INSERT INTO reader_values (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const restore = db.prepare('INSERT INTO reader_values (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  return {
    get(key) {
      if (typeof key !== 'string' || !readerKey.test(key)) return null;
      try {
        return read.get(key)?.value ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (!validValue(key, value)) return false;
      try {
        write.run(key, value);
        return true;
      } catch {
        return false;
      }
    },
    restore(values) {
      if (!values.every(([key, value]) => validValue(key, value))) throw new Error('Invalid reader data.');
      db.exec('BEGIN IMMEDIATE');
      try {
        let restored = 0;
        for (const [key, value] of values) restored += restore.run(key, value).changes;
        db.exec('COMMIT');
        return restored;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    close() { db.close(); },
  };
}
