import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rmdir, stat, unlink } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mutationHeaders = { 'Content-Type': 'application/json', 'X-Ferrum-Request': '1' };
const worldExtensions = {javascript: 'js', typescript: 'ts', go: 'go'};
let database;
let child;
let base;

async function start() {
  const env = {
    ...process.env,
    PORT: '0',
    FERRUM_DB: database,
    // The HTTP suite is deterministic and never invokes the Docker engine.
    DOCKER_CONTEXT: '',
    DOCKER_HOST: 'tcp://127.0.0.1:2375',
  };
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  try {
    const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(10000) });
    assert.match(line, /^Ferrum at http:\/\/127\.0\.0\.1:\d+ \(SQLite\)$/);
    [base] = line.match(/http:\/\/127\.0\.0\.1:\d+/);
  } catch (error) {
    throw new Error(`Ferrum did not start. ${stderr}`, { cause: error });
  } finally {
    lines.close();
  }
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

before(async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ferrum-http-'));
  database = join(folder, 'ferrum.sqlite');
  await start();
});

after(async () => {
  await stop();
  if (!database) return;
  const {dir, name, ext} = parse(database);
  const worldDatabases = Object.keys(worldExtensions).map(id => join(dir, `${name}.${id}${ext}`));
  for (const file of [database, ...worldDatabases]) {
    for (const suffix of ['', '-wal', '-shm']) {
      await unlink(file + suffix).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  await rmdir(join(database, '..'));
});

async function request(path, { method = 'GET', hero, headers = {}, body, rawBody, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(hero ? { 'X-Ferrum-Hero': hero.id } : {}),
      ...(body === undefined && rawBody === undefined ? {} : mutationHeaders),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const contentType = response.headers.get('Content-Type');
  const payload = contentType?.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, status, `${method} ${path}: ${response.statusText}`);
  if (status >= 400) assert.equal(typeof payload.error, 'string');
  return { payload, response };
}

async function createHero(name, path) {
  const { payload, response } = await request('/api/heroes', {
    method: 'POST', body: { name, path }, status: 201,
  });
  return { hero: payload.hero, cookie: response.headers.get('Set-Cookie') };
}

function chunkedStatus(path, { headers, chunks = [] }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method: 'POST', headers }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    req.once('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('reader serves the book and blocks access to private project files', async () => {
  const { payload: home, response } = await request('/');
  assert.match(home.toString(), /<title>Ferrum \| Rust Campaign<\/title>/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const {response: progressionModule} = await request('/progression.mjs', {method: 'HEAD'});
  assert.equal(progressionModule.headers.get('Content-Type'), 'text/javascript; charset=utf-8');

  const { payload: image, response: imageResponse } = await request('/book/pages/559.webp');
  assert.equal(imageResponse.headers.get('Content-Type'), 'image/webp');
  assert.equal(image.subarray(0, 4).toString(), 'RIFF');
  assert.equal(image.subarray(8, 12).toString(), 'WEBP');
  const { payload: pdfHead, response: pdfResponse } =
    await request('/book/ferrum-expedition.pdf', { method: 'HEAD' });
  assert.equal(pdfResponse.headers.get('Content-Type'), 'application/pdf');
  assert.ok(Number(pdfResponse.headers.get('Content-Length')) > 0);
  assert.equal(pdfHead.length, 0);

  assert.match(home.toString(), /href="\/book\/ferrum-field-kit\.zip"/);
  const { payload: fieldKit, response: fieldKitResponse } = await request('/book/ferrum-field-kit.zip');
  assert.equal(fieldKitResponse.headers.get('Content-Type'), 'application/zip');
  assert.equal(fieldKit.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(fieldKit.includes('campaign/Quest_Journal.txt'));

  for (const path of ['/data/exercises.json', '/state/ferrum.sqlite', '/book/pages/560.webp',
    '/book/%2E%2E/server.mjs', '/book/pages/%2F..%2Findex.html', '/api/not-a-route']) {
    await request(path, { status: 404 });
  }
});

test('public campaign data reveals instructions and questions but excludes answers and tests', async () => {
  const { payload: campaign, response } = await request('/api/campaign');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(campaign.total, 559);
  assert.equal(campaign.quests.length, 42);
  assert.ok(campaign.exercises.length > 0);
  assert.ok(campaign.rooms.length > 0);
  for (const quest of campaign.quests) {
    for (const secret of ['hint1', 'hint2', 'debrief']) assert.ok(!Object.hasOwn(quest, secret));
  }
  for (const exercise of campaign.exercises) {
    assert.ok(exercise.testNames.length > 0);
    for (const secret of ['tests', 'solution']) assert.ok(!Object.hasOwn(exercise, secret));
  }
  for (const room of campaign.rooms) {
    for (const choice of room.choices) assert.ok(!Object.hasOwn(choice, 'result'));
  }
  for (const number of [1, campaign.rooms[0].page, campaign.quests[0].manualPage, campaign.total]) {
    const { payload: page } = await request(`/api/pages/${number}`);
    assert.equal(page.page, number);
    assert.equal(page.total, campaign.total);
    for (const prompt of page.prompts) {
      for (const secret of ['correctOption', 'feedback', 'feedbackByOption']) {
        assert.ok(!Object.hasOwn(prompt, secret));
      }
    }
  }
  const { payload: hint } = await request('/api/levels/1/reveal/hint1');
  assert.match(hint.text, /owner/);
  for (const path of ['/api/pages/0', '/api/pages/560', '/api/levels/43/reveal/hint1',
    '/api/levels/1/reveal/solution']) await request(path, { status: 404 });
});

test('mutations enforce local origin, JSON size and shape, and valid hero sessions', async () => {
  const signup = '/api/heroes';
  const mutation = { method: 'POST', body: { name: 'Blocked hero' } };
  await request(signup, { ...mutation, headers: { Origin: 'https://outside.invalid' }, status: 403 });
  await request(signup, { ...mutation, headers: { 'X-Ferrum-Request': '0' }, status: 403 });
  assert.equal(await chunkedStatus(signup, {
    headers: { ...mutationHeaders, Host: `outside.invalid:${new URL(base).port}` },
    chunks: [JSON.stringify(mutation.body)],
  }), 403);
  await request(signup, { ...mutation, headers: { 'Content-Type': 'text/plain' }, status: 415 });
  for (const rawBody of ['{', 'null', '[]', '42', '"hero"']) {
    await request(signup, { method: 'POST', rawBody, status: 400 });
  }
  const largeBody = JSON.stringify({ name: 'x'.repeat(130 * 1024) });
  await request(signup, { method: 'POST', rawBody: largeBody, status: 413 });
  assert.equal(await chunkedStatus(signup, {
    headers: mutationHeaders, chunks: [largeBody.slice(0, 65536), largeBody.slice(65536)],
  }), 413);

  for (const body of [{ name: ' ' }, { name: 'Ada\u0000Ada' }, { name: 'é'.repeat(31) }, { name: '\u0344'.repeat(30) },
    { name: 'Visitor', path: 'teleport' }]) {
    await request(signup, { method: 'POST', body, status: 400 });
  }
  const { payload: { heroes } } = await request(signup);
  assert.deepEqual(heroes, []);
  await request('/api/progress', { status: 401 });
  await request('/api/progress', { headers: { 'X-Ferrum-Hero': 'bad' }, status: 401 });
  await request('/api/progress', { hero: { id: randomUUID() }, status: 401 });
  await request('/api/heroes/load', { method: 'POST', body: { id: 'bad' }, status: 400 });
  await request('/api/heroes/load', { method: 'POST', body: { id: randomUUID() }, status: 404 });
  await request(signup, {
    method: 'POST', body: { name: 'Local hero' }, status: 201,
    headers: { 'Content-Type': 'Application/JSON; charset=UTF-8', Origin: base },
  });
});

test('hero choice, written drafts, progress, and reading position persist in separate save slots', async () => {
  const { hero: a, cookie } = await createHero('  Éowyn  ', 'delver');
  const { hero: b } = await createHero('Warden', 'warden');
  assert.equal(a.name, 'Éowyn');
  assert.equal(a.lastPage, 1);
  assert.match(cookie, /^ferrum_hero=[a-f\d-]+; Path=\/; HttpOnly; SameSite=Strict$/);
  await request('/api/heroes', { method: 'POST', body: { name: 'e\u0301OWYN' }, status: 409 });
  const { payload: loaded, response } = await request('/api/heroes/load', {
    method: 'POST', body: { id: b.id },
  });
  assert.deepEqual(loaded.hero, b);
  assert.ok(response.headers.get('Set-Cookie').includes(b.id));
  const cookieHeaders = { Cookie: `ferrum_hero=${b.id}` };
  const { payload: cookieProgress } = await request('/api/progress', { headers: cookieHeaders });
  assert.equal(cookieProgress.profile.id, b.id);

  const answer = { page: 18, promptId: 'checkpoint-1', value: '2' };
  const { payload: correct } = await request('/api/answers', {
    method: 'POST', hero: a, headers: cookieHeaders, body: answer,
  });
  assert.equal(correct.correct, true);
  assert.match(correct.feedback, /independent ownership/);
  const { payload: incorrect } = await request('/api/answers', {
    method: 'POST', hero: b, body: { ...answer, value: '1' },
  });
  assert.equal(incorrect.correct, false);
  const { payload: written } = await request('/api/answers', {
    method: 'POST', hero: a, body: { page: 1, promptId: 'notes', value: 'private notes' },
  });
  assert.equal(written.correct, null);
  await request('/api/answers', { method: 'POST', hero: a, body: { ...answer, page: 17 }, status: 404 });
  await request('/api/answers', { method: 'POST', hero: a, body: { ...answer, value: '9' }, status: 400 });
  await request('/api/answers', {
    method: 'POST', hero: a, body: { ...answer, value: 'é'.repeat(10241) }, status: 400,
  });

  await request('/api/profile', { method: 'PATCH', hero: a, body: { lastPage: 19 } });
  await request('/api/profile', { method: 'PATCH', hero: b, body: { lastPage: 559, path: '' } });
  await request('/api/profile', { method: 'PATCH', hero: b, body: { callsign: a.name }, status: 409 });
  await request('/api/profile', { method: 'PATCH', hero: a, body: { lastPage: '20' }, status: 404 });
  await request('/api/profile', { method: 'PATCH', hero: a, body: {}, status: 400 });
  await request('/api/progress/2', { method: 'PATCH', hero: a, body: { forge: true }, status: 409 });
  await request('/api/answers', {
    method: 'POST', hero: a, body: { page: 37, promptId: 'boss-2', value: 'Move into complete states.' },
  });
  await request('/api/progress/2', { method: 'PATCH', hero: a, body: { forge: true, explain: true } });
  await request('/api/progress/2', { method: 'PATCH', hero: a, body: { side: 'true' }, status: 400 });
  await request('/api/progress/1', { method: 'PATCH', hero: a, body: { forge: true }, status: 409 });
  await request('/api/progress/43', { method: 'PATCH', hero: a, body: { scout: true }, status: 404 });

  await stop();
  await start();
  const { payload: pa } = await request('/api/progress', { hero: a });
  const { payload: pb } = await request('/api/progress', { hero: b });
  assert.deepEqual(pa.profile, { id: a.id, callsign: 'Éowyn', path: 'delver', lastPage: 19 });
  assert.deepEqual(pb.profile, { id: b.id, callsign: 'Warden', path: 'all', lastPage: 559 });
  assert.equal(pa.responses.find(row => row.promptId === 'checkpoint-1').correct, true);
  assert.equal(pb.responses.find(row => row.promptId === 'checkpoint-1').correct, false);
  assert.equal(pa.responses.find(row => row.promptId === 'notes').value, 'private notes');
  assert.equal(pa.levels[0].forge, true);
  assert.equal(pa.levels[0].explain, true);
  assert.equal(pb.responses.length, 1);
  assert.deepEqual(pb.levels, []);
});

test('offline grading validates exercise binding and saves the submission without awarding Forge', async () => {
  const { hero } = await createHero('Forge Scout');
  const { payload: status } = await request('/api/status');
  assert.deepEqual(status, { storage: 'SQLite', runner: 'unavailable' });
  const { payload: page } = await request('/api/pages/26');
  const prompt = page.prompts.find(card => card.exerciseId);
  const body = { page: page.page, promptId: prompt.id, exerciseId: prompt.exerciseId, code: 'pub struct Draft;' };
  const grade = { method: 'POST', hero };
  await request('/api/grade', { ...grade, body: { ...body, exerciseId: 'wrong' }, status: 400 });
  await request('/api/grade', { ...grade, body: { ...body, code: ' \t\n' }, status: 400 });
  await request('/api/grade', { ...grade, body: { ...body, code: 'x'.repeat(49153) }, status: 400 });
  const { payload: prior } = await request('/api/progress', { hero });
  assert.deepEqual(prior.responses, []);

  const { payload: result } = await request('/api/grade', { ...grade, body });
  assert.equal(result.verdict, 'unavailable');
  assert.deepEqual(result.passedTests, []);
  assert.deepEqual(result.failedTests, []);
  const { payload: progress } = await request('/api/progress', { hero });
  assert.equal(progress.responses[0].value, body.code);
  assert.deepEqual(progress.levels, []);
  assert.deepEqual(progress.attempts, []);
});

test('saved answers get the current edition feedback without losing the submitted value', async () => {
  const { hero } = await createHero('Returning Reader');
  const answer = { page: 18, promptId: 'checkpoint-1', value: '2' };
  const { payload: current } = await request('/api/answers', { method: 'POST', hero, body: answer });
  const db = new DatabaseSync(database);
  try {
    db.prepare('UPDATE responses SET feedback = ?, correct = 0 WHERE hero_id = ? AND page = ? AND prompt_id = ?')
      .run('Outdated feedback from an earlier edition', hero.id, answer.page, answer.promptId);
  } finally {
    db.close();
  }
  const { payload: progress } = await request('/api/progress', { hero });
  assert.deepEqual(progress.responses[0], { ...answer, ...current });
});

test('world discovery, reading, and saved progress stay scoped to the selected language', async () => {
  const {payload: {worlds}} = await request('/api/worlds');
  assert.deepEqual(worlds.map(({id, number}) => [id, number]),
    [['javascript', 1], ['typescript', 2], ['rust', 3], ['go', 4]]);
  await request('/api/campaign', {headers: {'X-Ferrum-World': 'unknown'}, status: 404});
  const {payload: legacy} = await request('/api/campaign');
  assert.deepEqual(legacy.world, worlds[2]);
  assert.equal(legacy.total, 559);

  const {hero: rustHero, cookie: rustCookie} = await createHero('Across Worlds');
  const saved = [];
  for (const world of worlds.filter(({id}) => id !== 'rust')) {
    const headers = {'X-Ferrum-World': world.id};
    const {payload: campaign} = await request('/api/campaign', {headers});
    assert.deepEqual(campaign.world, world);
    assert.ok(campaign.quests.length > 0);
    assert.ok(campaign.paths.length > 0);
    const {payload: status} = await request('/api/status', {headers});
    assert.deepEqual(status, {storage: 'SQLite', runner: 'unavailable'});
    const {payload: {heroes}} = await request('/api/heroes', {headers});
    assert.deepEqual(heroes, []);
    const {payload: {hero}, response} = await request('/api/heroes', {
      method: 'POST', headers, body: {name: rustHero.name}, status: 201,
    });
    assert.notEqual(hero.id, rustHero.id);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    assert.equal(cookie, `ferrum_hero_${world.id}=${hero.id}`);
    await request('/api/progress', {headers, hero: rustHero, status: 401});
    await request('/api/progress', {headers: {...headers, Cookie: rustCookie.split(';')[0]}, status: 401});
    await request('/api/progress', {headers: {Cookie: cookie}, status: 401});
    const {payload: ownProgress} = await request('/api/progress', {headers: {...headers, Cookie: cookie}});
    assert.equal(ownProgress.profile.id, hero.id);

    const {level, bossPage} = campaign.quests[0];
    const {payload: page} = await request(`/api/pages/${bossPage}`, {headers});
    assert.ok(page.image.startsWith(`/book/${world.id}/pages/`));
    const {response: pageImage} = await request(page.image, {method: 'HEAD'});
    assert.equal(pageImage.headers.get('Content-Type'), 'image/webp');
    const {response: book} = await request(world.bookUrl, {method: 'HEAD'});
    assert.equal(book.headers.get('Content-Type'), 'application/pdf');
    const {payload: kit, response: kitResponse} = await request(world.kitUrl);
    assert.equal(kitResponse.headers.get('Content-Type'), 'application/zip');
    assert.ok(kit.includes(`examples/level-01.${worldExtensions[world.id]}`));
    assert.ok(kit.includes(`starters/level-01.${worldExtensions[world.id]}`));
    await request(`/api/pages/${campaign.total + 1}`, {headers, status: 404});
    const progress = `/api/progress/${level}`;
    const mark = {method: 'PATCH', headers, hero, body: {forge: true}};
    await request(progress, {...mark, status: 409});
    const draft = {page: bossPage, promptId: `boss-${level}`, value: `Review draft for ${world.name}`};
    await request('/api/answers', {method: 'POST', headers, hero, body: draft});
    await request(progress, mark);
    await request('/api/profile', {method: 'PATCH', headers, hero, body: {lastPage: bossPage}});
    await request('/api/grade', {method: 'POST', headers, hero, body: {}, status: 409});
    saved.push({headers, hero, draft});
  }

  const {dir, name, ext} = parse(database);
  assert.ok((await stat(join(dir, `${name}.go${ext}`))).isFile());
  await request('/state/ferrum.go.sqlite', {status: 404});
  for (const selected of saved) {
    for (const {hero} of saved.filter(other => other !== selected)) {
      await request('/api/progress', {headers: selected.headers, hero, status: 401});
    }
  }
  await stop();
  await start();
  for (const {headers, hero, draft} of saved) {
    const {payload: progress} = await request('/api/progress', {headers, hero});
    assert.equal(progress.profile.lastPage, draft.page);
    assert.equal(progress.responses[0].value, draft.value);
    assert.equal(progress.levels[0].forge, true);
    assert.deepEqual(progress.attempts, []);
  }
  const {payload: rustProgress} = await request('/api/progress', {hero: rustHero});
  assert.deepEqual(rustProgress.responses, []);
  assert.deepEqual(rustProgress.levels, []);
});

test('special encounters grade each stage in order and persist separately from Forge', async () => {
  const headers = { 'X-Ferrum-World': 'javascript' };
  const { payload: { specialEncounters: [hunt] } } = await request('/api/campaign', { headers });
  const { payload: { specialEncounters: [elite] } } = await request('/api/campaign');
  assert.deepEqual([hunt.id, hunt.world, hunt.kind, hunt.level, hunt.page],
    ['stale-signal', 'javascript', 'bug-hunt', 12, 38]);
  assert.deepEqual([elite.id, elite.world, elite.kind, elite.level, elite.page],
    ['ferric-scarab-elite', 'rust', 'elite', 3, 48]);
  for (const encounter of [hunt, elite]) {
    for (const stage of encounter.stages) {
      assert.deepEqual(Object.keys(stage).filter((key) =>
        !['id', 'title', 'prompt', 'actionLabel', 'options', 'code'].includes(key)), []);
      for (const option of stage.options ?? []) {
        assert.deepEqual(Object.keys(option).filter((key) => !['id', 'label', 'code'].includes(key)), []);
      }
    }
  }
  await request('/lib/encounters.mjs', { status: 404 });
  const { response: module } = await request('/special-encounters.mjs', { method: 'HEAD' });
  assert.equal(module.headers.get('Content-Type'), 'text/javascript; charset=utf-8');

  const huntPath = `/api/encounters/${hunt.id}`;
  const elitePath = `/api/encounters/${elite.id}`;
  await request(huntPath, { headers, status: 401 });
  const makeHunter = async (name) => {
    const { payload: { hero } } = await request('/api/heroes', {
      method: 'POST', headers, status: 201, body: { name },
    });
    return hero;
  };
  const hunter = await makeHunter('Signal Tracker');
  const other = await makeHunter('Signal Observer');
  const { hero: smith } = await createHero('Scarab Smith');
  await request(elitePath, { headers, hero: hunter, status: 404 });
  await request(huntPath, { hero: smith, status: 404 });
  const { payload: initial } = await request(huntPath, { headers, hero: hunter });
  assert.deepEqual(initial.completed, []);

  const post = async (path, session, stageId, optionId, status = 200) => {
    const { payload } = await request(path, {
      method: 'POST', ...session, status,
      body: optionId === undefined ? { stageId } : { stageId, optionId },
    });
    return payload;
  };
  const huntSession = { headers, hero: hunter };
  const eliteSession = { hero: smith };
  const incorrectDiagnosis = hunt.stages[0].options.find(({ id }) => id !== 'late-request').id;
  await post(huntPath, huntSession, 'reproduce', undefined, 409);
  await post(huntPath, huntSession, 'diagnose', 'unknown-option', 400);
  const rejected = await post(huntPath, huntSession, 'diagnose', incorrectDiagnosis);
  assert.equal(rejected.result.correct, false);
  assert.deepEqual(rejected.completed, []);

  const [diagnosed, duplicate] = await Promise.all([
    post(huntPath, huntSession, 'diagnose', 'late-request'),
    post(huntPath, huntSession, 'diagnose', 'late-request'),
  ]);
  assert.equal(diagnosed.result.correct, true);
  assert.deepEqual(diagnosed.completed, ['diagnose']);
  assert.deepEqual(duplicate.completed, diagnosed.completed);
  const reproduced = await post(huntPath, huntSession, 'reproduce');
  assert.equal(reproduced.result.correct, true);
  assert.ok(reproduced.result.trace.length > 0);
  assert.deepEqual(reproduced.completed, ['diagnose', 'reproduce']);
  const failedRepair = await post(huntPath, huntSession, 'repair', 'guard-success');
  assert.equal(failedRepair.result.correct, false);
  assert.match(failedRepair.result.checks.find(({ passed }) => !passed).label, /older failure/);
  assert.deepEqual(failedRepair.completed, reproduced.completed);
  const repaired = await post(huntPath, huntSession, 'repair', 'guard-both');
  assert.equal(repaired.result.correct, true);
  assert.equal(repaired.result.checks.length, 4);
  assert.ok(repaired.result.checks.every(({ passed }) => passed));
  assert.deepEqual(repaired.completed, ['diagnose', 'reproduce', 'repair']);
  const retried = await post(huntPath, huntSession, 'diagnose', incorrectDiagnosis);
  assert.equal(retried.result.correct, true);
  assert.deepEqual(retried.completed, repaired.completed);

  await post(elitePath, eliteSession, 'explain', 'separate-regions', 409);
  await post(elitePath, eliteSession, 'diagnose', 'overlapping-borrows');
  const sorted = await post(elitePath, eliteSession, 'repair', 'split-sorted');
  assert.equal(sorted.result.correct, false);
  assert.match(sorted.result.checks.find(({ passed }) => !passed).label, /reversed indices/i);
  assert.deepEqual(sorted.completed, ['diagnose']);
  const tested = await post(elitePath, eliteSession, 'repair', 'split-disjoint');
  assert.deepEqual(tested.completed, ['diagnose', 'repair']);
  assert.equal(tested.result.checks.length, 4);
  assert.ok(tested.result.checks.every(({ passed }) => passed));
  const defeated = await post(elitePath, eliteSession, 'explain', 'separate-regions');
  assert.equal(defeated.result.correct, true);
  assert.deepEqual(defeated.completed, ['diagnose', 'repair', 'explain']);

  await stop();
  await start();
  const { payload: restoredHunt } = await request(huntPath, huntSession);
  const { payload: restoredElite } = await request(elitePath, eliteSession);
  const { payload: otherHunt } = await request(huntPath, { headers, hero: other });
  const { payload: regularProgress } = await request('/api/progress', eliteSession);
  assert.deepEqual(restoredHunt.completed, repaired.completed);
  assert.deepEqual(restoredElite.completed, defeated.completed);
  assert.deepEqual(otherHunt.completed, []);
  assert.deepEqual(regularProgress.levels, []);
});
