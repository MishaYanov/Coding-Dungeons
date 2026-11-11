import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test, mock } from 'node:test';
import { promisify } from 'node:util';
import { openStore } from '../lib/store.mjs';
import refactoring from '../data/workbench/refactoring.mjs';
import systemDesign from '../data/workbench/system-design.mjs';
import rateLimiter from '../data/workbench/rate-limiter.mjs';
import { exportSaves, importSaves } from '../desktop/save-transfer.mjs';

const port = 49152;
const host = '127.0.0.1:' + port;
let handler;
let directory;
let database;
const originalTerm = new Set(process.listeners('SIGTERM'));
const originalInt = new Set(process.listeners('SIGINT'));

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dungeons-engine-regression-'));
  database = join(directory, 'ferrum.sqlite');
  const env = {PORT:'0', FERRUM_DB:database, FERRUM_LLM_CLI:process.execPath, FERRUM_LLM_MODEL:process.execPath,
    FERRUM_DESKTOP_TOKEN:undefined};
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  function setEnv(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  // Exercise the real request handler and SQLite without requiring a loopback connection or a model download.
  mock.method(http, 'createServer', listener => {
    handler = listener;
    return {
      address: () => ({port}),
      listen: (_port, _host, ready) => ready(),
      close: closed => closed(),
      closeAllConnections: () => {},
    };
  });
  const originalExec = childProcess.execFile;
  const mockExec = () => assert.fail('expected promisified model launch');
  mockExec[promisify.custom] = async () => ({stdout:'{"matches":[1,2,0]}', stderr:''});
  childProcess.execFile = mockExec;
  syncBuiltinESMExports();
  setEnv(env);
  try {
    await import('../server.mjs');
  } finally {
    setEnv(previous);
    childProcess.execFile = originalExec;
    mock.restoreAll();
    syncBuiltinESMExports();
  }
});

after(async () => {
  for (const listener of process.listeners('SIGTERM').filter(item => !originalTerm.has(item))) {
    process.off('SIGTERM', listener);
    listener();
  }
  for (const listener of process.listeners('SIGINT').filter(item => !originalInt.has(item))) process.off('SIGINT', listener);
  if (directory) await rm(directory, {recursive:true, force:true});
});

async function request(url, {body, hero, world, method = body === undefined ? 'GET' : 'POST', status = 200} = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(stream, {url, method, headers:{host, 'x-ferrum-request':'1', 'content-type':'application/json',
    ...(hero ? {'x-ferrum-hero':hero.id} : {}), ...(world ? {'x-ferrum-world':world} : {})}});
  const response = Object.assign(new EventEmitter(), {
    setHeader() {},
    writeHead(code) { this.status = code; this.headersSent = true; },
    end(value) { this.value = JSON.parse(value); },
  });
  await handler(stream, response);
  assert.equal(response.status, status, JSON.stringify(response.value));
  return response.value;
}

test('a scored partial written answer does not damage a One Life hero or mark Forge', async () => {
  const {hero} = await request('/api/heroes', {body:{name:'Writing without damage', oneLife:true}, status:201});
  const body = {page:25, promptId:'training-1-3', submissionId:randomUUID(),
    value:'The shared borrow ends after the last use. Later use overlaps the exclusive borrow.'};
  const graded = await request('/api/answers', {hero, body});
  assert.equal(graded.assessment.status, 'scored');
  assert.equal(graded.assessment.score, 60);
  assert.equal(graded.combat.hp, 100);
  assert.equal(graded.combatEvent.damage, 0);
  const progress = await request('/api/progress', {hero});
  assert.equal(progress.combat.hp, 100);
  assert.equal(progress.responses[0].assessment.score, 60);
  assert.deepEqual(progress.levels, []);
});

test('a Hard drill does not unlock the same level boss guide', async () => {
  const {hero} = await request('/api/heroes', {body:{name:'Hard drill'}, status:201});
  const path = '/api/levels/3/reveal/debrief';
  await request('/api/workbench/3/mode', {hero, method:'PATCH', body:{mode:'hard'}});
  await request(path, {hero, body:{}, status:403});
  const store = await openStore({file:database});
  try {
    const passed = {level:3, code:'passing code', verdict:'pass', output:'', passed:2, failed:0, mode:'hard'};
    store.recordAttempt(hero.id, {...passed, page:46, promptId:'rust-drill', exerciseId:'split-registers'});
    await request(path, {hero, body:{}, status:403});
    assert.deepEqual((await request('/api/progress', {hero})).workbench.hardExerciseClears, ['split-registers']);
    store.recordAttempt(hero.id, {...passed, page:48, promptId:'boss-3', exerciseId:'rust-disjoint-regions'});
    assert.ok((await request(path, {hero, body:{}})).text);
  } finally {
    store.close();
  }
});

test('the refactoring quest carries working code between stages and awards one potion after rollout', async () => {
  const world = 'javascript';
  const campaign = await request('/api/campaign', {world});
  assert.equal(campaign.refactoring.title, refactoring.title);
  const page = await request(`/api/pages/${campaign.refactoring.page}`, {world});
  assert.equal(page.page, campaign.refactoring.page);
  await request('/api/refactoring', {world, status:401});
  await request('/api/refactoring', {status:404});
  const {hero} = await request('/api/heroes', {world, status:201, body:{name:'Relay maintainer', oneLife:true}});
  const initial = await request('/api/refactoring', {world, hero});
  const endpoint = '/api/refactoring';
  const submit = (body, status = 200) => request(endpoint, {world, hero, body, status});
  const [characterize, boundary, pipeline, rollout] = refactoring.stages;
  const choice = (stage, optionId = stage.answer) => ({stageId:stage.id, optionId, submissionId:randomUUID()});
  const code = (stage, source, purpose = 'submit') => ({stageId:stage.id, code:source, purpose,
    ...(purpose === 'submit' && {submissionId:randomUUID()})});

  assert.deepEqual(initial.completed, []);
  assert.equal(initial.legacyCode, refactoring.legacyCode);
  assert.doesNotMatch(JSON.stringify(initial), /"reference"|"answer"|"tests"/);
  await submit(choice(rollout), 409);
  const mistake = choice(characterize, characterize.options.find(item => item.id !== characterize.answer).id);
  assert.equal((await submit(mistake)).combat.hp, 95);
  assert.equal((await submit(mistake)).combatEvent.damage, 0);
  const start = choice(characterize);
  assert.deepEqual((await submit(start)).completed, [characterize.id]);
  await submit({...start, optionId:mistake.optionId}, 409);

  const boundaryCode = boundary.exercise.reference + '\n// My working boundary';
  const preview = await submit(code(boundary, boundaryCode, 'examples'));
  assert.equal(preview.result.verdict, 'pass');
  assert.deepEqual(preview.completed, [characterize.id]);
  const failed = await submit(code(boundary, 'function parseOrder('));
  assert.equal(failed.result.verdict, 'compile_error');
  assert.equal(failed.combat.hp, 90);
  assert.deepEqual(failed.completed, [characterize.id]);
  const [extracted, staleMiss] = await Promise.all([
    submit(code(boundary, boundaryCode)),
    submit(code(boundary, 'function parseRelayOrder(')),
  ]);
  assert.deepEqual(staleMiss.completed, [characterize.id, boundary.id]);
  assert.equal(staleMiss.combatEvent.damage, 0);
  assert.deepEqual(extracted.completed, [characterize.id, boundary.id]);
  assert.ok(extracted.stages.find(item => item.id === pipeline.id).starter.startsWith(boundaryCode));

  const fullRefactor = boundaryCode + '\n\n' + pipeline.exercise.reference;
  const rewritten = await submit(code(pipeline, fullRefactor));
  assert.deepEqual(rewritten.completed, [characterize.id, boundary.id, pipeline.id]);
  assert.equal(rewritten.result.verdict, 'pass');
  assert.equal(rewritten.combat.potions, 1);
  const final = choice(rollout);
  const cleared = await submit(final);
  assert.deepEqual(cleared.completed, refactoring.stages.map(item => item.id));
  assert.equal(cleared.combat.hp, 90);
  assert.equal(cleared.combat.potions, 2);
  assert.equal(cleared.combatEvent.potionsEarned, 1);
  assert.equal((await submit(final)).combatEvent.potionsEarned, 0);
  assert.deepEqual((await submit(start)).completed, cleared.completed);
  assert.deepEqual((await request(endpoint, {world, hero})).completed, cleared.completed);
  assert.deepEqual((await request('/api/progress', {world, hero})).levels, []);

  const backup = await exportSaves(directory, directory);
  const restored = join(directory, 'restored-refactoring');
  await importSaves(backup.directory, restored);
  const store = await openStore({file:join(restored, 'ferrum.javascript.sqlite')});
  try {
    assert.equal(store.encounterResults(hero.id, refactoring.id).size, 4);
    assert.equal(store.combatState(hero.id).potions, 2);
  } finally {
    store.close();
  }
});

test('the URL shortener design unlocks its debrief after one ordered, replay-safe completion', async () => {
  const world = 'javascript';
  const endpoint = '/api/system-design';
  const refactoringEndpoint = '/api/refactoring';
  const campaign = await request('/api/campaign', {world});
  assert.equal(campaign.systemDesign.title, systemDesign.title);
  assert.equal((await request(`/api/pages/${campaign.systemDesign.page}`, {world})).page, campaign.systemDesign.page);
  assert.equal((await request('/api/campaign')).systemDesign, undefined);
  await request(endpoint, {world, status:401});
  await request(endpoint, {status:404});

  const {hero} = await request('/api/heroes', {world, status:201, body:{name:'Short Link Architect', oneLife:true}});
  const [estimate, storage, allocator, cache, incident] = systemDesign.stages;
  const choice = (stage, optionId = stage.answer) => ({stageId:stage.id, optionId, submissionId:randomUUID()});
  const reference = allocator.exercise.reference;
  const example = {stageId:allocator.id, code:reference, purpose:'examples'};
  const submit = (body, status = 200) => request(endpoint, {world, hero, body, status});
  const view = () => request(endpoint, {world, hero});
  const completedBefore = (state, next) => {
    assert.deepEqual(state.completed, systemDesign.stages.slice(0, systemDesign.stages.indexOf(next)).map(({id}) => id));
    assert.equal(state.debrief, undefined);
  };

  const [characterize] = refactoring.stages;
  const refactoringProgress = await request(refactoringEndpoint, {world, hero, body:choice(characterize)});
  assert.deepEqual(refactoringProgress.completed, [characterize.id]);

  const initial = await view();
  completedBefore(initial, estimate);
  assert.deepEqual(initial.brief, systemDesign.brief);
  assert.doesNotMatch(JSON.stringify(initial), /"reference"|"answer"|"tests"|"debrief"/);
  await submit(choice(storage), 409);
  await submit(example, 409);
  await submit(choice(incident), 409);

  const wrong = choice(estimate, estimate.options.find(({id}) => id !== estimate.answer).id);
  const missed = await submit(wrong);
  assert.equal(missed.result.correct, false);
  assert.equal(missed.combat.hp, 95);
  assert.equal(missed.combatEvent.damage, 5);
  completedBefore(missed, estimate);
  assert.equal((await submit(wrong)).combatEvent.damage, 0);

  completedBefore(await submit(choice(estimate)), storage);
  completedBefore(await submit(choice(storage)), allocator);
  const failedExample = await submit({...example, code:'function allocateShortCode('});
  assert.equal(failedExample.result.verdict, 'compile_error');
  completedBefore(failedExample, allocator);
  const passedExample = await submit(example);
  assert.equal(passedExample.result.verdict, 'pass');
  completedBefore(passedExample, allocator);
  assert.equal((await view()).stages.find(({id}) => id === allocator.id).draft, reference);
  const practiced = (await request('/api/progress', {world, hero})).combat;
  assert.equal(practiced.hp, 95);
  assert.equal(practiced.potions, 1);

  const actual = {...example, purpose:'submit', submissionId:randomUUID()};
  const implemented = await submit(actual);
  assert.equal(implemented.result.verdict, 'pass');
  assert.ok(implemented.result.passed > passedExample.result.passed);
  assert.equal(implemented.result.failed, 0);
  completedBefore(implemented, cache);
  completedBefore(await submit(choice(cache)), incident);
  assert.equal((await view()).debrief, undefined);

  const final = choice(incident);
  const cleared = await submit(final);
  const completed = systemDesign.stages.map(({id}) => id);
  assert.deepEqual(cleared.completed, completed);
  assert.deepEqual(cleared.debrief, systemDesign.debrief);
  assert.equal(cleared.combat.hp, 95);
  assert.equal(cleared.combat.potions, 2);
  assert.equal(cleared.combatEvent.potionsEarned, 1);
  for (const replay of [final, choice(incident), actual]) {
    const saved = await submit(replay);
    assert.deepEqual(saved.completed, completed);
    assert.deepEqual(saved.debrief, systemDesign.debrief);
    assert.equal(saved.combat.potions, 2);
    assert.equal(saved.combatEvent.potionsEarned, 0);
  }
  const persisted = await view();
  assert.deepEqual(persisted.completed, completed);
  assert.deepEqual(persisted.debrief, systemDesign.debrief);
  assert.deepEqual((await request(refactoringEndpoint, {world, hero})).completed, [characterize.id]);
  assert.deepEqual((await request('/api/progress', {world, hero})).levels, []);
});

test('the rate limiter unlocks its worked design once and keeps the other side quest saves separate', async () => {
  const world = 'javascript';
  const endpoint = '/api/rate-limiter';
  const campaign = await request('/api/campaign', {world});
  assert.equal(campaign.rateLimiter.title, rateLimiter.title);
  const page = await request(`/api/pages/${campaign.rateLimiter.page}`, {world});
  assert.equal(page.page, campaign.rateLimiter.page);
  assert.equal((await request('/api/campaign')).rateLimiter, undefined);
  await request(endpoint, {world, status:401});
  await request(endpoint, {status:404});

  const {hero} = await request('/api/heroes', {world, status:201, body:{name:'Rate Limit Architect', oneLife:true}});
  const submit = (body, status = 200) => request(endpoint, {world, hero, body, status});
  const view = () => request(endpoint, {world, hero});
  const answer = (stage) => ({
    stageId:stage.id, submissionId:randomUUID(),
    ...(stage.kind === 'code' ? {code:stage.exercise.reference, purpose:'submit'} : {optionId:stage.answer}),
  });

  const otherQuests = [
    ['/api/refactoring', refactoring.stages.slice(0, 1)],
    ['/api/system-design', systemDesign.stages.slice(0, 2)],
  ];
  for (const [route, stages] of otherQuests) {
    for (const stage of stages) await request(route, {world, hero, body:answer(stage)});
    assert.deepEqual((await request(route, {world, hero})).completed, stages.map(({id}) => id));
  }

  const initial = await view();
  assert.deepEqual(initial.brief, rateLimiter.brief);
  assert.deepEqual(initial.completed, []);
  assert.doesNotMatch(JSON.stringify(initial), /"reference"|"answer"|"tests"|"debrief"/);
  const final = answer(rateLimiter.stages.at(-1));
  await submit(final, 409);

  const completed = [];
  for (const stage of rateLimiter.stages.slice(0, -1)) {
    const submission = answer(stage);
    if (stage.kind === 'code') {
      const practice = await submit({stageId:stage.id, code:submission.code, purpose:'examples'});
      assert.equal(practice.result.verdict, 'pass');
      assert.deepEqual(practice.completed, completed);
      assert.equal(practice.debrief, undefined);
      assert.equal((await view()).stages.find(({id}) => id === stage.id).draft, submission.code);
    }
    const next = await submit(submission);
    completed.push(stage.id);
    assert.deepEqual(next.completed, completed);
    assert.equal(next.debrief, undefined);
    assert.equal(next.combat.hp, 100);
    assert.equal(next.combat.potions, 1);
    assert.equal(next.combatEvent.potionsEarned, 0);
    if (stage.kind === 'code') {
      assert.equal(next.result.verdict, 'pass');
      assert.equal(next.result.passed, initial.stages.find(({id}) => id === stage.id).requiredCases);
      assert.equal(next.result.failed, 0);
    } else {
      assert.equal(next.result.correct, true);
    }
  }

  assert.equal((await view()).debrief, undefined);
  const cleared = await submit(final);
  completed.push(final.stageId);
  assert.deepEqual(cleared.completed, completed);
  assert.deepEqual(cleared.debrief, rateLimiter.debrief);
  assert.equal(cleared.combat.potions, 2);
  assert.equal(cleared.combatEvent.potionsEarned, 1);
  for (const replay of [final, answer(rateLimiter.stages.at(-1))]) {
    const saved = await submit(replay);
    assert.deepEqual(saved.completed, completed);
    assert.deepEqual(saved.debrief, rateLimiter.debrief);
    assert.equal(saved.combat.potions, 2);
    assert.equal(saved.combatEvent.potionsEarned, 0);
  }

  const persisted = await view();
  assert.deepEqual(persisted.completed, completed);
  assert.deepEqual(persisted.debrief, rateLimiter.debrief);
  for (const [route, stages] of otherQuests) {
    assert.deepEqual((await request(route, {world, hero})).completed, stages.map(({id}) => id));
  }
  assert.deepEqual((await request('/api/progress', {world, hero})).levels, []);
});
