import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {quickjsSecurityCases} from '../test/fixtures/quickjs-security.mjs';
import {diamondPages, diamondName, diamondSolution} from './diamond-fixture.mjs';

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
  const pageInput = page.locator('#page-number');
  await pageInput.fill(String(bossPage));
  await pageInput.press('Enter');
  if (id === 'csharp') {
    const draft = 'Console.WriteLine("Lantern ready");';
    const editor = page.getByRole('textbox', {name:'C# code', exact:true});
    await editor.fill(draft);
    await page.getByRole('button', {name:'Save code draft', exact:true}).click();
    await page.getByText('Draft saved', {exact:true}).waitFor();
    const review = page.getByRole('checkbox', {name:'Forge self-review', exact:true});
    await review.check();
    await page.getByText('Quest log updated', {exact:true}).waitFor();
    await page.reload();
    await editor.waitFor();
    assert.equal(await editor.inputValue(), draft);
    assert.ok(await review.isChecked());
    console.log('Passed: C# guided code notebook, Forge self-review and reload');
    return;
  }
  const [first] = id === 'rust'
    ? await fromJson(join(directory,'exercises.json'))
    : (await import(pathToFileURL(join(project,'data','workbench',`${id}.mjs`)))).default;
  const codeBox = page.getByRole('textbox', {name:`${language} code`});
  let answer = first.reference ?? first.solution;
  if (id === 'javascript' || id === 'typescript') {
    // These fixed JavaScript fixtures exercise the guest interpreter without
    // introducing unrelated TypeScript errors into the challenge signature.
    answer += '\n' + quickjsSecurityCases.map(({expression}) =>
      `if (!eval(${JSON.stringify(expression)})) throw new Error('QuickJS security regression');`).join('\n');
  }
  await codeBox.fill(answer);
  const submit = page.getByRole('button', {name:'Submit solution', exact:true});
  await submit.click({timeout:15_000});
  await page.getByText('Tests passed', {exact:true}).waitFor({timeout:45_000});
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.reload();
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  console.log(`Passed: ${language} full Workbench suite, Forge and reload`);
  if (id === 'javascript' || id === 'typescript') console.log(`Passed: ${language} packaged QuickJS security regressions`);
  if (id === 'javascript') await dismissGoblin(page);
  if (id === 'rust' || id === 'go') await repairDispatch(page, id, language);
}

async function repairDispatch(page, id, language) {
  phase = `${language} rogue microservice quest`;
  const {default:catalog} = await import(pathToFileURL(join(project, 'data', 'workbench', `rogue-${id}.mjs`)));
  await page.getByRole('button', {name:'World map', exact:true}).click();
  await page.getByRole('dialog', {name:'World map', exact:true})
    .getByRole('link', {name:catalog.title, exact:true}).click();
  const quest = page.getByRole('region', {name:catalog.title, exact:true});
  await quest.getByText(`0 / ${catalog.stages.length} steps complete`, {exact:true}).waitFor();
  for (const [index, stage] of catalog.stages.entries()) {
    phase = `${language} rogue microservice quest: ${stage.id}`;
    if (stage.kind === 'choice') {
      const answer = stage.options.find(option => option.id === stage.answer);
      assert.ok(answer, `${stage.id} authored choice`);
      await quest.getByRole('radio', {name:answer.label, exact:true}).check();
      await quest.getByRole('button', {name:'Check answer', exact:true}).click();
    } else {
      await quest.getByRole('textbox', {name:`${language} side quest code`, exact:true}).fill(stage.exercise.reference);
      await quest.getByRole('button', {name:'Submit solution', exact:true}).click();
    }
    const status = index + 1 === catalog.stages.length ? 'Quest complete'
      : `${index + 1} / ${catalog.stages.length} steps complete`;
    await quest.getByText(status, {exact:true})
      .waitFor({timeout:45_000});
  }
  await page.reload();
  await page.getByRole('region', {name:catalog.title, exact:true})
    .getByText('Quest complete', {exact:true}).waitFor();
  console.log(`Passed: ${language} packaged full repair story, all three code suites and reload`);
}

async function dismissGoblin(page) {
  phase = 'completed goblin dismissal';
  const discovery = (await diamondPages(page, 8)).find(view => view.sparkle);
  assert.ok(discovery, 'The first block must contain a hidden diamond.');
  const input = page.locator('#page-number');
  await input.fill(String(discovery.number));
  await input.press('Enter');
  await page.getByRole('button', {name:diamondName}).click();
  const fight = page.locator('.diamond-encounter');
  await fight.getByRole('textbox', {name:'Goblin code'}).fill(diamondSolution);
  await fight.getByRole('button', {name:'Submit code', exact:true}).click();
  await fight.getByRole('radio', {name:'values.slice()', exact:true}).check();
  await fight.getByRole('button', {name:'Submit answer', exact:true}).click();
  await fight.getByText('Goblin defeated', {exact:true}).waitFor();
  await fight.getByRole('button', {name:'Continue adventure', exact:true}).click();
  await fight.waitFor({state:'hidden'});
  await page.reload();
  await page.locator('#page-frame:not([hidden]) img').waitFor();
  await fight.waitFor({state:'hidden'});
  await page.getByRole('button', {name:'Character sheet', exact:true}).click();
  const sheet = page.getByRole('dialog', {name:'Character sheet', exact:true});
  await sheet.getByText('Diamonds collected · 3', {exact:true}).waitFor();
  await sheet.getByRole('button', {name:'Close character sheet', exact:true}).click();
  console.log('Passed: packaged goblin dismissal, reload and retained diamonds');
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
      ['javascript','JavaScript',1], ['typescript','TypeScript',2], ['csharp','C# and .NET',3], ['rust','Rust',4], ['go','Go',5],
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
