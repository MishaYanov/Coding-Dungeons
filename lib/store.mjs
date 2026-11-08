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
  CREATE TABLE IF NOT EXISTS workbench_modes (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'guided' CHECK (mode IN ('guided', 'hard')),
    assisted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hero_id, level)
  );
  CREATE TABLE IF NOT EXISTS workbench_runs (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    PRIMARY KEY (hero_id, run_id)
  );
  CREATE TABLE IF NOT EXISTS workbench_clears (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    hard INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hero_id, exercise_id)
  );
  CREATE TABLE IF NOT EXISTS workbench_attempt_details (
    hero_id TEXT NOT NULL,
    attempt_id INTEGER NOT NULL,
    details TEXT NOT NULL,
    PRIMARY KEY (hero_id, attempt_id),
    FOREIGN KEY (hero_id, attempt_id) REFERENCES attempts(hero_id, id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS written_assessments (
    hero_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    prompt_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    result TEXT,
    PRIMARY KEY (hero_id, page, prompt_id),
    FOREIGN KEY (hero_id, page, prompt_id) REFERENCES responses(hero_id, page, prompt_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS one_life_heroes (
    hero_id TEXT PRIMARY KEY NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    hp INTEGER NOT NULL CHECK (hp BETWEEN 0 AND 100),
    potions INTEGER NOT NULL CHECK (potions >= 0)
  );
  CREATE TABLE IF NOT EXISTS combat_rewards (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    reward_key TEXT NOT NULL,
    PRIMARY KEY (hero_id, reward_key)
  );
  CREATE TABLE IF NOT EXISTS combat_receipts (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    submission_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (hero_id, submission_id)
  );
`;

const heroColumns = `h.id, h.name, h.path, h.last_page AS lastPage, h.updated_at AS updatedAt,
  life.hero_id IS NOT NULL AS oneLife`;
const heroTable = 'heroes h LEFT JOIN one_life_heroes life ON life.hero_id = h.id';
const levelFields = ['scout', 'forge', 'explained', 'side', 'answer', 'code'];
const legacyTables = ['profile', 'progress', 'responses', 'attempts'];
const maxHp = 100;
const wrongSubmissionDamage = 5;
const potionHealing = 20;
const emptyCombatEvent = Object.freeze({damage:0, healing:0, potionsEarned:0});

function transaction(db, action, mode = 'IMMEDIATE') {
  // A combat submission can write an answer or attempt within its transaction.
  if (db.isTransaction) return action();
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

function heroRecord({oneLife, ...row}) {
  return oneLife ? {...row, oneLife:true} : row;
}

function combatError(code, message) {
  return Object.assign(new Error(message), {code});
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
    const row = db.prepare(`SELECT ${heroColumns} FROM ${heroTable} WHERE h.id = ?`).get(id);
    return row && heroRecord(row);
  };
  const touchHero = id => {
    db.prepare('UPDATE heroes SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  };
  const workbenchMode = (heroId, level) => {
    const row = db.prepare('SELECT mode, assisted FROM workbench_modes WHERE hero_id = ? AND level = ?')
      .get(heroId, level);
    return { mode: row?.mode ?? 'guided', assisted: !!row?.assisted };
  };
  const combatState = heroId => {
    const life = db.prepare('SELECT hp, potions FROM one_life_heroes WHERE hero_id = ?').get(heroId);
    const completedTrials = db.prepare(`SELECT substr(reward_key, 7) AS id FROM combat_rewards
      WHERE hero_id = ? AND reward_key GLOB 'trial:*' ORDER BY reward_key`).all(heroId).map(row => row.id);
    return {mode:life ? 'one-life' : 'standard', hp:life?.hp ?? null, maxHp:life ? maxHp : null,
      potions:life?.potions ?? 0, fallen:life?.hp === 0, completedTrials};
  };
  const combatReceipt = (heroId, {id, fingerprint}) => {
    const receipt = db.prepare(`SELECT fingerprint, result FROM combat_receipts
      WHERE hero_id = ? AND submission_id = ?`).get(heroId, id);
    if (!receipt) return undefined;
    if (receipt.fingerprint !== fingerprint) {
      throw combatError('COMBAT_SUBMISSION_CONFLICT', 'This submission ID has already been used.');
    }
    return {result:JSON.parse(receipt.result), combat:combatState(heroId), combatEvent:emptyCombatEvent, replayed:true};
  };
  const runCombatAction = (heroId, submission, action) => transaction(db, () => {
    const prior = combatReceipt(heroId, submission);
    if (prior) return prior;
    const before = combatState(heroId);
    if (before.fallen) throw combatError('HERO_FALLEN', 'This hero has fallen.');
    const {result, combatEvent} = action(before);
    db.prepare(`INSERT INTO combat_receipts (hero_id, submission_id, fingerprint, result)
      VALUES (?, ?, ?, ?)`).run(heroId, submission.id, submission.fingerprint, JSON.stringify(result));
    touchHero(heroId);
    return {result, combat:combatState(heroId), combatEvent, replayed:false};
  });

  return {
    label: 'SQLite',
    heroes() {
      return db.prepare(`SELECT ${heroColumns} FROM ${heroTable} ORDER BY h.updated_at DESC, h.name_key, h.id`)
        .all().map(heroRecord);
    },
    createHero({ id, name, path = 'all', oneLife = false }) {
      const identity = heroName(name);
      transaction(db, () => {
        heroWrite(() => db.prepare(`INSERT INTO heroes (id, name, name_key, path, updated_at)
          VALUES (?, ?, ?, ?, ?)`).run(id, identity.name, identity.name_key, path, new Date().toISOString()));
        if (oneLife) db.prepare('INSERT INTO one_life_heroes (hero_id, hp, potions) VALUES (?, ?, 1)').run(id, maxHp);
      });
      return readHero(id);
    },
    hero: readHero,
    combatState,
    combatReceipt,
    settleCombat(heroId, submission, write = () => null) {
      return runCombatAction(heroId, submission, before => {
        const result = write() ?? null;
        if (typeof result?.then === 'function') throw new TypeError('Combat submission writes must be synchronous.');
        const {wrong, rewardKey, trialId} = submission;
        const reward = trialId ? `trial:${trialId}` : rewardKey;
        const oneLife = before.mode === 'one-life';
        const damage = wrong && oneLife ? Math.min(before.hp, wrongSubmissionDamage) : 0;
        let potionsEarned = 0;
        if (!wrong && reward && (oneLife || trialId)) {
          const {changes} = db.prepare(`INSERT INTO combat_rewards (hero_id, reward_key) VALUES (?, ?)
            ON CONFLICT (hero_id, reward_key) DO NOTHING`).run(heroId, reward);
          if (oneLife) potionsEarned = Number(changes);
        }
        if (damage || potionsEarned) {
          db.prepare('UPDATE one_life_heroes SET hp = hp - ?, potions = potions + ? WHERE hero_id = ?')
            .run(damage, potionsEarned, heroId);
        }
        return {result, combatEvent:{damage, healing:0, potionsEarned}};
      });
    },
    consumePotion(heroId, submission) {
      return runCombatAction(heroId, submission, before => {
        if (!before.potions) throw combatError('POTION_UNAVAILABLE', 'This hero has no potions.');
        const healing = Math.min(potionHealing, maxHp - before.hp);
        if (!healing) throw combatError('HEALTH_FULL', 'Health is already full.');
        db.prepare('UPDATE one_life_heroes SET hp = hp + ?, potions = potions - 1 WHERE hero_id = ?')
          .run(healing, heroId);
        return {result:null, combatEvent:{damage:0, healing, potionsEarned:0}};
      });
    },
    progress(heroId) {
      return transaction(db, () => {
        const hero = readHero(heroId);
        if (!hero) return undefined;
        const levels = db.prepare(`SELECT level, scout, forge, explained, side, answer, code
          FROM progress WHERE hero_id = ? ORDER BY level`).all(heroId);
        const responses = db.prepare(`SELECT r.page, r.prompt_id AS promptId, r.value, r.feedback,
          r.correct, a.result FROM responses r LEFT JOIN written_assessments a
          USING (hero_id, page, prompt_id) WHERE r.hero_id = ? ORDER BY r.page, r.prompt_id`).all(heroId);
        const attempts = db.prepare(`SELECT a.page, a.prompt_id AS promptId, a.level, a.exercise_id AS exerciseId,
          a.verdict, a.output, a.passed, a.failed, a.created_at AS createdAt, d.details
          FROM attempts a LEFT JOIN workbench_attempt_details d ON (d.hero_id = a.hero_id AND d.attempt_id = a.id)
          WHERE a.hero_id = ? ORDER BY a.id DESC LIMIT 100`).all(heroId);
        return {
          profile: { id: hero.id, callsign: hero.name, path: hero.path, lastPage: hero.lastPage },
          levels: levels.map(({ explained, ...row }) => ({ ...row, scout: !!row.scout, forge: !!row.forge,
            explain: !!explained, side: !!row.side, answer: row.answer ?? '', code: row.code ?? '' })),
          responses: responses.map(({result, ...row}) => ({ ...row, correct: row.correct == null ? null : !!row.correct,
            ...(result ? {assessment: JSON.parse(result)} : {}) })),
          attempts: attempts.map(({details, ...row}) => ({ ...row, ...(details ? JSON.parse(details) : {}) })),
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
        db.prepare('DELETE FROM written_assessments WHERE hero_id = ? AND page = ? AND prompt_id = ?')
          .run(heroId, page, promptId);
        touchHero(heroId);
      });
    },
    startAssessment(heroId, page, promptId, value) {
      const requestId = randomUUID();
      transaction(db, () => {
        const key = { hero_id: heroId, page, prompt_id: promptId };
        upsert(db, 'responses', key, { value, feedback: 'Your response is saved.', correct: null });
        upsert(db, 'written_assessments', key, { request_id: requestId, result: null });
        touchHero(heroId);
      });
      return requestId;
    },
    completeAssessment(heroId, page, promptId, requestId, result) {
      return !!db.prepare(`UPDATE written_assessments SET result = ?
        WHERE hero_id = ? AND page = ? AND prompt_id = ? AND request_id = ?`)
        .run(JSON.stringify(result), heroId, page, promptId, requestId).changes;
    },
    workbenchMode,
    setWorkbenchMode(heroId, level, mode) {
      upsert(db, 'workbench_modes', { hero_id: heroId, level }, { mode });
      return workbenchMode(heroId, level);
    },
    revealWorkbenchAid(heroId, level, allowHard = false) {
      return transaction(db, () => {
        if (!allowHard && workbenchMode(heroId, level).mode === 'hard') return false;
        upsert(db, 'workbench_modes', { hero_id: heroId, level }, { assisted: 1 });
        return true;
      });
    },
    workbenchState(heroId) {
      const modes = db.prepare('SELECT level, mode, assisted FROM workbench_modes WHERE hero_id = ? ORDER BY level')
        .all(heroId).map(row => ({ ...row, assisted: !!row.assisted }));
      const hardClears = db.prepare('SELECT DISTINCT level FROM workbench_clears WHERE hero_id = ? AND hard = 1 ORDER BY level')
        .all(heroId).map(row => row.level);
      const clears = db.prepare(`SELECT exercise_id FROM workbench_clears WHERE hero_id = ?
        UNION SELECT exercise_id FROM attempts WHERE hero_id = ? AND verdict = 'pass' ORDER BY exercise_id`)
        .all(heroId, heroId).map(row => row.exercise_id);
      return { modes, hardClears, clears };
    },
    recordAttempt(heroId, entry) {
      if (entry.purpose === 'examples') return { newClear: false, hardClear: false };
      return transaction(db, () => {
        const existingClear = db.prepare('SELECT hard FROM workbench_clears WHERE hero_id = ? AND exercise_id = ?')
          .get(heroId, entry.exerciseId);
        if (entry.runId && !db.prepare(`INSERT INTO workbench_runs (hero_id, run_id) VALUES (?, ?)
          ON CONFLICT (hero_id, run_id) DO NOTHING`).run(heroId, entry.runId).changes) {
          return { newClear: false, hardClear: !!existingClear?.hard };
        }
        const earlierPass = existingClear || db.prepare(`SELECT 1 FROM attempts
          WHERE hero_id = ? AND exercise_id = ? AND verdict = 'pass' LIMIT 1`).get(heroId, entry.exerciseId);
        const inserted = db.prepare(`INSERT INTO attempts (hero_id, id, page, prompt_id, level, exercise_id,
          source, verdict, output, passed, failed, created_at)
          VALUES (?, (SELECT COALESCE(MAX(id), 0) + 1 FROM attempts WHERE hero_id = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(heroId, heroId, entry.page, entry.promptId,
          entry.level, entry.exerciseId, entry.code, entry.verdict, entry.output, entry.passed,
          entry.failed, new Date().toISOString());
        if (entry.runId) {
          const {mode, purpose, suiteRevision, compileMs, runtimeMs, elapsedMs, groups, cases} = entry;
          db.prepare('INSERT INTO workbench_attempt_details (hero_id, attempt_id, details) VALUES (?, ?, ?)')
            .run(heroId, inserted.id, JSON.stringify({mode, purpose, suiteRevision, compileMs, runtimeMs, elapsedMs, groups, cases}));
        }
        const passed = entry.verdict === 'pass';
        const currentMode = workbenchMode(heroId, entry.level);
        const earnedHard = passed && entry.mode === 'hard' && currentMode.mode === 'hard' && !currentMode.assisted;
        const hardClear = !!existingClear?.hard || earnedHard;
        if (passed) {
          upsert(db, 'progress', { hero_id: heroId, level: entry.level }, { forge: 1 });
          upsert(db, 'workbench_clears', { hero_id: heroId, exercise_id: entry.exerciseId },
            { level: entry.level, hard: Number(hardClear) });
        }
        touchHero(heroId);
        return { newClear: passed && !earlierPass, hardClear };
      });
    },
    close() { db.close(); },
  };
}
