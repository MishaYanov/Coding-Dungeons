import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {chromium, devices} from 'playwright-core';
import {preview} from 'vite';
import exercises from '../data/workbench/javascript.mjs';
import typeScriptExercises from '../data/workbench/typescript.mjs';
import goExercises from '../data/workbench/go.mjs';
import {definitions, riddles} from '../lib/diamond-content.mjs';
import {diamondName, diamondSolution, goblinName} from './diamond-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const {quests:[quest]} = JSON.parse(await readFile(join(project, 'data/worlds/javascript/campaign.json'), 'utf8'));
async function firstQuest(world) {
  const path = world === 'rust' ? 'data/campaign.json' : `data/worlds/${world}/campaign.json`;
  const {quests:[quest]} = JSON.parse((await readFile(join(project, path), 'utf8')).replace(/^\uFEFF/, ''));
  return quest;
}
const execute = promisify(execFile);

async function rustPack() {
  try {
    return JSON.parse(await readFile(join(project, 'dist/mobile/runtime/rust/manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function chromeOptions() {
  if (process.env.FERRUM_BROWSER) return {executablePath:process.env.FERRUM_BROWSER};
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of roots) {
      for (const relative of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
        const executablePath = join(root, relative);
        if (await access(executablePath).then(() => true, () => false)) return {executablePath};
      }
    }
  }
  return {};
}

async function play(t) {
  const server = await preview({configFile:join(project, 'vite.config.mjs'), mode:'mobile',
    preview:{port:0, host:'127.0.0.1', strictPort:true}});
  const cleanup = [() => new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); })];
  // Node runs after hooks FIFO. Release resources in reverse acquisition order:
  // owned tab, CDP connection, ADB forwards, then server. Keep existing tabs open.
  t.after(async () => {
    const failures = [];
    while (cleanup.length) {
      try { await cleanup.pop()(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Mobile test cleanup failed.');
  });
  const {port} = server.httpServer.address();
  let origin = 'http://127.0.0.1:' + port;
  let context;
  const serial = process.env.FERRUM_ANDROID_EMULATOR;
  if (serial) {
    assert.match(serial, /^emulator-\d+$/);
    const adb = process.env.FERRUM_ADB || 'adb';
    const target = args => execute(adb, ['-s', serial, ...args], {timeout:10_000});
    await target(['reverse', 'tcp:' + port, 'tcp:' + port]);
    cleanup.push(() => target(['reverse', '--remove', 'tcp:' + port]));
    origin = 'http://localhost:' + port;
    const {stdout} = await target(['forward', 'tcp:0', 'localabstract:chrome_devtools_remote']);
    const debugPort = stdout.trim();
    assert.match(debugPort, /^\d+$/);
    cleanup.push(() => target(['forward', '--remove', 'tcp:' + debugPort]));
    const endpoint = 'http://127.0.0.1:' + debugPort;
    const listening = await fetch(endpoint + '/json/version', {signal:AbortSignal.timeout(1_000)})
      .then(async response => { await response.body?.cancel(); return response.ok; }, () => false);
    if (!listening) await target(['shell', 'am', 'start', '-a', 'android.intent.action.MAIN',
      '-c', 'android.intent.category.LAUNCHER', '-p', 'com.android.chrome']);
    const browser = await chromium.connectOverCDP(endpoint, {timeout:15_000});
    [context] = browser.contexts();
    cleanup.push(async () => {
      await context.setOffline(false).catch(() => {});
      await browser.close();
    });
  } else {
    const browser = await chromium.launch(await chromeOptions());
    cleanup.push(() => browser.close());
    context = await browser.newContext({...devices['Pixel 7'], reducedMotion:'reduce'});
  }
  if (!serial) cleanup.push(() => context.close());
  const page = await context.newPage();
  if (serial) cleanup.push(() => page.close());
  page.setDefaultTimeout(12_000);
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  t.after(() => {
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
  });
  await page.goto(origin);
  return {page, context, origin};
}

async function jump(page, number) {
  const input = page.locator('#page-number:visible');
  await input.fill(String(number));
  await input.press('Enter');
  await page.waitForURL(url => url.hash === '#page=' + number);
}

async function bookPage(page, number) {
  await page.getByRole('img', {name:new RegExp('book, page ' + number + '(?: ·|$)')}).waitFor();
}

async function hero(page, name, oneLife = false) {
  const picker = page.getByRole('dialog', {name:'Choose your hero'});
  await picker.getByLabel('Hero name').fill(name);
  if (oneLife) await picker.getByRole('checkbox', {name:'One Life'}).check();
  await picker.getByRole('button', {name:'Create hero', exact:true}).click();
  await picker.waitFor({state:'hidden'});
}

function tap(locator) {
  return process.env.FERRUM_ANDROID_EMULATOR ? locator.click() : locator.tap();
}

async function findDiamond(page) {
  const world = page.getByRole('tab', {name:'World', exact:true});
  if (await world.getAttribute('aria-selected') !== 'true') await tap(world);
  let visible = false;
  for (let number = 1; number <= 8 && !visible; number++) {
    await jump(page, number);
    await bookPage(page, number);
    try {
      await page.getByRole('button', {name:diamondName}).waitFor({timeout:350});
      visible = true;
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
    }
  }
  assert.equal(visible, true);
  await tap(page.getByRole('button', {name:diamondName}));
  await page.getByRole('heading', {name:goblinName}).waitFor();
}

test('a phone downloads World 1, grades fights offline, and preserves hero state and drafts', {timeout:120_000}, async t => {
  const {page, context, origin} = await play(t);
  const download = page.getByRole('button', {name:'Download World 1', exact:true});
  await tap(download);
  await page.getByText('World 1 ready offline', {exact:true}).waitFor();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await hero(page, 'Pocket Warden', true);
  await bookPage(page, 1);
  const header = page.getByRole('banner');
  const book = header.getByRole('tab', {name:'World', exact:true});
  const gm = header.getByRole('tab', {name:'GM', exact:true});
  const more = header.getByRole('button', {name:'More options', exact:true});
  const bottom = page.getByRole('navigation', {name:'Book pages', exact:true});
  await more.waitFor();
  assert.equal(await book.getAttribute('aria-selected'), 'true');
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  assert.equal(await header.getByRole('button', {name:'World map', exact:true}).count(), 0);
  const bars = await page.evaluate(() => {
    const bounds = selector => document.querySelector(selector).getBoundingClientRect();
    return {header:bounds('.compact-header').top, bottom:bounds('.mobile-page-controls').bottom,
      viewport:window.innerHeight, tabTop:bounds('#mobile-book-tab').top,
      worldWidth:bounds('#mobile-book-tab').width, gmWidth:bounds('#mobile-gm-tab').width,
      menuTop:bounds('.options-trigger').top, width:document.documentElement.scrollWidth, screen:window.innerWidth};
  });
  assert.equal(bars.header, 0);
  assert.ok(Math.abs(bars.bottom - bars.viewport) < 2);
  assert.equal(bars.tabTop, bars.menuTop);
  assert.equal(bars.worldWidth, bars.gmWidth);
  assert.ok(bars.width <= bars.screen);
  await tap(more);
  const options = page.getByRole('dialog', {name:'Campaign menu', exact:true});
  const closeMenu = options.getByRole('button', {name:'Close campaign menu'});
  await options.waitFor();
  assert.equal(await options.evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    return dialog.matches(':modal') && bounds.top === 0 && bounds.left === 0
      && Math.abs(bounds.width - window.innerWidth) < 2 && Math.abs(bounds.height - window.innerHeight) < 2;
  }), true);
  assert.equal(await closeMenu.evaluate(button => document.activeElement === button), true);
  await options.getByRole('button', {name:'World map', exact:true}).waitFor();
  await options.getByRole('button', {name:'Download World 1', exact:true}).waitFor({state:'hidden'});
  await options.getByText('World 1 ready offline', {exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await options.waitFor({state:'hidden'});
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  assert.equal(await more.evaluate(button => document.activeElement === button), true);
  await tap(more);
  await tap(closeMenu);
  await options.waitFor({state:'hidden'});
  await tap(more);
  await tap(options.getByRole('button', {name:'World map', exact:true}));
  const map = page.getByRole('dialog', {name:'World map', exact:true});
  await map.waitFor();
  await tap(map.getByRole('button', {name:'Close world map'}));
  await tap(bottom.getByRole('button', {name:'Next page', exact:true}));
  await bookPage(page, 2);
  await jump(page, quest.bossPage);
  await bookPage(page, quest.bossPage);
  await tap(gm);
  const editor = page.getByRole('textbox', {name:'JavaScript code', exact:true});
  const source = 'function makeBadge(value) {\nreturn null;\n}';
  await editor.fill(source);
  await editor.evaluate((field, index) => field.setSelectionRange(index, index), source.indexOf('return'));
  await tap(page.getByRole('button', {name:'Indent', exact:true}));
  assert.equal(await editor.inputValue(), source.replace('return', '    return'));
  await tap(page.getByRole('button', {name:'Hard Mode', exact:true}));
  await page.getByText('Coaching is locked for this encounter.', {exact:true}).waitFor();
  assert.equal(await page.getByRole('button', {name:'Hint one', exact:true}).count(), 0);
  await tap(page.getByRole('button', {name:'Submit solution', exact:true}));
  await page.getByText('95 / 100 HP', {exact:true}).waitFor();
  await tap(page.getByRole('button', {name:'Drink potion', exact:true}));
  await page.getByText('100 / 100 HP', {exact:true}).waitFor();
  await editor.fill(exercises[0].reference);
  await tap(page.getByRole('button', {name:'Run Examples', exact:true}));
  await page.getByText('Examples passed', {exact:true}).waitFor();
  await page.locator('.creature-encounter[data-state="ready"]').waitFor();
  await tap(page.getByRole('button', {name:'Submit solution', exact:true}));
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByText('Hard Clear', {exact:true}).waitFor();
  await tap(book);
  await tap(gm);
  const unsent = '// An unsent draft saved offline\n' + exercises[0].reference;
  await editor.fill(unsent);

  // A fresh page uses the same installed origin and IndexedDB even without its former tab session.
  const restored = await context.newPage();
  t.after(() => restored.close().catch(() => {}));
  restored.setDefaultTimeout(12_000);
  await restored.goto(origin);
  await bookPage(restored, quest.bossPage);
  await tap(restored.getByRole('tab', {name:'GM', exact:true}));
  await restored.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await restored.getByText('Hard Clear', {exact:true}).waitFor();
  assert.equal(await restored.getByRole('textbox', {name:'JavaScript code', exact:true}).inputValue(), unsent);
  await tap(restored.getByRole('tab', {name:'World', exact:true}));
  assert.equal(await book.getAttribute('aria-selected'), 'false');

  await findDiamond(restored);
  assert.equal(await restored.getByRole('tab', {name:'GM', exact:true}).getAttribute('aria-selected'), 'true');
  const fight = restored.locator('.diamond-encounter');
  await fight.getByRole('textbox', {name:'Goblin code'}).fill(diamondSolution);
  await tap(fight.getByRole('button', {name:'Submit code', exact:true}));
  await fight.getByRole('radio', {name:'values.slice()', exact:true}).check();
  await tap(fight.getByRole('button', {name:'Submit answer', exact:true}));
  await fight.getByText('Goblin defeated', {exact:true}).waitFor();
});

test('mobile worlds keep their own saves, offline books, and code grading capability', {timeout:360_000}, async t => {
  const {page, context, origin} = await play(t);
  const worlds = [['javascript','JavaScript'], ['typescript','TypeScript'], ['rust','Rust'], ['go','Go']];
  const goBundled = await access(join(project, 'dist/mobile/runtime/go/manifest.json')).then(() => true, () => false);
  const rustBundled = await rustPack();
  const heroPicker = page.getByRole('dialog', {name:'Choose your hero'});
  await tap(heroPicker.getByRole('button', {name:'Change world'}));
  const worldPicker = page.getByRole('dialog', {name:'Choose a world'});
  for (const [index, [id, name]] of worlds.entries()) {
    const world = worldPicker.getByRole('link', {name:new RegExp(`^World ${index + 1} ${name}\\b`)});
    await world.waitFor();
    assert.equal(await world.getAttribute('href'), '?world=' + id);
  }

  async function download(number) {
    await tap(heroPicker.getByRole('button', {name:`Download World ${number}`, exact:true}));
    await heroPicker.getByText(`World ${number} ready offline`, {exact:true}).waitFor({timeout:90_000});
  }

  await tap(worldPicker.locator('[data-world="typescript"]'));
  await download(2);
  const typeQuest = await firstQuest('typescript');
  const gm = page.getByRole('tab', {name:'GM', exact:true});
  await context.setOffline(true);
  await hero(page, 'Type Mage', true);
  await jump(page, typeQuest.bossPage);
  await bookPage(page, typeQuest.bossPage);
  await tap(gm);
  const typeCode = page.getByRole('textbox', {name:'TypeScript code', exact:true});
  const looseType = typeScriptExercises[0].reference.replace('crateCount: number', 'crateCount: any');
  await typeCode.fill(looseType);
  await tap(page.getByRole('button', {name:'Run Examples', exact:true}));
  await page.getByText('Examples passed', {exact:true}).waitFor();
  await tap(page.getByRole('button', {name:'Submit solution', exact:true}));
  await page.getByText('95 / 100 HP', {exact:true}).waitFor();
  await typeCode.fill(typeScriptExercises[0].reference);
  await tap(page.getByRole('button', {name:'Submit solution', exact:true}));
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();

  for (const [world, language, number] of [['rust','Rust',3], ['go','Go',4]]) {
    await context.setOffline(false);
    await page.goto(origin + '?world=' + world);
    assert.equal(await heroPicker.getByRole('button', {name:/Type Mage/}).count(), 0);
    if (world === 'rust' && rustBundled) {
      await heroPicker.getByText(`Includes the experimental Rust ${rustBundled.rustVersion} Workbench. After downloading World 3, code tests run offline.`,
        {exact:true}).waitFor();
    }
    await download(number);
    await context.setOffline(true);
    await hero(page, language + ' Warden', true);
    const mission = await firstQuest(world);
    await jump(page, mission.bossPage);
    await bookPage(page, mission.bossPage);
    await tap(gm);
    const code = page.getByRole('textbox', {name:language + ' code', exact:true});
    const submit = page.getByRole('button', {name:'Submit solution', exact:true});
    if (world === 'rust' && rustBundled) {
      await page.getByText('Rust runner ready', {exact:true}).waitFor();
      assert.match(await page.locator('#runner-status').getAttribute('title'), /Experimental Rust/);
      assert.ok((await page.locator('#runner-status').getAttribute('title')).includes(rustBundled.rustVersion));
      const [exercise] = JSON.parse(await readFile(join(project, 'data/exercises.json'), 'utf8'));
      await code.fill(exercise.solution);
      await tap(page.getByRole('button', {name:'Run Examples', exact:true}));
      await page.getByText('Examples passed', {exact:true}).waitFor({timeout:90_000});
      await page.getByText('100 / 100 HP', {exact:true}).waitFor();
      await tap(submit);
      await page.locator('.creature-encounter[data-state="defeated"]').waitFor({timeout:90_000});
      await page.reload();
      await bookPage(page, mission.bossPage);
      if (!await code.isVisible()) await tap(gm);
      await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
      await findDiamond(page);
      const fight = page.locator('.diamond-encounter');
      await fight.getByRole('textbox', {name:'Goblin code'}).fill(definitions.rust.reference);
      await tap(fight.getByRole('button', {name:'Submit code', exact:true}));
      const answer = riddles.rust.options.find(option => option.id === riddles.rust.answer);
      await fight.getByRole('radio', {name:answer.label, exact:true}).waitFor({timeout:90_000});
      await fight.getByRole('radio', {name:answer.label, exact:true}).check();
      await tap(fight.getByRole('button', {name:'Submit answer', exact:true}));
      await fight.getByText('Goblin defeated', {exact:true}).waitFor();
      await page.getByText('100 / 100 HP', {exact:true}).waitFor();
    } else if (world === 'go' && goBundled) {
      await page.getByText('Go runner ready', {exact:true}).waitFor();
      await code.fill(goExercises[0].reference);
      await tap(submit);
      await page.locator('.creature-encounter[data-state="defeated"]').waitFor({timeout:45_000});
    } else {
      await page.getByText(`${language} runner unavailable on mobile`, {exact:true}).waitFor();
      assert.equal(await submit.isDisabled(), true);
      await code.fill('// Saved while the compiler is unavailable');
      await tap(page.getByRole('button', {name:'Save draft', exact:true}));
      await page.reload();
      await bookPage(page, mission.bossPage);
      if (!await code.isVisible()) await tap(gm);
      assert.equal(await code.inputValue(), '// Saved while the compiler is unavailable');
      await page.getByText('100 / 100 HP', {exact:true}).waitFor();
    }
  }

  // Downloading either of the other worlds preserves World 2 and its previous clear.
  await page.goto(origin + '?world=typescript');
  await bookPage(page, typeQuest.bossPage);
  await tap(gm);
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.goto(origin);
  await bookPage(page, typeQuest.bossPage);
  assert.equal(await page.locator('#world-caption').textContent(), 'World 2 · TypeScript');
});
