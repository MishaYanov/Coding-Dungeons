import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import javascriptExercises from '../data/workbench/javascript.mjs';
import typescriptExercises from '../data/workbench/typescript.mjs';
import goExercises from '../data/workbench/go.mjs';

// This harness owns only the separately installed debug application. It never
// installs an APK, clears application data, starts Chrome, or creates a reverse.
const application = 'com.codingdungeons.app.test';
const activity = application + '/com.codingdungeons.app.MainActivity';
const origin = 'https://appassets.androidplatform.net';
const execute = promisify(execFile);
const serial = process.env.FERRUM_ANDROID_EMULATOR;
const readJson = async path => JSON.parse((await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
const [rustExercise] = await readJson('../data/exercises.json');
const worlds = [
  {id:'javascript', name:'JavaScript', number:1, reference:javascriptExercises[0].reference},
  {id:'typescript', name:'TypeScript', number:2, reference:typescriptExercises[0].reference},
  {id:'rust', name:'Rust', number:3, reference:rustExercise.solution, rejectStarter:true},
  {id:'go', name:'Go', number:4, reference:goExercises[0].reference, rejectStarter:true},
];

async function attach(t) {
  assert.match(serial, /^emulator-\d+$/, 'Set FERRUM_ANDROID_EMULATOR to one exact emulator serial.');
  assert.ok(process.env.FERRUM_ADB, 'Set FERRUM_ADB to the Android SDK adb executable.');
  const adb = (args, timeout = 10_000) => execute(process.env.FERRUM_ADB, ['-s', serial, ...args], {
    windowsHide:true, timeout, maxBuffer:128 * 1024,
  });
  let browser;
  let debugPort;
  let launched = false;
  t.after(async () => {
    const failures = [];
    // Stop this test package even when compilation or the CDP connection failed.
    // Existing release app saves, Chrome tabs, and other forwards are untouched.
    for (const clean of [
      () => launched ? adb(['shell', 'am', 'force-stop', application]) : undefined,
      () => browser?.close(),
      () => debugPort ? adb(['forward', '--remove', 'tcp:' + debugPort]) : undefined,
    ]) {
      try { await clean(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Android test application cleanup failed.');
  });

  // Explicit component prevents Android resolving this intent to another app.
  launched = true;
  const launch = await adb(['shell', 'am', 'start', '-W', '-n', activity], 30_000);
  assert.doesNotMatch(launch.stdout + launch.stderr, /Error(?: type \d+)?:|does not exist/i);
  let pid;
  const started = performance.now();
  while (performance.now() - started < 15_000) {
    const result = await adb(['shell', 'pidof', application]).catch(error => {
      if (error.code === 1) return {stdout:''};
      throw error;
    });
    if (/^[1-9]\d*$/.test(result.stdout.trim())) { pid = result.stdout.trim(); break; }
    await delay(100);
  }
  assert.ok(pid, 'The installed debug application did not start one main process.');
  const forward = await adb(['forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid]);
  debugPort = forward.stdout.trim();
  assert.match(debugPort, /^\d{1,5}$/);
  const endpoint = 'http://127.0.0.1:' + debugPort;
  let listening = false;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    listening = await fetch(endpoint + '/json/version', {signal:AbortSignal.timeout(1_000)})
      .then(async response => { await response.body?.cancel(); return response.ok; }, () => false);
    if (listening) break;
    await delay(100);
  }
  assert.ok(listening, 'The debug APK did not expose its own WebView debugger.');
  browser = await chromium.connectOverCDP(endpoint, {timeout:10_000});
  const pages = browser.contexts().flatMap(context => context.pages());
  const page = pages.find(candidate => candidate.url().startsWith(origin + '/'));
  assert.ok(page, 'The test APK did not open its packaged appassets page.');
  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(20_000);
  await page.emulateMedia({reducedMotion:'reduce'});
  return {page, context:page.context()};
}

async function bookPage(page, number) {
  const image = page.getByRole('img', {name:new RegExp('book, page ' + number + '(?: ·|$)')});
  await image.waitFor();
  await image.evaluate(image => image.decode());
  assert.equal(await image.evaluate(image => image.complete && image.naturalWidth > 0), true);
}

async function openMenu(page) {
  await page.getByRole('button', {name:'More options', exact:true}).click();
  const menu = page.getByRole('dialog', {name:'Campaign menu', exact:true});
  await menu.waitFor();
  return menu;
}

async function createHero(page, world, name) {
  await page.goto(origin + '/?world=' + world.id);
  // The compact phone header intentionally hides this caption.
  await page.getByText(`World ${world.number} · ${world.name}`, {exact:true}).first().waitFor({state:'attached'});
  await page.locator('#hero-name:visible, #page-frame:not([hidden]) img').first().waitFor();
  const picker = page.getByRole('dialog', {name:'Choose your hero', exact:true});
  if (!await picker.isVisible()) {
    await (await openMenu(page)).getByRole('button', {name:'Switch hero', exact:true}).click();
  }
  await picker.getByLabel('Hero name', {exact:true}).fill(name);
  await picker.getByRole('checkbox', {name:'One Life', exact:true}).check();
  await picker.getByRole('button', {name:'Create hero', exact:true}).click();
  await picker.waitFor({state:'hidden'});
  await bookPage(page, 1);
  const menu = await openMenu(page);
  await menu.getByText(`World ${world.number} included offline`, {exact:true}).waitFor();
  assert.equal(await page.getByRole('button', {name:/^Download World \d+$/}).count(), 0);
  await menu.getByRole('button', {name:'Close campaign menu', exact:true}).click();
}

async function clearFirstBoss(t, page, world, runId) {
  const started = performance.now();
  await createHero(page, world, `Android ${world.name} ${runId}`);
  const campaign = await readJson(world.id === 'rust' ? '../data/campaign.json'
    : `../data/worlds/${world.id}/campaign.json`);
  const {bossPage} = campaign.quests.find(quest => quest.level === 1);
  const number = page.locator('#page-number:visible');
  await number.fill(String(bossPage));
  await number.press('Enter');
  await bookPage(page, bossPage);
  await page.getByRole('tab', {name:'GM', exact:true}).click();
  await page.getByText(world.name + ' runner ready', {exact:true}).waitFor({timeout:60_000});
  const code = page.getByRole('textbox', {name:world.name + ' code', exact:true});
  const submit = page.getByRole('button', {name:'Submit solution', exact:true});
  await page.getByText('100 / 100 HP', {exact:true}).waitFor();
  if (world.rejectStarter) {
    assert.ok((await code.inputValue()).trim(), world.name + ' must provide an authored starter.');
    await submit.click();
    await page.getByText('95 / 100 HP', {exact:true}).waitFor({timeout:60_000});
    assert.equal(await page.locator('.creature-encounter[data-state="defeated"]').count(), 0);
  }
  const hp = world.rejectStarter ? '95 / 100 HP' : '100 / 100 HP';
  await code.fill(world.reference);
  await page.getByRole('button', {name:'Run Examples', exact:true}).click();
  await page.getByText('Examples passed', {exact:true}).waitFor({timeout:60_000});
  await page.locator('.creature-encounter[data-state="ready"]').waitFor();
  await page.getByText(hp, {exact:true}).waitFor();
  await submit.click();
  await page.getByText('Tests passed', {exact:true}).waitFor({timeout:60_000});
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByText(hp, {exact:true}).waitFor();

  await page.reload();
  await bookPage(page, bossPage);
  await page.getByRole('tab', {name:'GM', exact:true}).click();
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByText(hp, {exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox', {name:world.name + ' code', exact:true}).inputValue(), world.reference);
  t.diagnostic(`${world.name}: packaged book, examples, full clear and persisted reload passed in ${Math.round(performance.now() - started)} ms.`);
}

async function checkBoundary(page) {
  assert.deepEqual(await page.evaluate(() => ({
    origin:location.origin, bridge:typeof globalThis.dungeonsSave,
    postMessage:typeof globalThis.dungeonsSave?.postMessage,
    require:typeof globalThis.require, process:typeof globalThis.process,
  })), {origin, bridge:'object', postMessage:'function', require:'undefined', process:'undefined'});
  const missing = await page.evaluate(async () => {
    const response = await fetch('/__android_test_missing_asset__.txt');
    await response.arrayBuffer();
    return response.status;
  });
  assert.equal(missing, 404, 'Unknown packaged assets must return 404.');
  const session = await page.context().newCDPSession(page);
  try {
    const evaluateWithoutGesture = async expression => {
      const result = await session.send('Runtime.evaluate', {
        expression, userGesture:false, awaitPromise:true, returnByValue:true,
      });
      assert.equal(result.exceptionDetails, undefined);
      return result.result.value;
    };
    // Prior UI clicks and Playwright evaluate can activate a real user gesture.
    // Let it expire before testing that scripted navigation cannot launch apps.
    const deadline = performance.now() + 7_000;
    while (await evaluateWithoutGesture('Boolean(navigator.userActivation?.isActive)')) {
      assert.ok(performance.now() < deadline, 'The previous UI gesture did not expire.');
      await delay(100);
    }
    for (const url of ['https://blocked.invalid/android-test', 'http://127.0.0.1:9/android-test',
      'file:///data/local/tmp/coding-dungeons-test.txt']) {
      const result = await evaluateWithoutGesture(`(async () => {
        try {
          const response = await fetch(${JSON.stringify(url)}, {signal:AbortSignal.timeout(5_000)});
          await response.arrayBuffer();
          return {status:response.status};
        } catch (error) { return {error:error.name}; }
      })()`);
      assert.ok(result.status === 403 || ['TypeError', 'SecurityError'].includes(result.error),
        'The WebView must deny outside requests: ' + JSON.stringify(result));
      const before = page.url();
      // Playwright evaluate supplies a user gesture. Use the explicit CDP flag
      // so this probe cannot be mistaken for a request to open an external app.
      await evaluateWithoutGesture(`location.assign(${JSON.stringify(url)})`);
      await delay(250);
      assert.equal(page.url(), before, 'A scripted outside navigation must leave the game in its own origin.');
    }
  } finally {
    await session.detach();
  }
}

test('the installed Android test APK plays all four worlds offline and confines its WebView', {
  skip:!serial && 'Set FERRUM_ANDROID_EMULATOR and FERRUM_ADB after installing the debug APK.',
  timeout:180_000,
}, async t => {
  const {page, context} = await attach(t);
  const requests = [];
  const errors = [];
  const onRequest = request => requests.push(request.url());
  context.on('request', onRequest);
  page.on('pageerror', error => errors.push(error.message));
  const runId = Date.now().toString(36);
  for (const world of worlds) await clearFirstBoss(t, page, world, runId);
  context.off('request', onRequest);
  assert.deepEqual(errors, [], 'The packaged game must not emit uncaught page errors.');
  const http = requests.filter(url => /^https?:/.test(url)).map(url => new URL(url));
  assert.ok(http.some(url => url.pathname.startsWith('/book/')), 'The APK must load its own book pages.');
  assert.deepEqual(http.filter(url => url.origin !== origin).map(String), [], 'Gameplay must not request outside servers.');
  assert.deepEqual(http.filter(url => url.pathname.startsWith('/api/')).map(String), [], 'The APK must use the local mobile engine.');
  await checkBoundary(page);
});
