import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright-core';
import javascript from '../data/workbench/javascript.mjs';
import typescript from '../data/workbench/typescript.mjs';
import go from '../data/workbench/go.mjs';
import { diamondName, diamondPages, diamondSolution, goblinName } from './diamond-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.FERRUM_DESKTOP_EXECUTABLE
  ?? join(project, 'out', 'Coding Dungeons-win32-x64', 'Coding Dungeons.exe');

async function openDesktop(userData) {
  const args = [`--user-data-dir=${userData}`];
  if (process.env.FERRUM_DESKTOP_SMOKE_UNSANDBOXED === '1') args.push('--no-sandbox');
  return electron.launch({
    executablePath,
    args,
    chromiumSandbox: true,
    timeout: 20_000,
  });
}

async function worldPicker(page) {
  const worlds = page.getByRole('dialog', {name: 'Choose a world'});
  await worlds.waitFor();
  assert.deepEqual(await worlds.locator('a strong').allTextContents(),
    ['JavaScript', 'TypeScript', 'Rust', 'Go']);
  return worlds;
}

function watchElectronMemory(application) {
  let current;
  let failure;
  let samples = 0;
  let peakWorkingSetBytes = 0;
  let peakPrivateBytes = 0;
  function sample() {
    if (current || failure) return;
    current = application.evaluate(({app}) => app.getAppMetrics().map(({memory}) => ({
      workingSetSize: memory.workingSetSize,
      privateBytes: memory.privateBytes ?? 0,
    }))).then((rows) => {
      samples += 1;
      const workingSet = rows.reduce((total, row) => total + row.workingSetSize, 0);
      const privateBytes = rows.reduce((total, row) => total + row.privateBytes, 0);
      peakWorkingSetBytes = Math.max(peakWorkingSetBytes, workingSet * 1024);
      peakPrivateBytes = Math.max(peakPrivateBytes, privateBytes * 1024);
    }).catch((error) => {
      failure = error;
    }).finally(() => { current = undefined; });
  }
  sample();
  const interval = setInterval(sample, 100);
  return async () => {
    clearInterval(interval);
    await current;
    if (failure) throw failure;
    return {samples, peakWorkingSetBytes, peakPrivateBytes};
  };
}

async function winFirstWorkbench(page, world, language, source) {
  const catalog = world === 'rust' ? join(project, 'data', 'campaign.json')
    : join(project, 'data', 'worlds', world, 'campaign.json');
  const campaign = JSON.parse(await readFile(catalog, 'utf8'));
  const firstQuest = campaign.quests.find(({level}) => level === 1);
  const pageInput = page.locator('#page-number');
  await pageInput.fill(String(firstQuest.bossPage));
  await pageInput.press('Enter');
  const hardMode = page.getByRole('button', {name: 'Hard Mode', exact: true});
  await page.getByRole('textbox', {name: `${language} code`}).waitFor();
  if (await hardMode.isVisible()) await hardMode.click();
  await page.getByText('Coaching is locked for this encounter.', {exact: true}).waitFor();
  await page.getByRole('textbox', {name: `${language} code`}).fill(source);
  await page.getByRole('button', {name: 'Run Examples', exact: true}).click();
  await page.getByText('Examples passed', {exact: true}).waitFor();
  await page.locator('.creature-encounter[data-state="ready"]').waitFor();
  await page.getByRole('button', {name: 'Submit solution', exact: true}).click();
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByText('Hard Clear', {exact: true}).waitFor();
}

async function chooseWorldHero(page, world, hero) {
  await page.getByRole('button', {name:'Worlds', exact:true}).click();
  await (await worldPicker(page)).getByRole('link', {name:world}).click();
  await page.getByLabel('Hero name').fill(hero);
  await page.getByRole('button', {name:'Create hero'}).click();
  await page.locator('#page-frame:not([hidden]) img').waitFor();
}

async function winGoblinAmbush(page) {
  const pages = await diamondPages(page, 8);
  const discovery = pages.find(({ sparkle }) => sparkle);
  assert.ok(discovery, 'A diamond should be hidden on one of the first eight pages');
  const pageNumber = page.locator('#page-number');
  await pageNumber.fill(String(discovery.number));
  await pageNumber.press('Enter');
  await page.getByRole('img', {
    name: new RegExp(`campaign book, page ${discovery.number}(?: ·|$)`),
  }).waitFor();
  await page.getByRole('button', { name: diamondName }).click();
  const fight = page.locator('.diamond-encounter');
  await fight.getByRole('heading', { name: goblinName, exact: true }).waitFor();
  await fight.getByRole('textbox', { name: 'Goblin code' }).fill(diamondSolution);
  await fight.getByRole('button', { name: 'Submit code', exact: true }).click();
  await fight.getByRole('radio', { name: 'values.slice()', exact: true }).check();
  await fight.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await fight.getByText('Goblin defeated', { exact: true }).waitFor();
}

test('Windows package protects its engine, runs the required Workbenches, and retains saves',
  {timeout: 240_000}, async (t) => {
    await access(executablePath).catch((error) => {
      throw new Error('Build the Windows app with npm run desktop:package before running the desktop smoke.', {cause: error});
    });
    const out = join(project, 'out');
    await mkdir(out, {recursive: true});
    const userData = await mkdtemp(join(out, '.desktop-smoke-'));
    let application;
    let stopMemory;
    t.after(async () => {
      try {
        await stopMemory?.();
      } finally {
        await application?.close();
        await rm(userData, {recursive: true, force: true, maxRetries: 4});
      }
    });
    const launchStart = performance.now();
    application = await openDesktop(userData);
    stopMemory = watchElectronMemory(application);
    const runtime = await application.evaluate(({app}) => ({packaged: app.isPackaged, userData: app.getPath('userData')}));
    assert.equal(runtime.packaged, true);
    assert.equal(normalize(runtime.userData).toLowerCase(), normalize(userData).toLowerCase());

    const page = await application.firstWindow();
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('#campaign-root .reader-panel').waitFor();
    const worlds = await worldPicker(page);
    const launchToWorldPickerMs = Math.round(performance.now() - launchStart);
    const origin = new URL(page.url()).origin;
    const response = await fetch(`${origin}/api/worlds`);
    assert.equal(response.ok, false);
    await response.body?.cancel();
    assert.equal(await page.evaluate(() => typeof globalThis.require), 'undefined');

    await worlds.getByRole('link', {name: /^World 1 JavaScript\b/}).click();
    await page.getByLabel('Hero name').fill('Desktop smoke hero');
    await page.getByRole('checkbox', {name:'One Life', exact:true}).check();
    await page.getByRole('button', {name: 'Create hero'}).click();
    await page.locator('#page-frame:not([hidden]) img').waitFor();
    const health = page.locator('#combat-status');
    await health.getByText('100 / 100 HP', {exact:true}).waitFor();
    await page.waitForFunction(() => document.querySelector('#book-page')?.naturalWidth > 0);
    await page.keyboard.press('d');
    await page.getByRole('img', {name: /campaign book, page 2(?: ·|$)/}).waitFor();
    assert.equal(new URL(page.url()).hash, '#page=2');
    await access(join(userData, 'state', 'ferrum.javascript.sqlite'));
    await winFirstWorkbench(page, 'javascript', 'JavaScript', javascript[0].reference);
    await health.getByText('2 potions', {exact:true}).waitFor();
    await winGoblinAmbush(page);
    await health.getByText('3 potions', {exact:true}).waitFor();

    await page.getByRole('button', {name: 'Worlds', exact: true}).click();
    await (await worldPicker(page)).getByRole('link', {name: /^World 2 TypeScript\b/}).click();
    await page.getByLabel('Hero name').fill('TypeScript smoke hero');
    await page.getByRole('button', {name: 'Create hero'}).click();
    await page.locator('#page-frame:not([hidden]) img').waitFor();
    await winFirstWorkbench(page, 'typescript', 'TypeScript', typescript[0].reference);
    if (process.env.FERRUM_DESKTOP_REQUIRE_NATIVE === '1') {
      await chooseWorldHero(page, /^World 4 Go\b/, 'Go smoke hero');
      await winFirstWorkbench(page, 'go', 'Go', go[0].reference);
    }
    if (process.env.FERRUM_DESKTOP_REQUIRE_GM === '1' || process.env.FERRUM_DESKTOP_REQUIRE_NATIVE === '1') {
      await chooseWorldHero(page, /^World 3 Rust\b/, 'Rust smoke hero');
    }
    if (process.env.FERRUM_DESKTOP_REQUIRE_GM === '1') {
      const input = page.locator('#page-number');
      await input.fill('25');
      await input.press('Enter');
      await page.getByRole('button', {name:'Hard Mode', exact:true}).click();
      const prompt = page.locator('.prompt-form').filter({has:page.getByRole('heading', {name:'Training encounter 3', exact:true})});
      await prompt.getByRole('textbox').fill('The shared borrow may end after the last use of the entry. Using the entry after refresh would make that borrow overlap the mutable one.');
      await prompt.getByRole('button', {name:'Ask the GM', exact:true}).click();
      await prompt.getByText('GM estimate · 60% of rubric points', {exact:true}).waitFor({timeout:30_000});
      assert.equal(await prompt.getByRole('button', {name:'Show example answer'}).count(), 0);
    }
    if (process.env.FERRUM_DESKTOP_REQUIRE_NATIVE === '1') {
      const [rust] = JSON.parse(await readFile(join(project, 'data', 'exercises.json'), 'utf8'));
      await winFirstWorkbench(page, 'rust', 'Rust', rust.solution);
    }
    const memory = await stopMemory();
    stopMemory = undefined;
    assert.ok(memory.samples > 0 && memory.peakWorkingSetBytes > 0, 'Expected actual desktop memory samples.');
    t.diagnostic(JSON.stringify({
      launchToWorldPickerMs,
      memoryScope: 'Electron-managed processes sampled every 100 ms',
      chromiumSandbox: process.env.FERRUM_DESKTOP_SMOKE_UNSANDBOXED !== '1',
      ...memory,
    }));

    await application.close();
    application = await openDesktop(userData);
    const reopened = await application.firstWindow();
    const reopenedWorlds = await worldPicker(reopened);
    await reopenedWorlds.getByRole('link', {name: /^World 1 JavaScript\b/}).click();
    await reopened.getByRole('button', {name: /Desktop smoke hero/}).click();
    await reopened.getByRole('button', {name: 'Character sheet'}).click();
    await reopened.getByRole('dialog', {name: 'Character sheet'})
      .getByText('Diamonds collected · 3', {exact: true}).waitFor();
  });
