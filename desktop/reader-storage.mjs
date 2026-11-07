import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const maxBytes = 2 * 1024 * 1024;
const readerKey = /^ferrum-(prompt-drafts-v2|last-page-v2):([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

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
      if (typeof key !== 'string' || !readerKey.test(key)
        || typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) return false;
      try {
        write.run(key, value);
        return true;
      } catch {
        return false;
      }
    },
    close() { db.close(); },
  };
}
