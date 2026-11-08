import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  engineEnvironment, engineHeaders, engineOrigin, isEngineUrl,
} from '../desktop/window-policy.mjs';
import { waitForEngine } from '../desktop/engine-lifecycle.mjs';
import { trustedBookLinks } from '../desktop/book-links.mjs';
import { nativeBrokerEnvironment } from '../lib/standalone-runner.mjs';

const origin = 'http://127.0.0.1:49352';
const token = 'per-launch-test-token';

test('only a valid readiness message can select the loopback engine port', () => {
  assert.equal(engineOrigin({type: 'ferrum-ready', port: 49352}), origin);
  for (const message of [
    null, 'ferrum-ready', {port: 49352}, {type: 'unrelated', port: 49352},
    {type: 'ferrum-ready', port: '49352'}, {type: 'ferrum-ready', port: 0},
    {type: 'ferrum-ready', port: -1}, {type: 'ferrum-ready', port: 65536},
  ]) assert.equal(engineOrigin(message), null);
});

test('the desktop partition permits requests only to the selected HTTP engine origin', () => {
  assert.ok(isEngineUrl(origin, origin));
  assert.ok(isEngineUrl(`${origin}/book/page.webp?revision=2`, origin));
  for (const candidate of [
    'http://127.0.0.1:49353/', 'http://localhost:49352/', 'https://127.0.0.1:49352/',
    'https://example.com/', 'file:///C:/private.txt', 'data:text/html,hello',
    `blob:${origin}/asset`, 'http://127.0.0.1:49352@other.example/', 'not a URL',
  ]) assert.equal(isEngineUrl(candidate, origin), false);
});

test('the desktop session replaces a forged header and keeps the token off other requests', () => {
  const requestHeaders = {'X-Ferrum-Desktop-Token': 'forged', Accept: '*/*'};
  assert.deepEqual(engineHeaders(`${origin}/api/progress`, origin, token, requestHeaders), {
    Accept: '*/*', 'x-ferrum-desktop-token': token,
  });
  assert.deepEqual(engineHeaders('https://example.com/', origin, token, requestHeaders), {Accept: '*/*'});
  assert.equal(requestHeaders['X-Ferrum-Desktop-Token'], 'forged');
});

test('the desktop waits for the actual engine readiness signal and removes temporary handlers', async () => {
  const worker = new EventEmitter();
  const started = waitForEngine(worker, 100);
  worker.emit('message', {type: 'unrelated', port: 1});
  worker.emit('message', {type: 'ferrum-ready', port: 49352});
  assert.equal(await started, origin);
  assert.equal(worker.listenerCount('message'), 0);
  assert.equal(worker.listenerCount('exit'), 0);
});

test('early engine exit and missing readiness fail the launch', async () => {
  const exiting = new EventEmitter();
  const started = waitForEngine(exiting, 100);
  exiting.emit('exit', 5);
  await assert.rejects(started, /exited.*5/i);
  await assert.rejects(waitForEngine(new EventEmitter(), 5), /timed out/i);
});

test('utility configuration selects private saves and omits ambient application secrets', () => {
  const appPath = 'C:/Installed Apps/Coding Dungeons/resources/app.asar';
  const userData = 'C:/Users/Player/AppData/Roaming/Coding Dungeons';
  const hostEnvironment = {
    SystemRoot: 'C:/Windows', TEMP: 'C:/Temp', LocalAppData: 'C:/Users/Player/AppData/Local',
    PORT: '8080', FERRUM_DB: 'shared.db', FERRUM_DESKTOP_TOKEN: 'outside',
    OPENAI_API_KEY: 'outside', GITHUB_TOKEN: 'outside', NODE_OPTIONS: '--require foreign.js',
    FERRUM_LLM_MODEL: 'foreign.gguf',
    DUNGEONS_NATIVE_RUNNER_DIR: 'ambient-broker',
  };
  assert.deepEqual(engineEnvironment({appPath, userData, token, hostEnvironment}), {
    SystemRoot: 'C:/Windows', TEMP: 'C:/Temp', LocalAppData: 'C:/Users/Player/AppData/Local',
    PORT: '0', FERRUM_DB: join(userData, 'state', 'ferrum.sqlite'),
    FERRUM_PUBLIC_DIR: join(appPath, 'dist', 'renderer'), FERRUM_DESKTOP_TOKEN: token,
  });
  const model = {cli: 'C:/Installed Apps/runtime/llama-completion.exe', weights: 'C:/Installed Apps/runtime/gm-model.gguf'};
  const nativeRunner = 'C:/Installed Apps/runtime/standalone-runner';
  const child = engineEnvironment({appPath, userData, token, hostEnvironment, model, nativeRunner});
  assert.equal(child.FERRUM_LLM_CLI, model.cli);
  assert.equal(child.FERRUM_LLM_MODEL, model.weights);
  assert.equal(child.DUNGEONS_NATIVE_RUNNER_DIR, nativeRunner);
  assert.deepEqual(nativeBrokerEnvironment(child), {
    SystemRoot: 'C:/Windows', LOCALAPPDATA: 'C:/Users/Player/AppData/Local',
  });
});

test('only exact HTTPS documentation links from the installed books are approved', async () => {
  const links = await trustedBookLinks(fileURLToPath(new URL('../', import.meta.url)));
  const reference = 'https://doc.rust-lang.org/reference/expressions.html';
  assert.ok(links.has(reference));
  assert.equal(links.has(reference + '?redirect=elsewhere'), false);
  assert.equal(links.has('https://doc.rust-lang.org/synthetic-link.html'), false);
  assert.equal(links.has(reference.replace('https:', 'http:')), false);
});
