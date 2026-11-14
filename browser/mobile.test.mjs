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
import {diamondName, diamondSolution, goblinName} from './diamond-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const {quests:[quest]} = JSON.parse(await readFile(join(project, 'data/worlds/javascript/campaign.json'), 'utf8'));
const execute = promisify(execFile);

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
  t.after(() => new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); }));
  const {port} = server.httpServer.address();
  let origin = 'http://127.0.0.1:' + port;
  let context;
  const serial = process.env.FERRUM_ANDROID_EMULATOR;
  if (serial) {
    assert.match(serial, /^emulator-\d+$/);
    const adb = process.env.FERRUM_ADB || 'adb';
    const target = args => execute(adb, ['-s', serial, ...args], {timeout:10_000});
    await target(['reverse', 'tcp:' + port, 'tcp:' + port]);
    t.after(() => target(['reverse', '--remove', 'tcp:' + port]));
    origin = 'http://localhost:' + port;
    await target(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', 'com.android.chrome']);
    const {stdout} = await target(['forward', 'tcp:0', 'localabstract:chrome_devtools_remote']);
    const debugPort = stdout.trim();
    assert.match(debugPort, /^\d+$/);
    t.after(() => target(['forward', '--remove', 'tcp:' + debugPort]));
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort, {timeout:15_000});
    [context] = browser.contexts();
    t.after(async () => {
      await context.setOffline(false).catch(() => {});
      await browser.close();
    });
  } else {
    const browser = await chromium.launch(await chromeOptions());
    t.after(() => browser.close());
    context = await browser.newContext({...devices['Pixel 7'], reducedMotion:'reduce'});
  }
  if (!serial) t.after(() => context.close());
  const page = await context.newPage();
  if (serial) t.after(() => page.close().catch(() => {}));
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
  const options = page.locator('#campaign-options');
  await options.getByRole('button', {name:'World map', exact:true}).waitFor();
  await options.getByRole('button', {name:'Download World 1', exact:true}).waitFor({state:'hidden'});
  await options.getByText('World 1 ready offline', {exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await options.waitFor({state:'hidden'});
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  await tap(more);
  await tap(book);
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

  let diamondVisible = false;
  for (let number = 1; number <= 8 && !diamondVisible; number++) {
    await jump(restored, number);
    await bookPage(restored, number);
    try {
      await restored.getByRole('button', {name:diamondName}).waitFor({timeout:350});
      diamondVisible = true;
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
    }
  }
  assert.equal(diamondVisible, true);
  await tap(restored.getByRole('button', {name:diamondName}));
  await restored.getByRole('heading', {name:goblinName}).waitFor();
  assert.equal(await restored.getByRole('tab', {name:'GM', exact:true}).getAttribute('aria-selected'), 'true');
  const fight = restored.locator('.diamond-encounter');
  await fight.getByRole('textbox', {name:'Goblin code'}).fill(diamondSolution);
  await tap(fight.getByRole('button', {name:'Submit code', exact:true}));
  await fight.getByRole('radio', {name:'values.slice()', exact:true}).check();
  await tap(fight.getByRole('button', {name:'Submit answer', exact:true}));
  await fight.getByText('Goblin defeated', {exact:true}).waitFor();
});
