import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const schema = `
  CREATE TABLE IF NOT EXISTS heroes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL DEFAULT 'all',
    last_page INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    scout INTEGER NOT NULL DEFAULT 0,
    forge INTEGER NOT NULL DEFAULT 0,
    explained INTEGER NOT NULL DEFAULT 0,
    side INTEGER NOT NULL DEFAULT 0,
    answer TEXT,
    code TEXT,
    PRIMARY KEY (hero_id, level)
  );
  CREATE TABLE IF NOT EXISTS responses (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    prompt_id TEXT NOT NULL,
    value TEXT NOT NULL,
    feedback TEXT NOT NULL,
    correct INTEGER,
    PRIMARY KEY (hero_id, page, prompt_id)
  );
  CREATE TABLE IF NOT EXISTS attempts (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    prompt_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    exercise_id TEXT NOT NULL,
    source TEXT NOT NULL,
    verdict TEXT NOT NULL,
    output TEXT NOT NULL,
    passed INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (hero_id, id)
  );
  CREATE TABLE IF NOT EXISTS encounter_completions (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    encounter_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (hero_id, encounter_id, stage_id)
  );
`;

const heroColumns = 'id, name, path, last_page AS lastPage, updated_at AS updatedAt';
const levelFields = ['scout', 'forge', 'explained', 'side', 'answer', 'code'];
const legacyTables = ['profile', 'progress', 'responses', 'attempts'];

function transaction(db, action, mode = 'IMMEDIATE') {
  db.exec(`BEGIN ${mode}`);
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function heroName(input) {
  const name = input.trim();
  const nameKey = name.normalize('NFKC').toLowerCase().trim();
  if (!nameKey) throw new RangeError('Hero name cannot be blank.');
  return { name, name_key: nameKey };
}

function heroWrite(action) {
  try {
    return action();
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(error.errcode)) {
      throw Object.assign(new Error('A hero with that name or ID already exists.', { cause: error }), {
        code: 'HERO_EXISTS',
        errcode: error.errcode,
      });
    }
    throw error;
  }
}

function migrate(db) {
  transaction(db, () => {
    const existing = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all().map(row => row.name));
    const legacy = existing.has('heroes') ? [] : legacyTables.filter(name => existing.has(name));
    for (const table of legacy) db.exec(`ALTER TABLE ${table} RENAME TO _legacy_${table}`);
    db.exec(schema);
    if (legacy.length === 0) return;

    const hasData = legacy.some(table => db.prepare(`SELECT 1 FROM _legacy_${table} LIMIT 1`).get());
    if (hasData) {
      const profile = legacy.includes('profile')
        ? db.prepare('SELECT callsign, path, last_page FROM _legacy_profile WHERE id = 1').get()
        : undefined;
      const identity = heroName(profile?.callsign?.trim() || 'Recovered Hero');
      const heroId = randomUUID();
      db.prepare(`INSERT INTO heroes (id, name, name_key, path, last_page, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(heroId, identity.name, identity.name_key,
        profile?.path ?? 'all', profile?.last_page ?? 1, new Date().toISOString());

      const migrationColumns = {
        progress: 'level, scout, forge, explained, side, answer, code',
        responses: 'page, prompt_id, value, feedback, correct',
        attempts: 'id, page, prompt_id, level, exercise_id, source, verdict, output, passed, failed, created_at',
      };
      for (const [table, columns] of Object.entries(migrationColumns)) {
        if (!legacy.includes(table)) continue;
        db.prepare(`INSERT INTO ${table} (hero_id, ${columns})
          SELECT ?, ${columns} FROM _legacy_${table}`).run(heroId);
      }
    }
    for (const table of legacy) db.exec(`DROP TABLE _legacy_${table}`);
  });
}

function upsert(db, table, keys, changes) {
  const primary = Object.keys(keys);
  const fields = Object.keys(changes);
  if (fields.length === 0) return;
  const columns = [...primary, ...fields];
  const assignments = fields.map(field => `${field} = excluded.${field}`);
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT (${primary.join(', ')}) DO UPDATE SET ${assignments.join(', ')}`)
    .run(...Object.values(keys), ...Object.values(changes));
}

export async function openStore({ file }) {
  await mkdir(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const readHero = id => {
    const row = db.prepare(`SELECT ${heroColumns} FROM heroes WHERE id = ?`).get(id);
    return row && { ...row };
  };
  const touchHero = id => {
    db.prepare('UPDATE heroes SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  };

  return {
    label: 'SQLite',
    heroes() {
      return db.prepare(`SELECT ${heroColumns} FROM heroes ORDER BY updated_at DESC, name_key, id`)
        .all().map(row => ({ ...row }));
    },
    createHero({ id, name, path = 'all' }) {
      const identity = heroName(name);
      heroWrite(() => db.prepare(`INSERT INTO heroes (id, name, name_key, path, updated_at)
        VALUES (?, ?, ?, ?, ?)`).run(id, identity.name, identity.name_key, path, new Date().toISOString()));
      return readHero(id);
    },
    hero: readHero,
    progress(heroId) {
      return transaction(db, () => {
        const hero = readHero(heroId);
        if (!hero) return undefined;
        const levels = db.prepare(`SELECT level, scout, forge, explained, side, answer, code
          FROM progress WHERE hero_id = ? ORDER BY level`).all(heroId);
        const responses = db.prepare(`SELECT page, prompt_id AS promptId, value, feedback, correct
          FROM responses WHERE hero_id = ? ORDER BY page, prompt_id`).all(heroId);
        const attempts = db.prepare(`SELECT page, prompt_id AS promptId, level, exercise_id AS exerciseId,
          verdict, output, passed, failed, created_at AS createdAt
          FROM attempts WHERE hero_id = ? ORDER BY id DESC LIMIT 100`).all(heroId);
        return {
          profile: { id: hero.id, callsign: hero.name, path: hero.path, lastPage: hero.lastPage },
          levels: levels.map(({ explained, ...row }) => ({ ...row, scout: !!row.scout, forge: !!row.forge,
            explain: !!explained, side: !!row.side, answer: row.answer ?? '', code: row.code ?? '' })),
          responses: responses.map(row => ({ ...row, correct: row.correct == null ? null : !!row.correct })),
          attempts: attempts.map(row => ({ ...row })),
        };
      }, 'DEFERRED');
    },
    response(heroId, page, promptId) {
      const row = db.prepare('SELECT value FROM responses WHERE hero_id = ? AND page = ? AND prompt_id = ?')
        .get(heroId, page, promptId);
      return row && { ...row };
    },
    encounterResults(heroId, encounterId) {
      const rows = db.prepare(`SELECT stage_id, result FROM encounter_completions
        WHERE hero_id = ? AND encounter_id = ?`).all(heroId, encounterId);
      return new Map(rows.map(row => [row.stage_id, JSON.parse(row.result)]));
    },
    recordEncounterStage(heroId, encounterId, stageId, result) {
      transaction(db, () => {
        const { changes } = db.prepare(`INSERT INTO encounter_completions
          (hero_id, encounter_id, stage_id, result) VALUES (?, ?, ?, ?)
          ON CONFLICT (hero_id, encounter_id, stage_id) DO NOTHING`)
          .run(heroId, encounterId, stageId, JSON.stringify(result));
        if (changes) touchHero(heroId);
      });
    },
    saveProfile(heroId, { callsign, path, last_page: lastPage }) {
      const changes = {};
      if (callsign !== undefined) Object.assign(changes, heroName(callsign));
      if (path !== undefined) changes.path = path;
      if (lastPage !== undefined) changes.last_page = lastPage;
      if (Object.keys(changes).length === 0) return;
      changes.updated_at = new Date().toISOString();
      const fields = Object.keys(changes).map(field => `${field} = ?`);
      heroWrite(() => db.prepare(`UPDATE heroes SET ${fields.join(', ')} WHERE id = ?`)
        .run(...Object.values(changes), heroId));
    },
    saveLevel(heroId, level, fields) {
      const changes = {};
      for (const field of levelFields) {
        if (!Object.hasOwn(fields, field)) continue;
        changes[field] = typeof fields[field] === 'boolean' ? Number(fields[field]) : fields[field];
      }
      if (Object.keys(changes).length === 0) return;
      transaction(db, () => {
        upsert(db, 'progress', { hero_id: heroId, level }, changes);
        touchHero(heroId);
      });
    },
    saveResponse(heroId, page, promptId, value, feedback, correct = null) {
      transaction(db, () => {
        upsert(db, 'responses', { hero_id: heroId, page, prompt_id: promptId },
          { value, feedback, correct: correct == null ? null : Number(correct) });
        touchHero(heroId);
      });
    },
    recordAttempt(heroId, entry) {
      transaction(db, () => {
        db.prepare(`INSERT INTO attempts (hero_id, id, page, prompt_id, level, exercise_id,
          source, verdict, output, passed, failed, created_at)
          VALUES (?, (SELECT COALESCE(MAX(id), 0) + 1 FROM attempts WHERE hero_id = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(heroId, heroId, entry.page, entry.promptId,
          entry.level, entry.exerciseId, entry.code, entry.verdict, entry.output, entry.passed,
          entry.failed, new Date().toISOString());
        if (entry.verdict === 'pass') {
          upsert(db, 'progress', { hero_id: heroId, level: entry.level }, { forge: 1 });
        }
        touchHero(heroId);
      });
    },
    close() { db.close(); },
  };
}
