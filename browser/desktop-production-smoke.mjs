import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const project = resolve(process.argv[2] ?? process.cwd());
const executable = join(project, 'out', 'Coding Dungeons-win32-x64', 'Coding Dungeons.exe');
const requireFromProject = createRequire(join(project, 'package.json'));
const {chromium} = requireFromProject('playwright-core');
const profile = await mkdtemp(join(tmpdir(), 'coding-dungeons-production-smoke-'));
let browser;
let processError;
let phase = 'starting packaged desktop';
const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], {
  windowsHide:true, stdio:'ignore',
});
child.once('error', error => { processError = error; });

async function connect() {
  const until = performance.now() + 35_000;
  const portFile = join(profile, 'DevToolsActivePort');
  while (performance.now() < until) {
    if (processError || child.exitCode !== null) throw new Error('The launched package exited before opening a debugger.');
    const [port, endpoint] = (await readFile(portFile, 'utf8').catch(() => '')).trim().split(/\r?\n/);
    if (/^\d{1,5}$/.test(port) && /^\/devtools\/browser\/[a-f0-9-]+$/i.test(endpoint)) {
      return chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`, {timeout:5_000});
    }
    await delay(150);
  }
  throw new Error('Timed out waiting for the package’s Chromium debugging endpoint.');
}

async function worldWindow() {
  const until = performance.now() + 10_000;
  while (performance.now() < until) {
    const tab = browser.contexts().flatMap(context => context.pages())
      .find(page => /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()));
    if (tab) return tab;
    await delay(150);
  }
  throw new Error('The packaged app did not open its local book window.');
}

async function firstChallenge(page, id, language, number) {
  phase = `${language} hero and first challenge`;
  const picker = page.getByRole('dialog', {name:'Choose a world'});
  if (!await picker.isVisible()) await page.getByRole('button', {name:'Worlds', exact:true}).click();
  await picker.getByRole('link', {name:new RegExp(`^World ${number} ${language}\\b`)}).click();
  await page.getByLabel('Hero name').fill(`Temporary ${language} hero`);
  await page.getByRole('button', {name:'Create hero', exact:true}).click();
  await page.locator('#page-frame:not([hidden]) img').waitFor();

  const directory = id === 'rust' ? join(project,'data') : join(project,'data','worlds',id);
  const fromJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  const campaign = await fromJson(join(directory, 'campaign.json'));
  const {bossPage} = campaign.quests.find(quest => quest.level === 1);
  const [first] = id === 'rust'
    ? await fromJson(join(directory,'exercises.json'))
    : (await import(pathToFileURL(join(project,'data','workbench',`${id}.mjs`)))).default;
  const pageInput = page.locator('#page-number');
  await pageInput.fill(String(bossPage));
  await pageInput.press('Enter');
  const codeBox = page.getByRole('textbox', {name:`${language} code`});
  await codeBox.fill(first.reference ?? first.solution);
  const submit = page.getByRole('button', {name:'Submit solution', exact:true});
  await submit.click({timeout:15_000});
  await page.getByText('Tests passed', {exact:true}).waitFor({timeout:45_000});
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.reload();
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  console.log(`Passed: ${language} full Workbench suite, Forge and reload`);
}

async function closeOwnedChild() {
  if (browser?.isConnected()) {
    const connection = await browser.newBrowserCDPSession().catch(() => null);
    try {
      await Promise.race([connection?.send('Browser.close').catch(() => {}), delay(2_000)]);
    } catch {
      // Fall back to the specific process launched for this test.
    }
  }
  const until = performance.now() + 4_000;
  while (!processError && child.exitCode === null && child.signalCode === null && performance.now() < until) {
    await delay(100);
  }
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await browser?.close().catch(() => {});
  await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:100}).catch(() => {
    process.exitCode = 1;
    console.error('The temporary profile could not be removed automatically.');
  });
}

try {
  browser = await connect();
  const page = await worldWindow();
  page.setDefaultTimeout(8_000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('dialog', {name:'Choose a world'}).waitFor();
  console.log('Passed: packaged desktop opened its world picker');

  phase = 'checking the local engine and renderer boundary';
  const origin = new URL(page.url()).origin;
  const outside = await fetch(`${origin}/api/worlds`, {signal:AbortSignal.timeout(5_000)});
  await outside.body?.cancel();
  assert.equal(outside.status, 403);
  const renderer = await page.evaluate(async () => ({
    require:typeof globalThis.require,
    process:typeof globalThis.process,
    apiStatus:(await fetch('/api/worlds')).status,
  }));
  assert.deepEqual(renderer, {require:'undefined', process:'undefined', apiStatus:200});
  console.log('Passed: external requests denied and renderer has no Node globals');

  if (process.env.CODING_DUNGEONS_SMOKE_STARTUP_ONLY !== '1') {
    for (const [id, language, number] of [
      ['javascript','JavaScript',1], ['typescript','TypeScript',2], ['rust','Rust',3], ['go','Go',4],
    ]) await firstChallenge(page, id, language, number);
  }
} catch (error) {
  const detail = error.message.split('\n')[0];
  const safeDetail = detail.replaceAll(profile,'[temporary profile]').replace(/(?:ws|http):\/\/127\.0\.0\.1:\d+/g,'[loopback]');
  console.error(`Failed during ${phase}: ${safeDetail}`);
  process.exitCode = 1;
} finally {
  await closeOwnedChild();
}
