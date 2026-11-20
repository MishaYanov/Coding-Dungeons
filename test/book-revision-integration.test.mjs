import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {after, before, test, mock} from 'node:test';
import {openStore} from '../lib/store.mjs';
import {createWrittenGm} from '../lib/written-gm.mjs';
import {sideQuestRoutes} from '../lib/side-quests.mjs';

const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const rustBook = await load('../data/campaign.json');
const rustPages = await load('../data/pages.json');
const jsBook = await load('../data/worlds/javascript/campaign.json');
const rubric = (await load('../data/gm-rubrics.json')).find(row => row.worldId === 'rust' && row.promptId === 'training-1-3');
const assessmentPage = rustPages.find(page => page.prompts.some(prompt => prompt.id === rubric.promptId));
const boss = rustBook.quests.find(quest => quest.level === 33);
const rogue = sideQuestRoutes.get('/api/rogue-rust');
const roguePage = rustBook.quests.find(quest => quest.level === rogue.level).sidePage;
const rogueCode = rogue.catalog.stages.find(stage => stage.kind === 'code');
const relay = sideQuestRoutes.get('/api/refactoring');
const relayPage = jsBook.quests.find(quest => quest.level === relay.level).sidePage;
const relayCarry = relay.catalog.stages.find(stage => stage.carryFrom);
const legacy = page => page - 1;
const history = {rust:{
  [`${legacy(boss.bossPage)}:boss-${boss.level}`]:boss.bossPage,
  [`${legacy(assessmentPage.page)}:${rubric.promptId}`]:assessmentPage.page,
  [`${legacy(roguePage)}:${rogue.slug}-${rogueCode.id}`]:roguePage,
}, javascript:Object.fromEntries([relayCarry.id, relayCarry.carryFrom]
  .map(id => [`${legacy(relayPage)}:${relay.slug}-${id}`, relayPage]))};

// Exercise the production lookup paths with an older edition without modifying
// the real generated history or adding a test switch to the application API.
const historyUrl = new URL('../data/reading-revisions.json', import.meta.url).href;
const hook = registerHooks({load(url, context, next) {
  return url === historyUrl ? {format:'json', source:JSON.stringify(history), shortCircuit:true} : next(url, context);
}});
const {createMobileEngine} = await import('../lib/mobile/engine.mjs');
hook.deregister();

const port = 49153;
const host = `127.0.0.1:${port}`;
const signals = new Map(['SIGTERM','SIGINT'].map(signal => [signal, new Set(process.listeners(signal))]));
let handler;
let directory;
let stores;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dungeons-book-revisions-'));
  const database = join(directory, 'ferrum.sqlite');
  const env = {PORT:'0', FERRUM_DB:database, FERRUM_LLM_CLI:undefined, FERRUM_LLM_MODEL:undefined,
    FERRUM_DESKTOP_TOKEN:undefined, DUNGEONS_NATIVE_RUNNER_DIR:''};
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const setEnv = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  mock.method(http, 'createServer', listener => {
    handler = listener;
    return {address:() => ({port}), listen:(_port, _host, ready) => ready(),
      close:done => done(), closeAllConnections() {}};
  });
  syncBuiltinESMExports();
  setEnv(env);
  try { await import('../server.mjs'); }
  finally { setEnv(previous); mock.restoreAll(); syncBuiltinESMExports(); }
  stores = {rust:await openStore({file:database}), javascript:await openStore({file:join(directory, 'ferrum.javascript.sqlite')})};
});

after(async () => {
  for (const store of Object.values(stores ?? {})) store.close();
  for (const [signal, original] of signals) {
    for (const listener of process.listeners(signal).filter(listener => !original.has(listener))) {
      process.off(signal, listener);
      if (signal === 'SIGTERM') listener();
    }
  }
  if (directory) await rm(directory, {recursive:true, force:true});
});

async function request(url, {world='rust', hero, body, method=body ? 'POST' : 'GET', status=200} = {}) {
  const input = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(input, {url, method, headers:{host, 'x-ferrum-world':world,
    'x-ferrum-request':'1', 'content-type':'application/json', ...(hero ? {'x-ferrum-hero':hero.id} : {})}});
  const output = Object.assign(new EventEmitter(), {setHeader() {},
    writeHead(code) { this.status = code; this.headersSent = true; },
    end(value) { this.value = JSON.parse(value); }});
  await handler(input, output);
  assert.equal(output.status, status, JSON.stringify(output.value));
  return output.value;
}

const hero = async (name, world='rust') => (await request('/api/heroes', {world, body:{name}, status:201})).hero;
const aidBody = {page:assessmentPage.page, promptId:rubric.promptId};
const desktopVersion = createWrittenGm().getPrompt('rust', rubric.promptId, rubric.question).version;
function seedAssessment(store, hero, {page=legacy(assessmentPage.page), score=100, version=desktopVersion} = {}) {
  const id = store.startAssessment(hero.id, page, rubric.promptId, 'Saved explanation');
  store.completeAssessment(hero.id, page, rubric.promptId, id, {score, rubricVersion:version});
}

test('desktop self-review uses a moved saved draft and keeps a newer empty draft authoritative', async () => {
  const explorer = await hero('Legacy Forge');
  const store = stores.rust;
  store.saveResponse(explorer.id, legacy(boss.bossPage), `boss-${boss.level}`, 'My ownership table', 'Saved');
  const oldRows = store.progress(explorer.id).responses;
  await request(`/api/progress/${boss.level}`, {hero:explorer, method:'PATCH', body:{forge:true}});
  assert.deepEqual(store.progress(explorer.id).responses, oldRows, 'Reading an alias must not rewrite saved evidence');
  store.saveResponse(explorer.id, boss.bossPage, `boss-${boss.level}`, '', 'Saved');
  await request(`/api/progress/${boss.level}`, {hero:explorer, method:'PATCH', body:{forge:true}, status:409});
});

test('desktop moved perfect assessments unlock only their current rubric and cannot override a newer answer', async () => {
  const explorer = await hero('Legacy Assessment');
  const store = stores.rust;
  store.setWorkbenchMode(explorer.id, assessmentPage.level, 'hard');
  seedAssessment(store, explorer);
  assert.equal((await request('/api/answers/reveal', {hero:explorer, body:aidBody})).text, rubric.reference);
  store.saveResponse(explorer.id, assessmentPage.page, rubric.promptId, 'A newer unreviewed answer', 'Saved');
  await request('/api/answers/reveal', {hero:explorer, body:aidBody, status:403});
  const stale = await hero('Stale Assessment');
  store.setWorkbenchMode(stale.id, assessmentPage.level, 'hard');
  seedAssessment(store, stale, {version:'obsolete-rubric'});
  await request('/api/answers/reveal', {hero:stale, body:aidBody, status:403});
});

test('desktop side quests restore moved drafts and carry completed code without exposing sealed content', async () => {
  const explorer = await hero('Legacy Rogue');
  const id = `${rogue.slug}-${rogueCode.id}`;
  stores.rust.saveResponse(explorer.id, legacy(roguePage), id, '// unsent ledger repair', 'Saved');
  const restored = await request('/api/rogue-rust', {hero:explorer});
  assert.equal(restored.stages.find(stage => stage.id === rogueCode.id).draft, '// unsent ledger repair');
  assert.equal(restored.debrief, undefined);
  assert.doesNotMatch(JSON.stringify(restored), /"reference"|"tests"|"answer"/);
  stores.rust.saveResponse(explorer.id, roguePage, id, '', 'Saved');
  assert.equal((await request('/api/rogue-rust', {hero:explorer})).stages.find(stage => stage.id === rogueCode.id).draft, '');
  const relayHero = await hero('Legacy Relay', 'javascript');
  const store = stores.javascript;
  const carried = '// prior completed boundary';
  store.saveResponse(relayHero.id, legacy(relayPage), `${relay.slug}-${relayCarry.carryFrom}`, carried, 'Saved');
  store.recordEncounterStage(relayHero.id, relay.catalog.id, relayCarry.carryFrom, {correct:true});
  const next = (await request('/api/refactoring', {world:'javascript', hero:relayHero})).stages.find(stage => stage.id === relayCarry.id);
  assert.equal(next.starter, `${carried}\n\n${relayCarry.exercise.starter}`);
});

function memoryRepository() {
  const rows = new Map();
  const list = () => structuredClone([...rows.values()]);
  return {list, get:id => structuredClone(rows.get(id)),
    create(record, check) { check(list()); rows.set(record.hero.id, structuredClone(record)); },
    mutate(id, update, check) {
      const values = list();
      const record = values.find(record => record.hero.id === id);
      if (!record) throw new Error('Hero not found.');
      const result = update(record); check?.(values);
      rows.set(id, structuredClone(record)); return structuredClone(result);
    }, remove:id => rows.delete(id)};
}

async function mobile(worldId='rust') {
  const repository = memoryRepository();
  const {api} = createMobileEngine({worldId, repository, storage:{getItem:() => null, setItem() {}, removeItem() {}}});
  const {hero} = await api('/api/heroes', {method:'POST', body:{name:'Prior Edition'}});
  const seed = (page, promptId, value, assessment) => repository.mutate(hero.id, record => {
    record.responses[`${page}:${promptId}`] = {page,promptId,value,feedback:'Saved', ...(assessment ? {assessment} : {})};
  });
  return {api:(path, options={}) => api(path, {...options,hero}), hero, repository, seed};
}

test('mobile self-review uses a moved saved draft without reviving an empty replacement', async () => {
  const game = await mobile();
  game.seed(legacy(boss.bossPage), `boss-${boss.level}`, 'Saved ownership table');
  const before = game.repository.get(game.hero.id).responses;
  await game.api(`/api/progress/${boss.level}`, {method:'PATCH',body:{forge:true}});
  assert.deepEqual(game.repository.get(game.hero.id).responses, before);
  game.seed(boss.bossPage, `boss-${boss.level}`, '');
  await assert.rejects(game.api(`/api/progress/${boss.level}`, {method:'PATCH',body:{forge:true}}), /Save your boss encounter draft/);
});

test('mobile moved assessments retain Hard Mode gates for newer or outdated answers', async () => {
  const game = await mobile();
  await game.api(`/api/workbench/${assessmentPage.level}/mode`, {method:'PATCH',body:{mode:'hard'}});
  game.seed(legacy(assessmentPage.page), rubric.promptId, 'Saved explanation', {score:100,rubricVersion:'mobile-1'});
  assert.equal((await game.api('/api/answers/reveal', {method:'POST',body:aidBody})).text, rubric.reference);
  game.seed(assessmentPage.page, rubric.promptId, 'New unreviewed answer');
  await assert.rejects(game.api('/api/answers/reveal', {method:'POST',body:aidBody}), /Hard Mode locks/);
  const stale = await mobile();
  await stale.api(`/api/workbench/${assessmentPage.level}/mode`, {method:'PATCH',body:{mode:'hard'}});
  stale.seed(legacy(assessmentPage.page), rubric.promptId, 'Old model verdict', {score:100,rubricVersion:'mobile-old'});
  await assert.rejects(stale.api('/api/answers/reveal', {method:'POST',body:aidBody}), /Hard Mode locks/);
});

test('mobile side quests recover moved drafts and carry prior completed code without mutating the saves', async () => {
  const game = await mobile();
  const id = `${rogue.slug}-${rogueCode.id}`;
  game.seed(legacy(roguePage), id, '// old unfinished repair');
  const before = game.repository.get(game.hero.id).responses;
  const quest = await game.api('/api/rogue-rust');
  assert.equal(quest.stages.find(stage => stage.id === rogueCode.id).draft, '// old unfinished repair');
  assert.equal(quest.debrief, undefined);
  assert.deepEqual(game.repository.get(game.hero.id).responses, before);
  game.seed(roguePage, id, '');
  assert.equal((await game.api('/api/rogue-rust')).stages.find(stage => stage.id === rogueCode.id).draft, '');
  const relayGame = await mobile('javascript');
  const code = '// carried parser';
  relayGame.seed(legacy(relayPage), `${relay.slug}-${relayCarry.carryFrom}`, code);
  relayGame.repository.mutate(relayGame.hero.id, record => {
    record.encounters[relay.catalog.id] = {[relayCarry.carryFrom]:{correct:true}};
  });
  const next = (await relayGame.api('/api/refactoring')).stages.find(stage => stage.id === relayCarry.id);
  assert.equal(next.starter, `${code}\n\n${relayCarry.exercise.starter}`);
});
