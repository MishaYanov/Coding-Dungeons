import assert from 'node:assert/strict';
import test from 'node:test';
import rubrics from '../data/gm-rubrics.json' with {type:'json'};
import { createMobileEngine } from '../lib/mobile/engine.mjs';
import { localCatalog } from '../lib/mobile/catalog.mjs';
import { mobileReaderKey } from '../lib/mobile/input.mjs';
import { createMobileRepository } from '../lib/mobile/repository.mjs';
import { reviewWritten } from '../lib/mobile/written-review.mjs';

const identity = value => value;

function memoryRepository() {
  const records = new Map();
  const list = () => structuredClone([...records.values()]);
  return {
    list,
    get: id => structuredClone(records.get(id)),
    create(record, check) {
      check(list());
      records.set(record.hero.id, structuredClone(record));
    },
    mutate(id, update, check) {
      const all = list();
      const record = all.find(item => item.hero.id === id);
      if (!record) throw new Error('Hero not found.');
      const result = update(record);
      check?.(all);
      records.set(id, structuredClone(record));
      return structuredClone(result);
    },
    remove: id => records.delete(id),
    importEmpty(incoming) {
      if (records.size) throw new Error('Restore requires an empty world.');
      for (const record of incoming) records.set(record.hero.id, structuredClone(record));
    },
  };
}

function memoryStorage() {
  const data = new Map();
  return {getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value)};
}

function fixture(options = {}) {
  const calls = [];
  const grade = async request => {
    calls.push(request);
    const pass = request.source !== 'wrong';
    return {status:pass ? 'passed' : 'failed', diagnostics:[],
      tests:[...request.tests, ...(request.typeTests ?? [])]
        .map(test => ({id:test.id, durationMs:1, status:pass ? 'passed' : 'failed'}))};
  };
  const repository = options.repository ?? memoryRepository();
  const storage = options.storage ?? memoryStorage();
  return {...createMobileEngine({repository, storage, grade, ...options}), calls, repository, storage};
}

test('mobile campaign exposes all World 1 pages and exercise metadata', async () => {
  const {api} = fixture();
  assert.deepEqual((await api('/api/worlds')).worlds.map(({id, number}) => [id, number]),
    [['javascript', 1], ['typescript', 2], ['rust', 3], ['go', 4]]);
  const campaign = await api('/api/campaign');
  assert.equal(campaign.total, 47);
  assert.equal(campaign.exercises.length, 14);
  assert.equal(campaign.sideQuests.length, 3);
  for (let page = 1; page <= 47; page++) {
    const content = await api(`/api/pages/${page}`);
    assert.equal(content.page, page);
    assert.ok(content.image.startsWith('/book/javascript/pages/'));
    assert.ok(content.prompts.every(prompt => !Object.hasOwn(prompt, 'correctOption')));
  }
  await assert.rejects(api('/api/pages/48'), /Page not found/);
});

test('mobile campaigns expose their full book and local support status', async () => {
  for (const [worldId, pages, runner] of [['typescript',56,'available'], ['rust',559,'unavailable'], ['go',56,'unavailable']]) {
    const {api} = fixture({worldId});
    const campaign = await api('/api/campaign');
    assert.equal(campaign.world.id, worldId);
    assert.equal(campaign.total, pages);
    assert.equal((await api(`/api/pages/${pages}`)).page, pages);
    assert.equal((await api('/api/status')).runner, runner);
  }
});

test('mobile choice damage, replay, potion healing and trial reward persist by hero', async () => {
  const {api, repository} = fixture();
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:' Rhea ', oneLife:true}});
  await assert.rejects(api('/api/heroes', {method:'POST', body:{name:'rhea'}}), /already exists/);
  const campaign = await api('/api/campaign');
  const page = await api(`/api/pages/${campaign.quests[0].bossPage}`);
  const choice = page.prompts.find(prompt => prompt.type === 'choice');
  const send = (path, body) => api(path, {method:'POST', hero, body});
  const testChoice = {page:page.page, promptId:choice.id, value:choice.options.at(-1).id, submissionId:'choice'};
  const attempt = await send('/api/answers', testChoice);
  assert.equal(attempt.correct, false);
  assert.equal(attempt.combat.hp, 95);
  assert.equal(attempt.combatEvent.damage, 5);
  const replay = await send('/api/answers', testChoice);
  assert.equal(replay.combat.hp, 95);
  assert.equal(replay.combatEvent.damage, 0);
  await assert.rejects(send('/api/answers', {...testChoice, value:choice.options[0].id}), /already been used/);
  const healed = await send('/api/combat/potion', {submissionId:'potion'});
  assert.equal(healed.combat.hp, 100);
  assert.equal(healed.combat.potions, 0);
  const trial = await send('/api/trials/dispatch-floor-trial', {
    answers:{'relay-order':'b','badge-identity':'c'}, submissionId:'trial',
  });
  assert.deepEqual(trial.combat.completedTrials, ['dispatch-floor-trial']);
  assert.equal(trial.combat.potions, 1);
  const reload = fixture({repository});
  const loaded = await reload.api('/api/heroes/load', {method:'POST', body:{id:hero.id}});
  assert.equal(loaded.hero.name, 'Rhea');
  assert.deepEqual((await reload.api('/api/progress', {hero})).combat, trial.combat);
});

test('concurrent mobile submissions settle once and a fallen hero remains read-only for combat', async () => {
  const {api, repository} = fixture();
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'One Life', oneLife:true}});
  const post = (path, body) => api(path, {method:'POST', hero, body});
  const bad = {page:4, promptId:'checkpoint-1', value:'4'};
  const simultaneous = await Promise.all(Array.from({length:3}, () =>
    post('/api/answers', {...bad, submissionId:'same'})));
  assert.equal(simultaneous.reduce((total, result) => total + result.combatEvent.damage, 0), 5);
  for (let index = 1; index < 20; index++) {
    await post('/api/answers', {...bad, submissionId:`miss-${index}`});
  }
  const reloaded = fixture({repository});
  const {combat} = await reloaded.api('/api/progress', {hero});
  assert.equal(combat.hp, 0);
  assert.equal(combat.fallen, true);
  await assert.rejects(post('/api/combat/potion', {submissionId:'too-late'}), /fallen/);
  await assert.rejects(post('/api/answers', {...bad, submissionId:'try-again'}), /fallen/);
  assert.equal((await post('/api/answers', {...bad, submissionId:'same'})).combat.hp, 0);
});

test('World 1 boss examples are practice, submitting tests unlocks Forge, and Hard Mode gates aids', async () => {
  const {api, calls} = fixture();
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Hard Hero', oneLife:true}});
  const {exercises:[exercise]} = await api('/api/campaign');
  const page = await api(`/api/pages/${exercise.page}`);
  const prompt = page.prompts.find(item => item.exerciseId === exercise.id);
  const send = (path, body, method = 'POST') => api(path, {method, hero, body});
  await send(`/api/workbench/${exercise.level}/mode`, {mode:'hard'}, 'PATCH');
  await assert.rejects(send(`/api/levels/${exercise.level}/reveal/hint1`, {}), /Hard Mode/);
  const common = {page:exercise.page, promptId:prompt.id, exerciseId:exercise.id};
  const examples = await send('/api/grade', {...common, code:'wrong', purpose:'examples'});
  assert.equal(examples.verdict, 'fail');
  assert.ok(calls[0].tests.every(test => test.visibility === 'public'));
  const afterExamples = await api('/api/progress', {hero});
  assert.equal(afterExamples.combat.hp, 100);
  assert.equal(afterExamples.attempts.length, 0);
  const issued = await send('/api/grade', {...common, code:'correct', submissionId:'full'});
  assert.equal(issued.hardClear, true);
  assert.equal(issued.newClear, true);
  assert.equal(issued.combat.potions, 2);
  assert.ok(calls[1].tests.some(test => test.visibility === 'sealed'));
  assert.equal((await send('/api/grade', {...common, code:'correct', submissionId:'full'})).newClear, false);
  assert.equal(calls.length, 2);
  const progress = await api('/api/progress', {hero});
  assert.equal(progress.levels[0].forge, true);
  assert.equal(progress.attempts[0].hardClear, true);
  assert.ok((await send(`/api/levels/${exercise.level}/reveal/debrief`, {})).text);
});

test('mobile backups retain encounter progress and reader drafts and reject invalid or occupied restores', async () => {
  const original = fixture();
  const {sideQuestMap} = localCatalog('javascript', identity);
  const {api, storage} = original;
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Explorer', oneLife:true}});
  const post = (path, body) => api(path, {method:'POST', hero, body});
  const pages = await Promise.all(Array.from({length:8}, (_, index) =>
    api(`/api/diamond?page=${index + 1}`, {hero})));
  assert.equal(pages.filter(page => page.sparkle).length, 1);
  const page = pages.findIndex(page => page.sparkle) + 1;
  assert.equal((await post('/api/diamond/start', {page})).encounter.id, 'diamond-goblin');
  await assert.rejects(post('/api/diamond/submit', {stageId:'choice', optionId:'slice', submissionId:'early'}), /sack lock/);
  await post('/api/diamond/submit', {stageId:'code', code:'correct', submissionId:'goblin-code'});
  const reward = await post('/api/diamond/submit', {stageId:'choice', optionId:'slice', submissionId:'goblin-riddle'});
  assert.equal(reward.diamonds, 3);
  assert.equal(reward.combat.potions, 2);
  const [path, definition] = [...sideQuestMap].find(([path]) => path === '/api/rate-limiter');
  const first = definition.catalog.stages[0];
  await post(path, {stageId:first.id, ...(first.kind === 'choice' ? {optionId:first.answer} : {code:'correct'}),
    submissionId:'side-quest'});
  const writtenPage = (await api('/api/campaign')).quests[0].sidePage;
  const result = await post('/api/answers', {page:writtenPage, promptId:'side-1',
    value:'The calls create separate objects. The first visits increments to one. The second stays zero.', submissionId:'written'});
  assert.equal(result.assessment.score, 100);
  const {exercises:[exercise]} = await api('/api/campaign');
  const boss = await api(`/api/pages/${exercise.page}`);
  const promptId = boss.prompts.find(item => item.exerciseId === exercise.id).id;
  await api(`/api/workbench/${exercise.level}/mode`, {method:'PATCH', hero, body:{mode:'hard'}});
  await post('/api/grade', {page:exercise.page, exerciseId:exercise.id, promptId,
    code:'correct', submissionId:'boss'});
  const draftKey = `ferrum-prompt-drafts-v2:${hero.id}`;
  const drafts = '{"4:boss-1":"draft","diamond-goblin:code":"diamond draft"}';
  storage.setItem(draftKey, drafts);
  const backup = await original.exportBackup();
  const restored = fixture();
  const invalid = structuredClone(backup);
  invalid.heroes[0].hp = 1.5;
  await assert.rejects(restored.importBackup(invalid), /valid JavaScript backup/);
  assert.deepEqual(await restored.api('/api/heroes'), {heroes:[]});
  assert.deepEqual(await restored.importBackup(backup), {imported:1, readerRestored:true});
  assert.deepEqual((await restored.api('/api/diamond?page=1', {hero})).completed, ['code','choice']);
  assert.deepEqual((await restored.api(path, {hero})).completed, [first.id]);
  assert.equal((await restored.api('/api/progress', {hero})).attempts[0].hardClear, true);
  assert.equal(restored.storage.getItem(draftKey), drafts);
  await assert.rejects(restored.importBackup(backup), /empty world/);
  assert.deepEqual(await restored.api(`/api/heroes/${hero.id}`, {method:'DELETE'}), {deleted:true, clearReaderData:true});
  await assert.rejects(restored.api('/api/progress', {hero}), /Hero not found/);
});

test('TypeScript examples skip type contracts while a full offline submission includes them', async () => {
  const {api, calls} = fixture({worldId:'typescript'});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Type Explorer', oneLife:true}});
  const {exerciseMap, pages} = localCatalog('typescript', identity);
  const exercise = [...exerciseMap.values()].find(item => item.typeTests?.length);
  const page = pages.find(page => page.prompts.some(prompt => prompt.exerciseId === exercise.id));
  const promptId = page.prompts.find(prompt => prompt.exerciseId === exercise.id).id;
  const body = {page:page.page, promptId, exerciseId:exercise.id, code:'correct'};
  const options = {method:'POST', hero};
  await api('/api/grade', {...options, body:{...body, purpose:'examples'}});
  assert.equal(calls[0].language, 'typescript');
  assert.equal(calls[0].typeTests, undefined);
  assert.ok(calls[0].tests.every(item => item.visibility === 'public'));
  const submitted = await api('/api/grade', {...options, body:{...body, submissionId:'type-contract'}});
  assert.deepEqual(calls[1].typeTests, exercise.typeTests);
  assert.equal(submitted.verdict, 'pass');
  assert.ok(submitted.groups.some(item => item.group === 'Type contract'));
  assert.equal(submitted.combat.potions, 2);
});

test('Rust and Go retain drafts and backups when code grading is unavailable', async () => {
  for (const worldId of ['rust', 'go']) {
    const {api, calls, exportBackup, storage} = fixture({worldId});
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Native Explorer', oneLife:true}});
    const {exerciseMap, pages} = localCatalog(worldId, identity);
    const page = pages.find(page => page.prompts.some(prompt => exerciseMap.has(prompt.exerciseId)));
    const prompt = page.prompts.find(prompt => exerciseMap.has(prompt.exerciseId));
    const status = await api('/api/status');
    assert.equal(status.runner, 'unavailable');
    assert.match(status.runnerDetail, /code tests are unavailable in this mobile build/);
    const result = await api('/api/grade', {method:'POST', hero,
      body:{page:page.page, promptId:prompt.id, exerciseId:prompt.exerciseId, code:'my draft'}});
    assert.equal(result.verdict, 'unavailable');
    assert.equal(calls.length, 0);
    const progress = await api('/api/progress', {hero});
    assert.equal(progress.combat.hp, 100);
    assert.equal(progress.combat.potions, 1);
    assert.deepEqual(progress.attempts, []);
    assert.equal(progress.responses[0].value, 'my draft');
    const reveals = await Promise.all(Array.from({length:8}, (_, index) =>
      api(`/api/diamond?page=${index + 1}`, {hero})));
    const sparkle = reveals.findIndex(view => view.sparkle) + 1;
    assert.ok(sparkle > 0);
    const diamond = await api('/api/diamond/start', {method:'POST', hero, body:{page:sparkle}});
    assert.match(diamond.encounter.stages[0].signature, worldId === 'rust' ? /^pub fn / : /^func /);
    const lock = await api('/api/diamond/submit', {method:'POST', hero, body:{stageId:'code', code:'my lock draft'}});
    assert.equal(lock.result.verdict, 'unavailable');
    assert.equal(lock.draft, 'my lock draft');
    assert.equal(lock.combat.hp, 100);
    assert.deepEqual(lock.completed, []);
    assert.equal(calls.length, 0);
    const readerKey = mobileReaderKey(worldId, 'ferrum-prompt-drafts-v2', hero.id);
    const drafts = JSON.stringify({[`${pages.length}:${prompt.id}`]:'unsent code'});
    storage.setItem(readerKey, drafts);
    const backup = await exportBackup();
    await assert.rejects(fixture().importBackup(backup), /valid JavaScript backup/);
    const restored = fixture({worldId});
    assert.deepEqual(await restored.importBackup(backup), {imported:1, readerRestored:true});
    assert.equal(restored.storage.getItem(readerKey), drafts);
    assert.equal(restored.storage.getItem(`ferrum-prompt-drafts-v2:${hero.id}`), null);
    assert.equal((await restored.api('/api/progress', {hero})).responses[0].value, 'my draft');
    assert.equal((await restored.api('/api/diamond?page=1', {hero})).draft, 'my lock draft');
  }
});

test('authored Rust project review requires a saved draft and cannot award a test clear', async () => {
  const {api} = fixture({worldId:'rust'});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Rust Explorer', oneLife:true}});
  const {pages, questMap, exerciseMap} = localCatalog('rust', identity);
  const gradedLevels = new Set([...exerciseMap.values()].map(exercise => exercise.level));
  const quest = [...questMap.values()].find(quest => !gradedLevels.has(quest.level)
    && pages[quest.bossPage - 1].prompts.some(item => item.id === `boss-${quest.level}` && item.type === 'code'));
  const levelRoute = `/api/progress/${quest.level}`;
  const review = () => api(levelRoute, {method:'PATCH', hero, body:{forge:true}});
  await assert.rejects(review(), /Save your boss encounter draft/);
  await api('/api/answers', {method:'POST', hero,
    body:{page:quest.bossPage, promptId:`boss-${quest.level}`, value:'my project code'}});
  await review();
  const progress = await api('/api/progress', {hero});
  assert.equal(progress.levels[0].forge, true);
  assert.deepEqual(progress.attempts, []);
  assert.deepEqual(progress.workbench.clears, []);
  assert.equal(progress.combat.potions, 1);
});

test('an opted-in Go runner receives authored code checks and can award Forge', async () => {
  const {api, calls} = fixture({worldId:'go', goRunnerAvailable:true});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Go Explorer', oneLife:true}});
  const {exerciseMap, pages} = localCatalog('go', identity);
  const page = pages.find(page => page.prompts.some(prompt => exerciseMap.has(prompt.exerciseId)));
  const prompt = page.prompts.find(prompt => exerciseMap.has(prompt.exerciseId));
  const {runner, capabilities} = await api('/api/status');
  assert.equal(runner, 'available');
  assert.equal(capabilities.nativeRunner, true);
  const result = await api('/api/grade', {method:'POST', hero,
    body:{page:page.page, promptId:prompt.id, exerciseId:prompt.exerciseId, code:'correct', submissionId:'go-ran'}});
  assert.equal(result.verdict, 'pass');
  assert.equal(result.combat.potions, 2);
  assert.equal(calls[0].language, 'go');
  assert.equal(calls[0].tests.length, exerciseMap.get(prompt.exerciseId).tests.length);
  const reveals = await Promise.all(Array.from({length:8}, (_, index) => api(`/api/diamond?page=${index + 1}`, {hero})));
  await api('/api/diamond/start', {method:'POST', hero, body:{page:reveals.findIndex(view => view.sparkle) + 1}});
  const lock = await api('/api/diamond/submit', {method:'POST', hero,
    body:{stageId:'code', code:'correct', submissionId:'go-lock'}});
  assert.equal(lock.result.verdict, 'pass');
  assert.deepEqual(lock.completed, ['code']);
  assert.equal(calls[1].language, 'go');
  const riddle = await api('/api/diamond/submit', {method:'POST', hero,
    body:{stageId:'choice', optionId:'shared', submissionId:'go-riddle'}});
  assert.equal(riddle.diamonds, 3);
  assert.equal(riddle.combat.potions, 3);
});

test('mobile written review matches rubrics to their world', () => {
  for (const rubric of rubrics) {
    assert.equal(reviewWritten(rubric, rubric.reference).score, 100, `${rubric.worldId}/${rubric.promptId}`);
    assert.equal(reviewWritten(rubric, '').score, null);
  }
  const forPrompt = (world, prompt) => rubrics.find(item => item.worldId === world && item.promptId === prompt);
  assert.ok(reviewWritten(forPrompt('typescript', 'side-2'), 'Expose read-only group properties.').score > 0);
  assert.ok(reviewWritten(forPrompt('rust', 'training-1-3'), 'The shared borrow ends at the last use.').score > 0);
  assert.ok(reviewWritten(forPrompt('go', 'side-1'), 'len returns two. Iteration yields one rune.').score > 0);
  assert.equal(reviewWritten(forPrompt('javascript', 'side-1'), 'len returns two. Iteration yields one rune.').score, null);
});

test('each World opens a distinct IndexedDB and JavaScript keeps the established database name', async () => {
  const names = [];
  const indexedDB = {open(name) {
    names.push(name);
    throw new Error('Test database');
  }};
  for (const worldId of ['javascript', 'typescript', 'rust', 'go']) {
    await assert.rejects(createMobileRepository(indexedDB, worldId).list(), /Test database/);
  }
  assert.deepEqual(names, ['coding-dungeons-mobile', 'coding-dungeons-mobile-typescript',
    'coding-dungeons-mobile-rust', 'coding-dungeons-mobile-go']);
});
