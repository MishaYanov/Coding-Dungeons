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
    DUNGEONS_NATIVE_RUNNER_DIR: '',
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

const javascriptWorld = {'X-Ferrum-World':'javascript'};
const rustChoice = {page:18, promptId:'checkpoint-1', value:'4'};
const jsTrial = 'dispatch-floor-trial';
const trialAnswers = {'relay-order':'b', 'badge-identity':'c'};

async function createOneLifeHero(name, headers) {
  const {payload:{hero}} = await request('/api/heroes', {method:'POST', headers, body:{name, oneLife:true}, status:201});
  return hero;
}

test('the hidden diamond opens a private two-stage ambush and awards the bag once', async () => {
  const headers = javascriptWorld;
  const hero = await createOneLifeHero('Gem Hunter', headers);
  await request('/api/diamond?page=1', {headers, status:401});
  await request('/api/diamond?page=0', {hero, headers, status:404});
  const submit = (body, status = 200) => request('/api/diamond/submit', {
    method:'POST', hero, headers, body:{submissionId:randomUUID(), ...body}, status,
  }).then(({payload}) => payload);
  await submit({stageId:'code', code:'function sumDiamonds(counts) { return 0; }'}, 404);
  const sightings = await Promise.all(Array.from({length:8}, async (_, index) => ({
    page:index + 1, ...(await request(`/api/diamond?page=${index + 1}`, {hero, headers})).payload,
  })));
  const found = sightings.filter(({sparkle}) => sparkle);
  assert.equal(found.length, 1);
  assert.equal(found[0].encounter, null);
  assert.equal(found[0].diamonds, 0);
  const start = (page, status = 200) => request('/api/diamond/start', {
    method:'POST', hero, headers, body:{page}, status,
  }).then(({payload}) => payload);
  await start(sightings.find(({sparkle}) => !sparkle).page, 404);
  const ambush = await start(found[0].page);
  assert.equal(ambush.sparkle, null);
  assert.deepEqual(ambush.encounter.stages.map(({id}) => id), ['code','choice']);
  const [codeStage, choiceStage] = ambush.encounter.stages;
  for (const field of ['tests','testNamesSealed','solution','answer','correctOption','explanation']) {
    assert.equal(Object.hasOwn(codeStage, field), false);
    assert.equal(Object.hasOwn(choiceStage, field), false);
  }
  await submit({stageId:'choice', optionId:'slice'}, 409);

  const wrongCode = 'function sumDiamonds(counts) { return 0; }';
  const practice = await submit({stageId:'code', code:wrongCode, purpose:'examples'});
  assert.equal(practice.combat.hp, 100);
  assert.deepEqual(practice.completed, []);
  const wrong = {stageId:'code', code:wrongCode, submissionId:randomUUID()};
  const miss = await submit(wrong);
  assert.equal(miss.result.verdict, 'fail');
  assert.equal(miss.combat.hp, 95);
  assert.equal(miss.combatEvent.damage, 5);
  const retry = await submit(wrong);
  assert.equal(retry.combat.hp, 95);
  assert.equal(retry.combatEvent.damage, 0);
  await submit({...wrong, code:wrongCode + '\n// different submission'}, 409);
  const loaded = (await request('/api/diamond?page=8', {hero, headers})).payload;
  assert.equal(loaded.draft, wrongCode);
  assert.equal(loaded.sparkle, null);

  const solvedCode = await submit({stageId:'code',
    code:'function sumDiamonds(counts) { return counts.reduce((sum, count) => sum + Math.max(0, count), 0); }'});
  assert.equal(solvedCode.result.verdict, 'pass');
  assert.deepEqual(solvedCode.completed, ['code']);
  assert.equal(solvedCode.diamonds, 0);
  const wrongChoice = await submit({stageId:'choice', optionId:'sort'});
  assert.equal(wrongChoice.combat.hp, 90);
  assert.equal(wrongChoice.result.correct, false);
  const rightChoice = {stageId:'choice', optionId:'slice', submissionId:randomUUID()};
  const win = await submit(rightChoice);
  assert.deepEqual(win.completed, ['code','choice']);
  assert.equal(win.diamonds, 3);
  assert.equal(win.combat.potions, 2);
  const winReplay = await submit(rightChoice);
  assert.equal(winReplay.combatEvent.potionsEarned, 0);
  assert.equal((await submit({stageId:'choice', optionId:'slice'})).diamonds, 3);
  const reloaded = (await request(`/api/diamond?page=${found[0].page}`, {hero, headers})).payload;
  assert.equal(reloaded.sparkle, null);
  assert.equal(reloaded.diamonds, 3);
  assert.deepEqual((await request('/api/progress', {hero, headers})).payload.workbench.clears, []);
});

test('One Life charges one wrong answer once and a potion heals only missing HP', async () => {
  await request('/api/heroes', {method:'POST', body:{name:'Invalid mode',oneLife:'true'}, status:400});
  const hero = await createOneLifeHero('Potion Keeper');
  const {payload:initial} = await request('/api/progress', {hero});
  assert.equal(initial.combat.oneLife, true);
  assert.equal(initial.combat.hp, 100);
  assert.equal(initial.combat.potions, 1);
  const body = {...rustChoice, submissionId:randomUUID()};
  const {payload:wrong} = await request('/api/answers', {method:'POST', hero, body});
  assert.equal(wrong.correct, false);
  assert.equal(wrong.combat.hp, 95);
  assert.equal(wrong.combatEvent.damage, 5);
  const {payload:retry} = await request('/api/answers', {method:'POST', hero, body});
  assert.equal(retry.combat.hp, 95);
  assert.equal(retry.combatEvent.damage, 0);
  await request('/api/answers', {method:'POST', hero, body:{...body,value:'2'}, status:409});
  const potion = {submissionId:randomUUID()};
  const {payload:healed} = await request('/api/combat/potion', {method:'POST', hero, body:potion});
  assert.equal(healed.combat.hp, 100);
  assert.equal(healed.combat.potions, 0);
  assert.equal(healed.combatEvent.healing, 5);
  const {payload:healedRetry} = await request('/api/combat/potion', {method:'POST', hero, body:potion});
  assert.equal(healedRetry.combatEvent.healing, 0);
  const {payload:progress} = await request('/api/progress', {hero});
  assert.deepEqual(progress.combat, healed.combat);
  const written = {page:25,promptId:'training-1-3',value:'A draft with no verified score.',submissionId:randomUUID()};
  const {payload:unscored} = await request('/api/answers', {method:'POST', hero, body:written});
  assert.equal(unscored.assessment.score, null);
  assert.equal(unscored.combat.hp, 100);
  assert.equal(unscored.combatEvent.damage, 0);
});

test('Trials are scoped to the world, deal one hit per failed submission, and award a single potion', async () => {
  const headers = javascriptWorld;
  const hero = await createOneLifeHero('Trial Delver', headers);
  const {payload:{trials}} = await request('/api/trials', {headers, hero});
  assert.deepEqual(trials.map(({id}) => id), [jsTrial]);
  assert.ok(trials[0].questions.every(question => !Object.hasOwn(question, 'answer') && !Object.hasOwn(question, 'correctOption')));
  const options = {method:'POST', headers, hero};
  const path = `/api/trials/${jsTrial}`;
  await request(path, {...options, body:{answers:{'relay-order':'b'},submissionId:randomUUID()}, status:400});
  const {payload:miss} = await request(path, {...options, body:{answers:{'relay-order':'a','badge-identity':'a'},submissionId:randomUUID()}});
  assert.equal(miss.correct, false);
  assert.equal(miss.passed, 0);
  assert.equal(miss.combat.hp, 95);
  assert.equal(miss.combatEvent.damage, 5);
  const clear = {answers:trialAnswers, submissionId:randomUUID()};
  const {payload:win} = await request(path, {...options, body:clear});
  assert.equal(win.correct, true);
  assert.equal(win.combat.potions, 2);
  assert.equal(win.combatEvent.potionsEarned, 1);
  assert.deepEqual(win.combat.completedTrials, [jsTrial]);
  const {payload:replay} = await request(path, {...options, body:clear});
  assert.equal(replay.combatEvent.potionsEarned, 0);
  assert.equal(replay.combat.potions, 2);
  await request(path, {...options, body:{...clear, submissionId:randomUUID()}, status:409});
  const {payload:{hero:standard}} = await request('/api/heroes', {method:'POST', headers, body:{name:'Standard Trial'}, status:201});
  const {payload:ordinaryWin} = await request(path, {...options,hero:standard,body:clear});
  assert.equal(ordinaryWin.combat.oneLife, false);
  assert.deepEqual(ordinaryWin.combat.completedTrials, [jsTrial]);
  assert.equal(ordinaryWin.combatEvent.potionsEarned, 0);
});

test('only a failed full Workbench submission costs HP, and a first clear awards loot once', async () => {
  const headers = javascriptWorld;
  const hero = await createOneLifeHero('Workbench Survivor', headers);
  const {payload:{quests:[quest]}} = await request('/api/campaign', {headers});
  const {payload:page} = await request(`/api/pages/${quest.bossPage}`, {headers});
  const prompt = page.prompts.find(item => item.exerciseId);
  const grade = {method:'POST', headers, hero};
  const common = {page:page.page,promptId:prompt.id,exerciseId:prompt.exerciseId};
  const wrong = 'function makeBadge() { return {}; }';
  const {payload:practice} = await request('/api/grade', {...grade,body:{...common,code:wrong,purpose:'examples'}});
  assert.equal(practice.verdict, 'fail');
  assert.equal((await request('/api/progress',{headers,hero})).payload.combat.hp, 100);
  const {payload:timedOut} = await request('/api/grade', {...grade,body:{...common,
    code:'function makeBadge() { while (true) {} }',submissionId:randomUUID()}});
  assert.equal(timedOut.verdict, 'timeout');
  assert.equal(timedOut.combatEvent.damage, 0);
  assert.equal(timedOut.combat.hp, 100);
  const {payload:fail} = await request('/api/grade', {...grade,body:{...common,code:wrong,submissionId:randomUUID()}});
  assert.equal(fail.combat.hp, 95);
  assert.equal(fail.combatEvent.damage, 5);
  const {payload:compileError} = await request('/api/grade', {...grade,body:{...common,
    code:'function makeBadge(',submissionId:randomUUID()}});
  assert.equal(compileError.verdict, 'compile_error');
  assert.equal(compileError.combat.hp, 90);
  const code = 'function makeBadge(name) { return { name: name.trim().toUpperCase(), visits: 0 }; }';
  const submission = {...common,code,submissionId:randomUUID()};
  const {payload:win} = await request('/api/grade', {...grade,body:submission});
  assert.equal(win.newClear, true);
  assert.equal(win.combat.potions, 2);
  const {payload:retry} = await request('/api/grade', {...grade,body:submission});
  assert.equal(retry.newClear, false);
  assert.equal(retry.combatEvent.potionsEarned, 0);
  const {payload:repeat} = await request('/api/grade', {...grade,body:{...submission,submissionId:randomUUID()}});
  assert.equal(repeat.combat.potions, 2);
});

test('falling at zero HP survives a restart and leaves reading and drafts available', async () => {
  const hero = await createOneLifeHero('Fallen Expedition');
  for (let hit = 0; hit < 20; hit++) {
    const {payload:result} = await request('/api/answers', {method:'POST',hero,body:{...rustChoice,submissionId:randomUUID()}});
    assert.equal(result.combat.hp, 95 - hit * 5);
  }
  await stop();
  await start();
  const {payload:progress} = await request('/api/progress',{hero});
  assert.equal(progress.combat.fallen,true);
  assert.equal(progress.combat.hp,0);
  assert.equal(progress.combat.potions,1);
  await request('/api/combat/potion',{method:'POST',hero,body:{submissionId:randomUUID()},status:409});
  await request('/api/answers',{method:'POST',hero,body:{...rustChoice,submissionId:randomUUID()},status:409});
  await request('/api/progress/1',{method:'PATCH',hero,body:{scout:true},status:409});
  await request('/api/pages/26',{hero});
  await request('/api/answers',{method:'POST',hero,body:{page:26,promptId:'boss-1',value:'saved draft'}});
});

test('reader serves the book and blocks access to private project files', async () => {
  const { payload: home, response } = await request('/');
  assert.match(home.toString(), /<title>Coding Dungeons \| Choose a world<\/title>/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const asset = home.toString().match(/<script type="module"[^>]+src="(\/assets\/[\w-]+\.js)"/)?.[1];
  assert.ok(asset, 'The browser and desktop use the built React entry.');
  const {response: rendererModule} = await request(asset, {method: 'HEAD'});
  assert.equal(rendererModule.headers.get('Content-Type'), 'text/javascript; charset=utf-8');

  const { payload: image, response: imageResponse } = await request('/book/pages/559.webp');
  assert.equal(imageResponse.headers.get('Content-Type'), 'image/webp');
  assert.equal(image.subarray(0, 4).toString(), 'RIFF');
  assert.equal(image.subarray(8, 12).toString(), 'WEBP');
  const { payload: pdfHead, response: pdfResponse } =
    await request('/book/ferrum-expedition.pdf', { method: 'HEAD' });
  assert.equal(pdfResponse.headers.get('Content-Type'), 'application/pdf');
  assert.ok(Number(pdfResponse.headers.get('Content-Length')) > 0);
  assert.equal(pdfHead.length, 0);

  const { payload: fieldKit, response: fieldKitResponse } = await request('/book/ferrum-field-kit.zip');
  assert.equal(fieldKitResponse.headers.get('Content-Type'), 'application/zip');
  assert.equal(fieldKit.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(fieldKit.includes('campaign/Quest_Journal.txt'));

  for (const path of ['/data/exercises.json', '/state/ferrum.sqlite', '/book/pages/560.webp', '/app.js',
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
  const hintPath = '/api/levels/1/reveal/hint1';
  await request(hintPath, { method: 'POST', body: {}, status: 401 });
  const { hero } = await createHero('Guide Reader');
  await request(hintPath, { hero, status: 404 });
  await request(hintPath, { method: 'POST', hero, body: {}, headers: { Origin: 'http://127.0.0.1:1' }, status: 403 });
  const { payload: before } = await request('/api/progress', { hero });
  assert.deepEqual(before.workbench.modes, []);
  const { payload: hint } = await request(hintPath, { method: 'POST', hero, body: {} });
  assert.match(hint.text, /owner/);
  for (const path of ['/api/pages/0', '/api/pages/560', '/api/levels/43/reveal/hint1',
    '/api/levels/1/reveal/solution']) await request(path, { status: 404 });
});

test('Hard Mode survives reload and denies guide and authored answer access through the API', async () => {
  const { hero } = await createHero('Hard Reader');
  const { hero: guided } = await createHero('Guided Reader');
  const question = { page: 25, promptId: 'training-1-3' };
  const answer = { ...question, value: 'A shared borrow can end after its last use.' };
  const { payload: page } = await request('/api/pages/25');
  assert.ok(page.prompts.find(prompt => prompt.id === question.promptId).assessment.version);
  const { payload: mode } = await request('/api/workbench/1/mode', { method: 'PATCH', hero, body: { mode: 'hard' } });
  assert.deepEqual(mode, { mode: 'hard', assisted: false });
  await request('/api/levels/1/reveal/hint1', { method: 'POST', body: {}, hero, status: 403 });
  await request('/api/answers/reveal', { method: 'POST', hero, body: question, status: 403 });
  const { payload: graded } = await request('/api/answers', { method: 'POST', hero, body: answer });
  assert.equal(graded.assessment.score, null);
  assert.equal(graded.assessment.status, 'unavailable');
  assert.ok(!Object.hasOwn(graded.assessment, 'criteria'));
  const { payload: saved } = await request('/api/progress', { hero });
  assert.deepEqual(saved.workbench.modes, [{ level: 1, mode: 'hard', assisted: false }]);
  assert.equal(saved.responses[0].assessment.status, 'unavailable');
  assert.equal(saved.responses[0].value, answer.value);
  assert.deepEqual(saved.levels, []);

  const { payload: revealed } = await request('/api/answers/reveal', { method: 'POST', hero: guided, body: question });
  assert.match(revealed.text, /shared borrow/);
  const { payload: guidedProgress } = await request('/api/progress', { hero: guided });
  assert.deepEqual(guidedProgress.workbench.modes, [{ level: 1, mode: 'guided', assisted: true }]);
});

test('Code Workbench runs public examples without victory, then saves a full clear once', async () => {
  const headers = {'X-Ferrum-World': 'javascript'};
  const {payload:{hero}} = await request('/api/heroes', {method:'POST', headers, body:{name:'Workbench Duelist'}, status:201});
  const {payload:campaign} = await request('/api/campaign', {headers});
  const {bossPage:page, level} = campaign.quests[0];
  const {payload:boss} = await request(`/api/pages/${page}`, {headers});
  const prompt = boss.prompts.find(item => item.id === `boss-${level}`);
  const exercise = campaign.exercises.find(item => item.id === prompt.exerciseId);
  assert.ok(exercise, 'the boss is linked to its suite');
  assert.ok(exercise.requiredCases > exercise.testNames.length);
  assert.doesNotMatch(JSON.stringify(exercise), /fresh-badges|blank-name|reference/);
  const requestOptions = {headers, hero, method:'POST'};
  const code = 'function makeBadge(input) { return { name: input.trim().toUpperCase(), visits: 0 }; }';
  const body = {page, promptId:prompt.id, exerciseId:exercise.id, code};

  await request(`/api/workbench/${level}/mode`, {headers, hero, method:'PATCH', body:{mode:'hard'}});
  await request('/api/workbench/suggestion', {...requestOptions, body, status:403});
  const {payload:examples} = await request('/api/grade', {...requestOptions, body:{...body, purpose:'examples'}});
  assert.equal(examples.verdict, 'pass');
  assert.equal(examples.newClear, false);
  assert.equal(examples.purpose, 'examples');
  const {payload:practiced} = await request('/api/progress', {headers, hero});
  assert.deepEqual(practiced.levels, []);
  assert.deepEqual(practiced.attempts, []);
  await request(`/api/progress/${level}`, {headers, hero, method:'PATCH', body:{forge:true}, status:409});

  const {payload:full} = await request('/api/grade', {...requestOptions, body});
  assert.equal(full.verdict, 'pass');
  assert.equal(full.newClear, true);
  assert.equal(full.hardClear, true);
  assert.equal(full.passed, exercise.requiredCases);
  assert.ok(Number.isFinite(full.runtimeMs));
  assert.ok(full.groups.some(item => item.group === 'Identity' && item.passed > 0));
  assert.doesNotMatch(JSON.stringify(full), /fresh-badges|blank-name/);
  const {payload:retry} = await request('/api/grade', {...requestOptions, body});
  assert.equal(retry.newClear, false);
  const {payload:won} = await request('/api/progress', {headers, hero});
  assert.equal(won.levels[0].forge, true);
  assert.deepEqual(won.workbench.hardClears, [level]);
});

test('an authored suggestion is fetched explicitly and marks aid disclosure', async () => {
  const headers = {'X-Ferrum-World':'javascript'};
  const {payload:{hero}} = await request('/api/heroes', {method:'POST', headers, body:{name:'Suggestion Scout'}, status:201});
  const {payload:{quests:[quest]}} = await request('/api/campaign', {headers});
  const {payload:page} = await request(`/api/pages/${quest.bossPage}`, {headers});
  const prompt = page.prompts.find(item => item.exerciseId);
  assert.equal(prompt.suggestion, true);
  const body = {page:page.page, promptId:prompt.id, exerciseId:prompt.exerciseId};
  const {payload:suggestion} = await request('/api/workbench/suggestion', {method:'POST', headers, hero, body});
  assert.match(suggestion.snippet, /trim\(\)/);
  const {payload:saved} = await request('/api/progress', {headers, hero});
  assert.deepEqual(saved.workbench.modes, [{level:1, mode:'guided', assisted:true}]);
});

test('a prior Guided victory does not unlock hints in an uncleared Hard encounter', async () => {
  const headers = {'X-Ferrum-World':'javascript'};
  const {payload:{hero}} = await request('/api/heroes', {method:'POST', headers, body:{name:'A Second Trial'}, status:201});
  const {payload:{quests:[quest]}} = await request('/api/campaign', {headers});
  const {payload:page} = await request(`/api/pages/${quest.bossPage}`, {headers});
  const prompt = page.prompts.find(item => item.exerciseId);
  const code = 'function makeBadge(input) { return { name: input.trim().toUpperCase(), visits: 0 }; }';
  const body = {page:page.page, promptId:prompt.id, exerciseId:prompt.exerciseId, code};
  assert.equal((await request('/api/grade', {headers, hero, method:'POST', body})).payload.verdict, 'pass');
  await request('/api/workbench/1/mode', {headers, hero, method:'PATCH', body:{mode:'hard'}});
  await request('/api/levels/1/reveal/debrief', {method:'POST', body:{}, headers, hero, status:403});
});

test('unscored training submissions reveal the authored answer only on an explicit aid request', async () => {
  const {hero} = await createHero('Training Reader');
  const {payload:page} = await request('/api/pages/25');
  const prompt = page.prompts.find(item => item.id === 'training-1-2');
  assert.equal(prompt.exampleAnswer, true);
  const key = {page:page.page, promptId:prompt.id};
  const {payload:saved} = await request('/api/answers', {hero, method:'POST', body:{...key,value:'My draft'}});
  assert.equal(saved.feedback, 'Your response is saved.');
  const {payload:aid} = await request('/api/answers/reveal', {hero, method:'POST', body:key});
  assert.ok(aid.text.length > saved.feedback.length);
  const {payload:progress} = await request('/api/progress', {hero});
  assert.equal(progress.workbench.modes[0].assisted, true);
});

test('mutations enforce local origin, JSON size and shape, and valid hero sessions', async () => {
  const signup = '/api/heroes';
  const {payload:{heroes:initialHeroes}} = await request(signup);
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
  assert.deepEqual(heroes, initialHeroes);
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
  const {payload:{quests}} = await request('/api/campaign');
  const project = quests.find(quest => quest.level === 5);
  await request('/api/progress/5', { method: 'PATCH', hero: a, body: { forge: true }, status: 409 });
  await request('/api/answers', {
    method: 'POST', hero: a, body: { page: project.bossPage, promptId: 'boss-5', value: 'State the borrowing relationship.' },
  });
  await request('/api/progress/5', { method: 'PATCH', hero: a, body: { forge: true, explain: true } });
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

test('deleting a hero is guarded, world scoped, and preserves a shared reader ID', async () => {
  const {hero} = await createHero('Temporary Delete Hero');
  const endpoint = `/api/heroes/${hero.id}`;
  const guarded = {method: 'DELETE', headers: mutationHeaders};
  const {dir, name, ext} = parse(database);
  const javascript = new DatabaseSync(join(dir, `${name}.javascript${ext}`));
  try {
    javascript.prepare('INSERT INTO heroes (id, name, name_key, updated_at) VALUES (?, ?, ?, ?)')
      .run(hero.id, 'Retained JS Hero', 'retained js hero', new Date().toISOString());
    await request('/api/answers', {
      method: 'POST', hero, body: {page: 1, promptId: 'notes', value: 'Remove this answer'},
    });
    await request(endpoint, {method: 'DELETE', status: 403});
    await request(endpoint, {
      ...guarded, headers: {...mutationHeaders, Origin: 'https://outside.invalid'}, status: 403,
    });
    await request('/api/heroes/not-a-uuid', {...guarded, status: 400});
    const {payload: removed, response} = await request(endpoint, {
      ...guarded, headers: {...mutationHeaders, Origin: base, Cookie: `ferrum_hero=${hero.id}`},
    });
    assert.deepEqual(removed, {deleted: true, clearReaderData: false});
    assert.match(response.headers.get('Set-Cookie'), /^ferrum_hero=; Path=\/; Max-Age=0; HttpOnly; SameSite=Strict$/);
    await request('/api/progress', {hero, status: 401});
    await request('/api/heroes/load', {method: 'POST', body: {id: hero.id}, status: 404});
    assert.deepEqual((await request(endpoint, guarded)).payload, {deleted: false, clearReaderData: false});
    const {payload: other} = await request('/api/progress', {hero, headers: javascriptWorld});
    assert.equal(other.profile.callsign, 'Retained JS Hero');
    const {payload: final} = await request(endpoint, {...guarded, headers: {...mutationHeaders, ...javascriptWorld}});
    assert.deepEqual(final, {deleted: true, clearReaderData: true});
  } finally {
    javascript.close();
  }
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
    assert.equal(status.storage, 'SQLite');
    const {payload: {heroes}} = await request('/api/heroes', {headers});
    assert.ok(!heroes.some(hero => hero.name === rustHero.name));
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
    const graded = !!page.prompts.find(prompt => prompt.id === `boss-${level}`)?.exerciseId;
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
    await request(progress, {...mark, status:graded ? 409 : 200});
    await request('/api/profile', {method: 'PATCH', headers, hero, body: {lastPage: bossPage}});
    saved.push({headers, hero, draft, graded});
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
  for (const {headers, hero, draft, graded} of saved) {
    const {payload: progress} = await request('/api/progress', {headers, hero});
    assert.equal(progress.profile.lastPage, draft.page);
    assert.equal(progress.responses[0].value, draft.value);
    assert.equal(progress.levels.some(level => level.forge), !graded);
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
  await request('/special-encounters.mjs', { status: 404 });

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
