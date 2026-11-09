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

async function request(url, {body, hero, method = body === undefined ? 'GET' : 'POST', status = 200} = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(stream, {url, method, headers:{host, 'x-ferrum-request':'1', 'content-type':'application/json',
    ...(hero ? {'x-ferrum-hero':hero.id} : {})}});
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
