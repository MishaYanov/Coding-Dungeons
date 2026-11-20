import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import rubrics from '../data/gm-rubrics.json' with {type:'json'};
import {evaluateDiamondChoice} from '../lib/diamond-content.mjs';
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
    const ids = request.caseIds ?? [...request.tests, ...(request.typeTests ?? [])].map(test => test.id);
    return {status:pass ? 'passed' : 'failed', diagnostics:[],
      tests:ids.map(id => ({id, durationMs:1, status:pass ? 'passed' : 'failed'}))};
  };
  const repository = options.repository ?? memoryRepository();
  const storage = options.storage ?? memoryStorage();
  return {...createMobileEngine({repository, storage, grade, ...options}), calls, repository, storage};
}

test('mobile campaign exposes all World 1 pages and exercise metadata', async () => {
  const {api} = fixture();
  assert.deepEqual((await api('/api/worlds')).worlds.map(({id, number}) => [id, number]),
    [['javascript', 1], ['typescript', 2], ['csharp', 3], ['rust', 4], ['go', 5]]);
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
  const rustPageCount = localCatalog('rust', identity).pages.length;
  for (const [worldId, pages, runner] of [['typescript',56,'available'], ['rust',rustPageCount,'unavailable'], ['go',56,'unavailable']]) {
    const {api} = fixture({worldId});
    const campaign = await api('/api/campaign');
    assert.equal(campaign.world.id, worldId);
    assert.equal(campaign.total, pages);
    assert.equal((await api(`/api/pages/${pages}`)).page, pages);
    await assert.rejects(api(`/api/pages/${pages + 1}`), /Page not found/);
    assert.equal((await api('/api/status')).runner, runner);
  }
});

test('all three Rust field labs retain safe notebooks and backup drafts without invoking a runner', async () => {
  const original = fixture({worldId:'rust', rustRunnerAvailable:true});
  const {api, calls} = original;
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Field Lab Explorer', oneLife:true}});
  const campaign = await api('/api/campaign');
  assert.deepEqual(campaign.labs.map(lab => lab.id), ['lab-async', 'lab-dispatch', 'lab-schedules']);
  const authored = localCatalog('rust', identity).pages;
  const drafts = [];
  for (const lab of campaign.labs) {
    const matches = prompt => prompt.id.startsWith(lab.id + '-') && prompt.type === 'code';
    const page = authored.find(page => page.prompts.some(matches));
    assert.ok(page, `${lab.id} notebook exists`);
    const view = await api(`/api/pages/${page.page}`);
    const prompt = view.prompts.find(matches);
    const promptId = prompt.id;
    assert.equal(prompt.type, 'code');
    assert.equal(prompt.exerciseId, undefined);
    const draft = {page:page.page, promptId, value:`// ${lab.title}\n${prompt.starter}`};
    const saved = await api('/api/answers', {method:'POST', hero, body:draft});
    assert.equal(saved.correct, null);
    drafts.push(draft);
  }
  assert.deepEqual(calls, []);
  const restored = fixture({worldId:'rust'});
  await restored.importBackup(await original.exportBackup());
  const progress = await restored.api('/api/progress', {hero});
  for (const draft of drafts) {
    const response = progress.responses.find(response => response.promptId === draft.promptId);
    assert.equal(response.page, draft.page);
    assert.equal(response.value, draft.value);
  }
  assert.deepEqual(progress.levels, []);
  assert.deepEqual(progress.attempts, []);
  assert.equal(progress.combat.hp, 100);
});

test('C# supports checkpoints, saved drafts, and self-review without executing source', async () => {
  const worldId = 'csharp';
  const original = fixture({worldId, goRunnerAvailable:true, rustRunnerAvailable:true});
  const {api, calls} = original;
  const campaign = await api('/api/campaign');
  assert.equal(campaign.world.number, 3);
  assert.equal(campaign.world.name, 'C# and .NET');
  assert.ok(campaign.quests.length >= 14);
  assert.deepEqual(campaign.exercises, []);
  const status = await api('/api/status');
  assert.equal(status.runner, 'unavailable');
  assert.equal(status.capabilities.nativeRunner, false);
  assert.match(status.runnerDetail, /\.NET 10 SDK/);

  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Lantern Apprentice', oneLife:true,
    path:campaign.paths[0].id}});
  const send = (path, body) => api(path, {method:'POST', hero, body});
  const first = campaign.quests[0];
  const chapter = await api(`/api/pages/${first.bossPage}`);
  const checkpoint = chapter.prompts.find(prompt => prompt.type === 'choice');
  assert.ok(!Object.hasOwn(checkpoint, 'correctOption'));
  const authoredPage = localCatalog(worldId).pages[first.bossPage - 1];
  const answer = authoredPage.prompts.find(prompt => prompt.id === checkpoint.id).correctOption;
  const outcome = await send('/api/answers', {page:chapter.page, promptId:checkpoint.id, value:answer, submissionId:'cs-checkpoint'});
  assert.equal(outcome.correct, true);
  const prompt = chapter.prompts.find(item => item.id === 'boss-1');
  assert.equal(prompt.type, 'code');
  assert.equal(prompt.exerciseId, undefined);
  const forge = () => api('/api/progress/1', {method:'PATCH', hero, body:{forge:true}});
  await assert.rejects(forge(), /save your boss encounter draft/i);
  const code = 'Console.WriteLine("Workshop");';
  const draft = await send('/api/answers', {page:chapter.page, promptId:prompt.id, value:code});
  assert.equal(draft.correct, null);
  await forge();

  const restored = fixture({worldId});
  await restored.importBackup(await original.exportBackup());
  const progress = await restored.api('/api/progress', {hero});
  assert.equal(progress.responses.find(item => item.promptId === prompt.id).value, code);
  assert.equal(progress.levels[0].forge, true);
  assert.equal(progress.combat.hp, 100);
  assert.deepEqual(calls, []);
});

test('C# goblin predicts code output before its riddle and awards a potion once', async () => {
  const worldId = 'csharp';
  const original = fixture({worldId});
  const {api, calls} = original;
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Lantern Delver', oneLife:true}});
  const send = (path, body) => api(path, {method:'POST', hero, body});
  const drafts = await Promise.all(Array.from({length:8}, (_, index) => api(`/api/diamond?page=${index + 1}`, {hero})
    .then(view => ({page:index + 1, ...view}))));
  const {page} = drafts.find(view => view.sparkle);
  const encounter = (await send('/api/diamond/start', {page})).encounter;
  assert.deepEqual(encounter.stages.map(({id, kind}) => [id, kind]), [['code','choice'], ['choice','choice']]);
  assert.ok(encounter.stages.every(stage => !Object.hasOwn(stage, 'answer')));
  const answer = stage => stage.options.find(({id}) => evaluateDiamondChoice(worldId, id, stage.id).correct).id;
  const [lock, riddle] = encounter.stages;
  const submit = (stage, submissionId) => send('/api/diamond/submit', {
    stageId:stage.id, optionId:answer(stage), submissionId,
  });
  await assert.rejects(submit(riddle, 'riddle-early'), /crack the sack lock/i);
  const first = await submit(lock, 'predict-output');
  assert.deepEqual(first.completed, ['code']);
  assert.equal(first.combat.potions, 1);
  assert.equal(first.diamonds, 0);
  const last = await submit(riddle, 'cs-riddle');
  assert.deepEqual(last.completed, ['code','choice']);
  assert.equal(last.combat.potions, 2);
  assert.equal(last.diamonds, 3);
  assert.equal((await submit(riddle, 'cs-riddle')).combat.potions, 2);
  assert.deepEqual(calls, []);

  const restored = fixture({worldId});
  await restored.importBackup(await original.exportBackup());
  assert.equal((await restored.api('/api/merchant', {hero})).balance, 3);
});

test('TypeScript and Go expose distinct side quests only in their respective worlds', async () => {
  const expected = [
    ['typescript', 'typed-notice', 44],
    ['go', 'cancellable-relay', 48],
  ];
  for (const [worldId, slug, page] of expected) {
    const {api} = fixture({worldId});
    const campaign = await api('/api/campaign');
    assert.ok(campaign.sideQuests.some(quest => quest.slug === slug && quest.page === page));
    assert.equal((await api(`/api/pages/${page}`)).page, page);
  }
});

test('offline side quests bind the correct runner and restore completed stages and rewards from backups', async () => {
  for (const worldId of ['typescript', 'go']) {
    const options = {worldId, goRunnerAvailable:true};
    const original = fixture(options);
    const {api, calls} = original;
    const [[path, {catalog}]] = localCatalog(worldId).sideQuestMap;
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Relay Scout', oneLife:true}});
    const post = body => api(path, {method:'POST', hero, body});
    const firstCode = catalog.stages.find(stage => stage.kind === 'code');
    await assert.rejects(post({stageId:firstCode.id, code:'right', submissionId:'too-soon'}), /earlier stages/);
    for (const stage of catalog.stages) {
      if (stage.kind === 'choice') {
        await post({stageId:stage.id, optionId:stage.answer, submissionId:stage.id});
        continue;
      }
      const priorCode = catalog.stages.find(item => item.id === stage.carryFrom)?.exercise.reference;
      const code = [priorCode, stage.exercise.reference].filter(Boolean).join('\n\n');
      const attempt = {stageId:stage.id, code, submissionId:stage.id};
      const practice = await post({...attempt, purpose:'examples'});
      assert.equal(practice.completed.includes(stage.id), false);
      assert.equal(practice.result.verdict, 'pass');
      assert.equal(calls.at(-1).language, worldId);
      assert.equal(calls.at(-1).tests.length, 1);
      assert.equal(calls.at(-1).typeTests, undefined);
      const checked = await post(attempt);
      assert.equal(checked.result.verdict, 'pass');
      assert.ok(checked.completed.includes(stage.id));
      assert.equal(calls.at(-1).tests.length, stage.exercise.tests.length);
      assert.deepEqual(calls.at(-1).typeTests, stage.exercise.typeTests);
    }
    const restored = fixture(options);
    const backup = JSON.parse(JSON.stringify(await original.exportBackup()));
    assert.equal((await restored.importBackup(backup)).imported, 1);
    const progress = await restored.api('/api/progress', {hero});
    assert.deepEqual(progress.levels, []);
    assert.deepEqual(progress.workbench.clears, []);
    assert.equal(progress.combat.potions, 2);
    const view = await restored.api(path, {hero});
    assert.deepEqual(view.completed, catalog.stages.map(stage => stage.id));
    assert.equal(view.debrief, catalog.debrief);
  }
});

test('the runaway microservice repairs preserve ordering, HP, runner contracts, rewards and backups in Rust and Go', async () => {
  for (const worldId of ['rust', 'go']) {
    const options = {worldId, rustRunnerAvailable:true, goRunnerAvailable:true};
    const original = fixture(options);
    const {api, calls} = original;
    const [path, {catalog, page}] = [...localCatalog(worldId).sideQuestMap].find(([path]) => path === `/api/rogue-${worldId}`);
    const campaign = await api('/api/campaign');
    assert.ok(campaign.sideQuests.some(quest => quest.slug === `rogue-${worldId}` && quest.page === page));
    assert.equal((await api(`/api/pages/${page}`)).page, page);
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:`Midnight ${worldId}`, oneLife:true}});
    const post = body => api(path, {method:'POST', hero, body});
    const initial = await api(path, {hero});
    assert.doesNotMatch(JSON.stringify(initial), /"reference"|"answer"|"tests"|"debrief"/);
    const final = catalog.stages.at(-1);
    await assert.rejects(post({stageId:final.id, optionId:final.answer, submissionId:'skip-repair'}), /earlier stages/);
    const first = catalog.stages[0];
    const miss = {stageId:first.id, optionId:first.options.find(option => option.id !== first.answer).id, submissionId:'incident-miss'};
    assert.equal((await post(miss)).combat.hp, 95);
    assert.equal((await post(miss)).combat.hp, 95);
    assert.equal((await post(miss)).combatEvent.damage, 0);
    const completed = [];
    let failedCode = false;
    let last;
    for (const stage of catalog.stages) {
      const body = {stageId:stage.id, submissionId:stage.id,
        ...(stage.kind === 'code' ? {code:stage.exercise.reference} : {optionId:stage.answer})};
      if (stage.kind === 'code') {
        const practice = await post({...body, purpose:'examples'});
        assert.equal(practice.result.verdict, 'pass');
        assert.deepEqual(practice.completed, completed);
        assert.equal(practice.debrief, undefined);
        assert.equal((await api('/api/progress', {hero})).combat.hp, failedCode ? 90 : 95);
        assert.equal(calls.at(-1).language, worldId);
        if (worldId === 'rust') {
          assert.deepEqual(calls.at(-1).caseIds, stage.exercise.testNames.slice(0, 1));
          assert.deepEqual(calls.at(-1).exercise, stage.exercise);
        } else assert.equal(calls.at(-1).tests.length, 1);
        if (!failedCode) {
          const failure = {...body, code:'wrong', submissionId:'code-miss'};
          assert.equal((await post(failure)).combat.hp, 90);
          assert.equal((await post(failure)).combatEvent.damage, 0);
          failedCode = true;
        }
      }
      last = await post(body);
      completed.push(stage.id);
      assert.deepEqual(last.completed, completed);
      assert.equal(last.combat.hp, failedCode ? 90 : 95);
      if (stage.kind === 'code') {
        assert.equal(last.result.verdict, 'pass');
        if (worldId === 'rust') assert.deepEqual(calls.at(-1).caseIds, stage.exercise.testNames);
        else assert.equal(calls.at(-1).tests.length, stage.exercise.tests.length);
      }
      if (stage !== final) assert.equal(last.debrief, undefined);
    }
    assert.equal(last.debrief, catalog.debrief);
    assert.equal(last.combat.potions, 2);
    assert.equal(last.combatEvent.potionsEarned, 1);
    for (const submissionId of [final.id, 'finished-again']) {
      const replay = await post({stageId:final.id, optionId:final.answer, submissionId});
      assert.equal(replay.combat.potions, 2);
      assert.equal(replay.combatEvent.potionsEarned, 0);
    }
    const restored = fixture(options);
    await restored.importBackup(JSON.parse(JSON.stringify(await original.exportBackup())));
    const saved = await restored.api(path, {hero});
    assert.deepEqual(saved.completed, completed);
    assert.equal(saved.debrief, catalog.debrief);
    const progress = await restored.api('/api/progress', {hero});
    assert.deepEqual(progress.levels, []);
    assert.deepEqual(progress.workbench.clears, []);
    assert.equal(progress.combat.potions, 2);
  }
});

test('an unavailable microservice runner preserves its code draft without HP damage or a repair clear', async () => {
  for (const worldId of ['rust', 'go']) {
    const {api, calls} = fixture({worldId});
    const [path, {catalog}] = [...localCatalog(worldId).sideQuestMap].find(([path]) => path === `/api/rogue-${worldId}`);
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:`Draft ${worldId}`, oneLife:true}});
    const [first, code] = catalog.stages;
    const post = body => api(path, {method:'POST', hero, body});
    await post({stageId:first.id, optionId:first.answer, submissionId:'begin'});
    const attempt = {stageId:code.id, code:code.exercise.reference, submissionId:'offline'};
    for (let retry = 0; retry < 2; retry++) {
      const result = await post(attempt);
      assert.equal(result.result.verdict, 'unavailable');
      assert.deepEqual(result.completed, [first.id]);
      assert.equal(result.stages.find(stage => stage.id === code.id).draft, attempt.code);
    }
    assert.deepEqual(calls, []);
    assert.equal((await api('/api/progress', {hero})).combat.hp, 100);
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

test('a Go infrastructure failure preserves the draft and allows the same submission to retry', async () => {
  let calls = 0;
  const {api} = fixture({worldId:'go', goRunnerAvailable:true, grade:async request => {
    calls++;
    return calls === 1 ? {status:'runner_error', tests:[], diagnostics:['Compiler download timed out.']}
      : {status:'passed', tests:request.tests.map(({id}) => ({id, status:'passed', durationMs:1})), diagnostics:[]};
  }});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Retry Hero', oneLife:true}});
  const {exercises:[exercise]} = await api('/api/campaign');
  const page = await api(`/api/pages/${exercise.page}`);
  const promptId = page.prompts.find(prompt => prompt.exerciseId === exercise.id).id;
  const body = {page:exercise.page, exerciseId:exercise.id, promptId, code:'saved code', submissionId:'retry'};
  await api('/api/grade', {method:'POST', hero, body});
  const progress = await api('/api/progress', {hero});
  assert.equal(progress.combat.hp, 100);
  assert.equal(progress.combat.potions, 1);
  assert.deepEqual(progress.attempts, []);
  assert.equal(progress.responses.find(response => response.promptId === promptId).value, body.code);
  assert.equal((await api('/api/grade', {method:'POST', hero, body})).verdict, 'pass');
  assert.equal(calls, 2);
  assert.equal((await api('/api/progress', {hero})).attempts.length, 1);
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
  await post('/api/trials/dispatch-floor-trial', {
    answers:{'relay-order':'b','badge-identity':'c'}, submissionId:'trial',
  });
  const draftKey = `ferrum-prompt-drafts-v2:${hero.id}`;
  const drafts = '{"4:boss-1":"draft","diamond-goblin:code":"diamond draft"}';
  storage.setItem(draftKey, drafts);
  const backup = JSON.parse(JSON.stringify(await original.exportBackup()));
  const restored = fixture();
  const invalidBackups = [
    record => { record.hp = 1.5; },
    record => { record.attempts[0].groups = [null]; },
    record => { record.attempts[0].cases[0].id = {}; },
    record => { record.encounters['diamond-goblin'].code.output = {}; },
    record => { record.receipts.find(receipt => receipt.id === 'boss').result.cases = [null]; },
    record => { record.receipts.find(receipt => receipt.id === 'trial').result.feedback = [null]; },
  ];
  for (const invalidate of invalidBackups) {
    const invalid = structuredClone(backup);
    invalidate(invalid.heroes[0]);
    await assert.rejects(restored.importBackup(invalid), /valid JavaScript backup/);
    assert.deepEqual(await restored.api('/api/heroes'), {heroes:[]});
    assert.equal(restored.storage.getItem(draftKey), null);
  }
  assert.deepEqual(await restored.importBackup(backup), {imported:1, readerRestored:true});
  assert.deepEqual((await restored.api('/api/diamond?page=1', {hero})).completed, ['code','choice']);
  assert.deepEqual((await restored.api(path, {hero})).completed, [first.id]);
  assert.equal((await restored.api('/api/progress', {hero})).attempts[0].hardClear, true);
  const restoredBackup = await restored.exportBackup();
  assert.deepEqual(restoredBackup.heroes[0].attempts, backup.heroes[0].attempts);
  assert.deepEqual(restoredBackup.heroes[0].receipts, backup.heroes[0].receipts);
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

test('mobile backups retain valid drafts above the former 2 MiB per-hero export limit', async () => {
  const original = fixture();
  const {hero} = await original.api('/api/heroes', {method:'POST', body:{name:'Draft Keeper'}});
  const key = mobileReaderKey('javascript', 'ferrum-prompt-drafts-v2', hero.id);
  const drafts = Object.fromEntries(Array.from({length:47}, (_, index) => [
    `${index + 1}:notes`, 'x'.repeat(48 * 1024),
  ]));
  original.storage.setItem(key, JSON.stringify(drafts));
  const backup = await original.exportBackup();
  const restored = fixture();
  assert.deepEqual(await restored.importBackup(backup), {imported:1, readerRestored:true});
  const hash = value => value && createHash('sha256').update(value).digest('hex');
  assert.equal(hash(restored.storage.getItem(key)), hash(JSON.stringify(drafts)));
  original.storage.setItem(key, '{damaged');
  await assert.rejects(original.exportBackup(), /Unsent drafts for Draft Keeper could not be included/);
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

test('an opted-in Rust runner selects case IDs for examples and full boss submissions', async () => {
  const {api, calls} = fixture({worldId:'rust', rustRunnerAvailable:true, rustRunnerVersion:'1.96.0-dev'});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Ferrum Explorer', oneLife:true}});
  const {exerciseMap, pages} = localCatalog('rust', identity);
  const page = pages.find(page => page.prompts.some(prompt => exerciseMap.has(prompt.exerciseId)));
  const prompt = page.prompts.find(prompt => exerciseMap.has(prompt.exerciseId));
  const exercise = exerciseMap.get(prompt.exerciseId);
  const {runner, runnerDetail, capabilities} = await api('/api/status');
  assert.equal(runner, 'available');
  assert.match(runnerDetail, /^Experimental Rust 1\.96\.0-dev workbench\./);
  assert.match(runnerDetail, /Newer language features may be unavailable/);
  assert.equal(capabilities.nativeRunner, true);
  await api(`/api/workbench/${exercise.level}/mode`, {method:'PATCH', hero, body:{mode:'hard'}});
  const body = {page:page.page, promptId:prompt.id, exerciseId:exercise.id, code:'correct'};
  const examples = await api('/api/grade', {method:'POST', hero, body:{...body, purpose:'examples'}});
  assert.equal(examples.verdict, 'pass');
  assert.equal(calls[0].language, 'rust');
  assert.equal(calls[0].exercise.tests, exercise.tests);
  assert.deepEqual(calls[0].caseIds, [exercise.testNames[0]]);
  assert.equal(calls[0].tests, undefined);
  assert.equal((await api('/api/progress', {hero})).attempts.length, 0);
  const submitted = await api('/api/grade', {method:'POST', hero, body:{...body, submissionId:'rust-boss'}});
  assert.equal(submitted.verdict, 'pass');
  assert.equal(submitted.hardClear, true);
  assert.equal(submitted.combat.potions, 2);
  assert.deepEqual(calls[1].caseIds, exercise.testNames);
  assert.equal(submitted.passed, exercise.testNames.length);
  assert.deepEqual(submitted.cases.map(test => test.id), [exercise.testNames[0]]);
  const progress = await api('/api/progress', {hero});
  assert.equal(progress.levels.find(level => level.level === exercise.level).forge, true);
  assert.equal(progress.attempts.length, 1);
  assert.equal((await api('/api/grade', {method:'POST', hero, body:{...body, submissionId:'rust-boss'}})).newClear, false);
  assert.equal(calls.length, 2);
  assert.equal((await fixture({worldId:'rust', rustRunnerAvailable:'true'}).api('/api/status')).runner, 'unavailable');
});

test('Rust goblin examples are practice and full code and choice victories settle once', async () => {
  const {api, calls} = fixture({worldId:'rust', rustRunnerAvailable:true});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Sack Hunter', oneLife:true}});
  const post = (path, body) => api(path, {method:'POST', hero, body});
  const reveals = await Promise.all(Array.from({length:8}, (_, index) => api(`/api/diamond?page=${index + 1}`, {hero})));
  await post('/api/diamond/start', {page:reveals.findIndex(view => view.sparkle) + 1});
  const examples = await post('/api/diamond/submit', {stageId:'code', code:'wrong', purpose:'examples'});
  assert.equal(examples.result.verdict, 'fail');
  assert.equal(examples.combat.hp, 100);
  assert.deepEqual(calls[0].caseIds, ['mixed_bag']);
  assert.deepEqual(examples.completed, []);
  const wrong = await post('/api/diamond/submit', {stageId:'code', code:'wrong', submissionId:'bad-lock'});
  assert.equal(wrong.result.verdict, 'fail');
  assert.equal(wrong.combat.hp, 95);
  const passed = await post('/api/diamond/submit', {stageId:'code', code:'correct', submissionId:'lock'});
  assert.equal(passed.result.verdict, 'pass');
  assert.deepEqual(passed.completed, ['code']);
  assert.deepEqual(calls[2].caseIds, ['mixed_bag', 'no_diamonds', 'larger_bag']);
  assert.equal(typeof calls[2].exercise.tests, 'string');
  const choice = {stageId:'choice', optionId:'shared', submissionId:'riddle'};
  const reward = await post('/api/diamond/submit', choice);
  assert.equal(reward.diamonds, 3);
  assert.equal(reward.combat.potions, 2);
  assert.equal((await post('/api/diamond/submit', choice)).combat.potions, 2);
});

test('Rust infrastructure failures preserve drafts, HP and retryable submission IDs', async () => {
  for (const status of ['runner_error', 'canceled', 'busy']) {
    let calls = 0;
    const {api, repository} = fixture({worldId:'rust', rustRunnerAvailable:true, grade:async request => {
      calls++;
      return calls === 1 ? {status, tests:[], diagnostics:[{message:'The Rust compiler could not run.'}]}
        : {status:'passed', tests:request.caseIds.map(id => ({id, status:'passed', durationMs:1})), diagnostics:[]};
    }});
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Retry Explorer', oneLife:true}});
    const {exercises:[exercise]} = await api('/api/campaign');
    const page = await api(`/api/pages/${exercise.page}`);
    const promptId = page.prompts.find(prompt => prompt.exerciseId === exercise.id).id;
    const body = {page:exercise.page, promptId, exerciseId:exercise.id, code:'saved code', submissionId:'retry'};
    const result = await api('/api/grade', {method:'POST', hero, body});
    assert.equal(result.verdict, status === 'runner_error' ? 'error' : status);
    const progress = await api('/api/progress', {hero});
    assert.equal(progress.combat.hp, 100);
    assert.equal(progress.combat.potions, 1);
    assert.deepEqual(progress.attempts, []);
    assert.equal(progress.responses.find(response => response.promptId === promptId).value, body.code);
    assert.deepEqual(repository.get(hero.id).receipts, []);
    assert.equal((await api('/api/grade', {method:'POST', hero, body})).verdict, 'pass');
    assert.equal(calls, 2);
  }
});

test('canceling Rust boss and goblin runs saves code without consuming the attempt or damaging the hero', async () => {
  for (const goblin of [false, true]) {
    const controller = new AbortController();
    let calls = 0;
    const {api, repository} = fixture({worldId:'rust', rustRunnerAvailable:true, grade:async request => {
      calls++;
      if (calls === 1) {
        assert.equal(request.signal, controller.signal);
        controller.abort();
        return {status:'canceled', tests:[], diagnostics:[]};
      }
      return {status:'passed', tests:request.caseIds.map(id => ({id, status:'passed', durationMs:1})), diagnostics:[]};
    }});
    const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Patient Explorer', oneLife:true}});
    let route, body;
    if (goblin) {
      const reveals = await Promise.all(Array.from({length:8}, (_, index) => api(`/api/diamond?page=${index + 1}`, {hero})));
      await api('/api/diamond/start', {method:'POST', hero, body:{page:reveals.findIndex(view => view.sparkle) + 1}});
      route = '/api/diamond/submit';
      body = {stageId:'code', code:'draft to retry', submissionId:'retry'};
    } else {
      const {exercises:[exercise]} = await api('/api/campaign');
      const page = await api(`/api/pages/${exercise.page}`);
      route = '/api/grade';
      body = {page:exercise.page, promptId:page.prompts.find(prompt => prompt.exerciseId === exercise.id).id,
        exerciseId:exercise.id, code:'draft to retry', submissionId:'retry'};
    }
    await assert.rejects(api(route, {method:'POST', hero, body, signal:controller.signal}), {name:'AbortError'});
    const record = repository.get(hero.id);
    assert.equal(record.hp, 100);
    assert.equal(record.potions, 1);
    assert.deepEqual(record.receipts, []);
    assert.deepEqual(record.attempts, []);
    assert.equal(goblin ? record.diamond.draft : Object.values(record.responses)[0].value, body.code);
    const retried = await api(route, {method:'POST', hero, body});
    assert.equal(goblin ? retried.result.verdict : retried.verdict, 'pass');
    assert.equal(calls, 2);
  }
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

async function earnMerchantDiamonds(api, hero) {
  const post = (path, body) => api(path, {method:'POST', hero, body});
  const views = await Promise.all(Array.from({length:8}, (_, index) => api(`/api/diamond?page=${index + 1}`, {hero})));
  await post('/api/diamond/start', {page:views.findIndex(view => view.sparkle) + 1});
  await post('/api/diamond/submit', {stageId:'code', code:'correct', submissionId:'merchant-lock'});
  return post('/api/diamond/submit', {stageId:'choice', optionId:'slice', submissionId:'merchant-riddle'});
}

test('offline merchant purchases settle once and stay scoped to the hero', async () => {
  const {api, repository, exportBackup} = fixture();
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Vault Explorer', oneLife:true}});
  const {hero:other} = await api('/api/heroes', {method:'POST', body:{name:'Another Explorer'}});
  const merchant = path => `/api/merchant${path ? `/${path}` : ''}`;
  const post = (path, body) => api(merchant(path), {method:'POST', hero, body});
  const purchase = (itemId, submissionId) => post('purchase', {itemId, submissionId});
  const initial = await api(merchant(), {hero});
  assert.equal(initial.balance, 0);
  assert.deepEqual(initial.challenge.questions, []);
  await assert.rejects(purchase('potion', 'no-funds'), {status:409});
  await assert.rejects(post('equip', {itemId:'emerald-cloak', equipped:true}), {status:409});
  const {combat:goblinCombat} = await earnMerchantDiamonds(api, hero);
  await assert.rejects(post('purchase', {itemId:'potion', submissionId:'invalid', price:0}), {status:400});
  await assert.rejects(post('equip', {itemId:'emerald-cloak'}), {status:400});

  const backup = await exportBackup();
  backup.heroes.find(record => record.hero.id === hero.id).potions = 10_000;
  const fullBag = fixture();
  await fullBag.importBackup(backup);
  await assert.rejects(fullBag.api(merchant('purchase'), {method:'POST', hero,
    body:{itemId:'potion', submissionId:'bag-full'}}), {status:409});
  const unchanged = await fullBag.api('/api/progress', {hero});
  assert.equal(unchanged.merchant.balance, 3);
  assert.equal(unchanged.combat.potions, 10_000);

  const [first, replay] = await Promise.all([purchase('potion', 'potion-1'), purchase('potion', 'potion-1')]);
  assert.equal(first.combat.potions, goblinCombat.potions + 1);
  assert.equal(first.merchant.balance, 2);
  assert.deepEqual(replay.merchant, first.merchant);
  assert.deepEqual(replay.combat, first.combat);
  assert.deepEqual([first.combatEvent.potionsEarned, replay.combatEvent.potionsEarned].sort(), [0, 1]);
  await assert.rejects(purchase('vault-key', 'potion-1'), /already been used/);

  const results = await Promise.allSettled([purchase('vault-key', 'key-1'), purchase('emerald-cloak', 'cloak-1')]);
  assert.equal(results.filter(({status}) => status === 'fulfilled').length, 1);
  assert.equal(results.find(({status}) => status === 'rejected').reason.status, 409);
  const current = await api(merchant(), {hero});
  const wonKey = current.challenge.unlocked;
  if (!wonKey) {
    await post('equip', {itemId:'emerald-cloak', equipped:true});
    assert.equal((await api(merchant(), {hero})).equipped.skin, 'emerald-cloak');
  }
  const reloaded = fixture({repository});
  assert.equal((await reloaded.api('/api/progress', {hero})).merchant.balance, wonKey ? 0 : 1);
  const replayed = await purchase('potion', 'potion-1');
  assert.equal(replayed.merchant.balance, wonKey ? 0 : 1);
  assert.equal(replayed.combat.potions, goblinCombat.potions + 1);
  assert.equal(replayed.combatEvent.potionsEarned, 0);
  assert.equal((await api(merchant(), {hero:other})).balance, 0);
  await earnMerchantDiamonds(api, other);
  await assert.rejects(api(merchant('purchase'), {method:'POST', hero:other,
    body:{itemId:'potion', submissionId:'standard-potion'}}), {status:409});
  assert.equal((await api('/api/diamond?page=1', {hero})).diamonds, 3);
});

test('mobile vault completion and equipped loot survive backup and legacy goblin rewards stay spendable', async () => {
  const original = fixture();
  const {api} = original;
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Vault Keeper', oneLife:true}});
  const {combat:goblinCombat} = await earnMerchantDiamonds(api, hero);
  const legacy = await original.exportBackup();
  delete legacy.heroes[0].merchant;
  const restored = fixture();
  await restored.importBackup(legacy);
  const post = (action, body) => restored.api(`/api/merchant/${action}`, {method:'POST', body, hero});
  assert.equal((await restored.api('/api/merchant', {hero})).balance, 3);
  const winningSubmission = {answers:{'order-keys':'b','zero-quantity':'c'}, submissionId:'vault-clear'};
  await assert.rejects(post('challenge', winningSubmission), {status:409});
  await post('purchase', {itemId:'gemkeeper', submissionId:'title'});
  await post('equip', {itemId:'gemkeeper', equipped:true});
  const {merchant:open} = await post('purchase', {itemId:'vault-key', submissionId:'key'});
  assert.equal(open.equipped.title, 'gemkeeper');
  assert.equal(open.balance, 0);
  assert.equal(open.challenge.questions.length, 2);
  const attempt = await post('challenge', {answers:{'order-keys':'a','zero-quantity':'c'}, submissionId:'vault-retry'});
  assert.equal(attempt.report.correct, false);
  assert.equal(attempt.merchant.challenge.unlocked, true);
  assert.equal(attempt.combatEvent.damage, 0);
  assert.equal(attempt.combat.hp, goblinCombat.hp);
  const cleared = await post('challenge', winningSubmission);
  assert.equal(cleared.report.correct, true);
  assert.equal(cleared.combat.potions, goblinCombat.potions);
  const reversed = Object.fromEntries(Object.entries(winningSubmission.answers).reverse());
  assert.equal((await post('challenge', {...winningSubmission, answers:reversed})).report.correct, true);
  const backup = await restored.exportBackup();
  for (const mutate of [
    state => { state.potionsBought = 1; },
    state => { state.owned.push('emerald-cloak'); },
    state => { state.owned = ['gemkeeper']; },
    state => { state.skin = 'emerald-cloak'; },
  ]) {
    const invalid = structuredClone(backup);
    mutate(invalid.heroes[0].merchant);
    await assert.rejects(fixture().importBackup(invalid), /valid JavaScript backup/);
  }
  const imported = fixture();
  await imported.importBackup(backup);
  const final = await imported.api('/api/merchant', {hero});
  assert.equal(final.challenge.cleared, true);
  assert.equal(final.equipped.title, 'gemkeeper');
  assert.equal(final.balance, 0);
  assert.equal((await imported.api('/api/merchant/challenge', {method:'POST', hero, body:winningSubmission})).report.correct, true);
});

test('each World opens a distinct IndexedDB and JavaScript keeps the established database name', async () => {
  const names = [];
  const indexedDB = {open(name) {
    names.push(name);
    throw new Error('Test database');
  }};
  for (const worldId of ['javascript', 'typescript', 'csharp', 'rust', 'go']) {
    await assert.rejects(createMobileRepository(indexedDB, worldId).list(), /Test database/);
  }
  assert.deepEqual(names, ['coding-dungeons-mobile', 'coding-dungeons-mobile-typescript',
    'coding-dungeons-mobile-csharp', 'coding-dungeons-mobile-rust', 'coding-dungeons-mobile-go']);
});
