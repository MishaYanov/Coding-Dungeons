import assert from 'node:assert/strict';
import test from 'node:test';
import { createMobileEngine } from '../lib/mobile/engine.mjs';
import { exerciseMap, sideQuestMap } from '../lib/mobile/catalog.mjs';

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
      if (records.size) throw new Error('Restore requires an empty World 1.');
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
      tests:request.tests.map(test => ({id:test.id, durationMs:1, status:pass ? 'passed' : 'failed'}))};
  };
  const repository = options.repository ?? memoryRepository();
  const storage = options.storage ?? memoryStorage();
  return {...createMobileEngine({repository, storage, grade, ...options}), calls, repository, storage};
}

test('mobile campaign exposes all World 1 pages and exercise metadata', async () => {
  const {api} = fixture();
  assert.deepEqual((await api('/api/worlds')).worlds.map(({id, number}) => [id, number]), [['javascript', 1]]);
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
  const exercise = exerciseMap.values().next().value;
  const send = (path, body, method = 'POST') => api(path, {method, hero, body});
  await send(`/api/workbench/${exercise.level}/mode`, {mode:'hard'}, 'PATCH');
  await assert.rejects(send(`/api/levels/${exercise.level}/reveal/hint1`, {}), /Hard Mode/);
  const common = {page:exercise.page, promptId:exercise.promptId, exerciseId:exercise.id};
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
  const exercise = exerciseMap.values().next().value;
  await api(`/api/workbench/${exercise.level}/mode`, {method:'PATCH', hero, body:{mode:'hard'}});
  await post('/api/grade', {page:exercise.page, exerciseId:exercise.id, promptId:exercise.promptId,
    code:'correct', submissionId:'boss'});
  const draftKey = `ferrum-prompt-drafts-v2:${hero.id}`;
  const drafts = '{"4:boss-1":"draft","diamond-goblin:code":"diamond draft"}';
  storage.setItem(draftKey, drafts);
  const backup = await original.exportBackup();
  const restored = fixture();
  const invalid = structuredClone(backup);
  invalid.heroes[0].hp = 1.5;
  await assert.rejects(restored.importBackup(invalid), /valid World 1 backup/);
  assert.deepEqual(await restored.api('/api/heroes'), {heroes:[]});
  assert.deepEqual(await restored.importBackup(backup), {imported:1, readerRestored:true});
  assert.deepEqual((await restored.api('/api/diamond?page=1', {hero})).completed, ['code','choice']);
  assert.deepEqual((await restored.api(path, {hero})).completed, [first.id]);
  assert.equal((await restored.api('/api/progress', {hero})).attempts[0].hardClear, true);
  assert.equal(restored.storage.getItem(draftKey), drafts);
  await assert.rejects(restored.importBackup(backup), /empty World 1/);
  assert.deepEqual(await restored.api(`/api/heroes/${hero.id}`, {method:'DELETE'}), {deleted:true, clearReaderData:true});
  await assert.rejects(restored.api('/api/progress', {hero}), /Hero not found/);
});
