import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { assertDiamondWithinPage, diamondName, diamondPages, diamondSolution, goblinName } from './diamond-fixture.mjs';
import {sideQuestRoutes} from '../lib/side-quests.mjs';

const project = new URL('../', import.meta.url);
const pages = JSON.parse(await readFile(new URL('data/pages.json', project), 'utf8'));
const writtenPage = pages.find(page => page.prompts.some(prompt => prompt.id === 'training-1-3'));
const notesPage = pages.find(page => page.page > 1 && page.prompts.some(prompt => prompt.id === 'notes')
  && pages[page.page]?.prompts.some(prompt => prompt.id === 'notes'));
assert.ok(writtenPage, 'The reviewed training response remains in the Rust book');
assert.ok(notesPage, 'The Rust reader has adjacent notebook pages for navigation checks');
const nextNotesPage = pages[notesPage.page];
const notesHotspot = nextNotesPage.links.find(link => link.page && link.page !== nextNotesPage.page);
assert.ok(notesHotspot, 'The notebook page has an authored internal book link');
let app;
let browser;
let scratch;
let origin;

async function startServer() {
  scratch = await mkdtemp(join(tmpdir(), 'ferrum-browser-'));
  app = spawn(process.execPath, ['server.mjs'], {
    cwd: project,
    env: { ...process.env, PORT: '0', FERRUM_DB: join(scratch, 'browser.sqlite'),
      DUNGEONS_NATIVE_RUNNER_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const deadline = setTimeout(() => reject(new Error(`App startup timed out\n${output}`)), 10000);
    const onExit = (code) => {
      clearTimeout(deadline);
      reject(new Error(`App exited with ${code}\n${output}`));
    };
    app.once('exit', onExit);
    app.stderr.on('data', (chunk) => { output += chunk; });
    app.stdout.on('data', (chunk) => {
      output += chunk;
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) {
        clearTimeout(deadline);
        app.off('exit', onExit);
        resolve(address);
      }
    });
  });
}

async function browserOptions() {
  if (process.env.FERRUM_BROWSER) return { executablePath: process.env.FERRUM_BROWSER };
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of roots) {
      for (const file of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
        const candidate = join(root, file);
        if (await access(candidate).then(() => true, () => false)) return { executablePath: candidate };
      }
    }
  }
  return {};
}

before(async () => {
  origin = await startServer();
  browser = await chromium.launch(await browserOptions());
});

after(async () => {
  await browser?.close();
  if (app && app.exitCode === null && app.signalCode === null) {
    const closed = once(app, 'close');
    app.kill();
    await closed;
  }
  if (scratch) {
    for (const database of ['browser.sqlite', 'browser.javascript.sqlite', 'browser.typescript.sqlite', 'browser.csharp.sqlite', 'browser.go.sqlite']) {
      for (const suffix of ['', '-wal', '-shm']) {
        await unlink(join(scratch, `${database}${suffix}`)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
    await rmdir(scratch);
  }
});

async function newPage(t, suffix, world = 'rust') {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const query = world ? `?world=${world}` : '';
  await page.goto(`${origin}/${query}${suffix}`);
  await page.getByRole('dialog', { name: world || suffix ? 'Choose your hero' : 'Choose a world' }).waitFor();
  return page;
}

async function openBookPage(page, number) {
  await page.locator('#page-frame:not([hidden]) img').and(page.getByRole('img', {
    name: new RegExp(`book, page ${number}(?: ·|$)`),
  })).waitFor();
  assert.equal(new URL(page.url()).hash, `#page=${number}`);
  assert.equal(await page.locator('#page-number').inputValue(), String(number));
}

async function createHero(page, name, number) {
  await page.getByLabel('Hero name').fill(name);
  await page.getByRole('button', { name: 'Create hero' }).click();
  await openBookPage(page, number);
}

async function jumpTo(page, number) {
  const input = page.locator('#page-number');
  await input.fill(String(number));
  await input.press('Enter');
  await openBookPage(page, number);
}

async function indentWithTab(editor, start, end, expected) {
  await editor.focus();
  await editor.evaluate((field, [start, end]) => field.setSelectionRange(start, end), [start, end]);
  await editor.press('Tab');
  const state = await editor.evaluate((field) => new Promise((resolve) => requestAnimationFrame(() => resolve({
    focused: document.activeElement === field,
    value: field.value,
    selection: [field.selectionStart, field.selectionEnd],
  }))));
  assert.deepEqual(state, { focused: true, value: expected, selection: [start + 4, start + 4] });
}

test('the written GM explains its mushroom-juice reviews in an accessible tooltip', async (t) => {
  const page = await newPage(t, `#page=${writtenPage.page}`);
  await createHero(page, 'Mushroom Cup Witness', writtenPage.page);
  const prompt = page.locator('.prompt-form').filter({ has: page.getByRole('heading', { name: 'Training encounter 3', exact: true }) });
  await prompt.getByText(/The GM drank too much mushroom juice/).waitFor();
  const help = prompt.getByRole('button', { name: 'Why the GM can make mistakes' });
  const tooltip = prompt.getByRole('tooltip');
  assert.equal(await help.getAttribute('type'), 'button');
  await help.hover();
  await tooltip.waitFor({ state: 'visible' });
  assert.match(await tooltip.innerText(), /offline language model/);
  await tooltip.hover();
  await page.keyboard.press('Escape');
  await tooltip.waitFor({ state: 'hidden' });

  await help.focus();
  await tooltip.waitFor({ state: 'visible' });
  await help.press('Escape');
  await tooltip.waitFor({ state: 'hidden' });
  await help.press('Enter');
  await tooltip.waitFor({ state: 'visible' });
  assert.equal(await prompt.getByText('Response saved', { exact: true }).count(), 0);
  assert.equal(new URL(page.url()).hash, `#page=${writtenPage.page}`);
});

test('the JavaScript world map opens the Relay Ledger refactoring path', async (t) => {
  const page = await newPage(t, '#page=1', 'javascript');
  await createHero(page, 'Ledger Apprentice', 1);
  await page.getByRole('button', {name:'World map', exact:true}).click();
  const map = page.getByRole('dialog', {name:'World map', exact:true});
  await map.getByRole('link', {name:'Refactoring Quest · The Relay Ledger', exact:true}).click();
  await openBookPage(page, 47);
  const quest = page.getByRole('region', {name:'Refactoring Quest · The Relay Ledger'});
  await quest.getByText('0 / 4 steps complete').waitFor();
  await quest.getByText('Original system code', {exact:true}).click();
  await quest.locator('pre').waitFor({state:'visible'});
  assert.equal(await quest.getByRole('list', {name:'Refactoring quest steps'}).getByRole('listitem').count(), 4);
});

test('the JavaScript World Map opens the URL shortener design quest', async (t) => {
  const page = await newPage(t, '#page=1', 'javascript');
  await createHero(page, 'Short Link Architect', 1);
  await page.getByRole('button', {name:'World map', exact:true}).click();
  const map = page.getByRole('dialog', {name:'World map', exact:true});
  await map.getByRole('link', {name:'Refactoring Quest · The Relay Ledger', exact:true}).waitFor();
  await map.getByRole('link', {name:'System Design Quest · Design a URL Shortener', exact:true}).click();
  await openBookPage(page, 43);
  const quest = page.getByRole('region', {name:'System Design Quest · Design a URL Shortener'});
  await quest.getByText('0 / 5 steps complete', {exact:true}).waitFor();
  await quest.getByText(/864,000 create requests/).waitFor();
  assert.equal(await quest.getByRole('list', {name:'System design quest steps'}).getByRole('listitem').count(), 5);
  assert.equal(await quest.getByText('Worked design', {exact:true}).count(), 0);
});

test('the JavaScript World Map opens the rate limiter design quest', async (t) => {
  const page = await newPage(t, '#page=1', 'javascript');
  await createHero(page, 'Rate Limit Architect', 1);
  await page.getByRole('button', {name:'World map', exact:true}).click();
  const map = page.getByRole('dialog', {name:'World map', exact:true});
  await map.getByRole('link', {name:'System Design Quest · Design a URL Shortener', exact:true}).waitFor();
  await map.getByRole('link', {name:'System Design Quest · Design a Rate Limiter', exact:true}).click();
  await openBookPage(page, 39);
  const quest = page.getByRole('region', {name:'System Design Quest · Design a Rate Limiter'});
  await quest.getByText('0 / 5 steps complete', {exact:true}).waitFor();
  assert.equal(await quest.getByRole('list', {name:'System design quest steps'}).getByRole('listitem').count(), 5);
  assert.equal(await quest.getByText('Worked design', {exact:true}).count(), 0);
});

test('the TypeScript and Go World Maps open language-specific side quests', async t => {
  for (const [world, title, firstAnswer, target, editor] of [
    ['typescript', 'The Harbor Signal Board', /Accept unknown at the gate/, 44, 'TypeScript side quest code'],
    ['go', 'Recall at the Relay', /report one confirmation/, 48, 'Go side quest code'],
  ]) {
    const page = await newPage(t, '#page=1', world);
    await createHero(page, `Side Quest Scout ${world}`, 1);
    await page.getByRole('button', {name:'World map', exact:true}).click();
    await page.getByRole('dialog', {name:'World map', exact:true}).getByRole('link', {name:title, exact:true}).click();
    await openBookPage(page, target);
    const quest = page.getByRole('region', {name:title, exact:true});
    await quest.getByText('0 / 4 steps complete', {exact:true}).waitFor();
    await quest.getByRole('radio', {name:firstAnswer}).check();
    await quest.getByRole('button', {name:'Check answer', exact:true}).click();
    await quest.getByText('1 / 4 steps complete', {exact:true}).waitFor();
    const code = quest.getByRole('textbox', {name:editor, exact:true});
    await code.waitFor();
    if (world === 'go') {
      await quest.getByText(/You can keep editing your draft/).waitFor();
      assert.equal(await quest.getByRole('button', {name:'Submit solution', exact:true}).isDisabled(), true);
    }
    const draft = (await code.inputValue()) + '\n// Remember the patrol route.';
    await code.fill(draft);
    await page.reload();
    await openBookPage(page, target);
    await code.waitFor();
    assert.equal(await code.inputValue(), draft);
  }
});

test('the Rust and Go World Maps open the runaway repair story and persist its code draft', async t => {
  for (const world of ['rust', 'go']) {
    const endpoint = `/api/rogue-${world}`;
    const {catalog} = sideQuestRoutes.get(endpoint);
    const page = await newPage(t, '#page=1', world);
    await createHero(page, `Midnight Scout ${world}`, 1);
    const campaign = await page.evaluate(async world => (await fetch('/api/campaign', {
      headers:{'x-ferrum-world':world},
    })).json(), world);
    const target = campaign.sideQuests.find(quest => quest.slug === `rogue-${world}`).page;
    await page.getByRole('button', {name:'World map', exact:true}).click();
    await page.getByRole('dialog', {name:'World map', exact:true}).getByRole('link', {name:catalog.title, exact:true}).click();
    await openBookPage(page, target);
    const quest = page.getByRole('region', {name:catalog.title, exact:true});
    await quest.getByText(`0 / ${catalog.stages.length} steps complete`, {exact:true}).waitFor();
    await quest.getByText('Original system code', {exact:true}).click();
    await quest.locator('pre').waitFor({state:'visible'});
    const first = catalog.stages[0];
    const answer = first.options.find(option => option.id === first.answer).label;
    await quest.getByRole('radio', {name:answer, exact:true}).check();
    await quest.getByRole('button', {name:'Check answer', exact:true}).click();
    await quest.getByText(`1 / ${catalog.stages.length} steps complete`, {exact:true}).waitFor();
    const editor = quest.getByRole('textbox', {name:`${world === 'rust' ? 'Rust' : 'Go'} side quest code`, exact:true});
    await editor.waitFor();
    await quest.getByText(/You can keep editing your draft/).waitFor();
    assert.equal(await quest.getByRole('button', {name:'Submit solution', exact:true}).isDisabled(), true);
    const draft = `${await editor.inputValue()}\n// Midnight repair checkpoint.`;
    await editor.fill(draft);
    await page.reload();
    await openBookPage(page, target);
    await editor.waitFor();
    assert.equal(await editor.inputValue(), draft);
    await quest.getByText(`1 / ${catalog.stages.length} steps complete`, {exact:true}).waitFor();
  }
});

test('page shortcuts follow focus, preserve typed A/D, and ignore open dialogs', async (t) => {
  const page = await newPage(t, '');
  await createHero(page, 'Keyboard Warden', 1);
  await jumpTo(page, notesPage.page);
  await page.locator('#reader-viewport').focus();
  await page.keyboard.press('d');
  await openBookPage(page, nextNotesPage.page);
  await page.keyboard.press('a');
  await openBookPage(page, notesPage.page);
  const note = page.getByRole('textbox', { name: 'Your written response' }).first();
  await note.focus();
  await note.press('a');
  await note.press('d');
  assert.equal(await note.inputValue(), 'ad');
  await note.press('Tab');
  assert.equal(await note.evaluate((field) => document.activeElement === field), false);
  assert.equal(await note.inputValue(), 'ad');
  await openBookPage(page, notesPage.page);
  await page.getByRole('button', { name: 'World map' }).click();
  await page.getByRole('dialog', { name: 'World map' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Close world map' }).click();
  await openBookPage(page, notesPage.page);
  await page.locator('#reader-viewport').focus();
  await page.keyboard.press('ArrowRight');
  await openBookPage(page, nextNotesPage.page);
  await page.locator(`#page-hotspots a[href="#page=${notesHotspot.page}"]`).first().click();
  await openBookPage(page, notesHotspot.page);
});

test('reader navigation moves to the header and bottom bar at the phone breakpoint', async t => {
  const page = await newPage(t, '', 'javascript');
  await createHero(page, 'Layout Scout', 1);
  const header = page.getByRole('banner');
  const pages = page.getByRole('navigation', {name:'Book pages', exact:true});
  await header.getByRole('button', {name:'Worlds', exact:true}).waitFor();
  assert.equal(await pages.count(), 0);

  await page.setViewportSize({width:800, height:800});
  const world = header.getByRole('tab', {name:'World', exact:true});
  const gm = header.getByRole('tab', {name:'GM', exact:true});
  await world.waitFor();
  await pages.getByRole('button', {name:'Next page', exact:true}).click();
  await openBookPage(page, 2);
  await world.focus();
  await world.press('ArrowRight');
  assert.equal(await gm.getAttribute('aria-selected'), 'true');
  assert.equal(new URL(page.url()).hash, '#page=2');

  await page.setViewportSize({width:801, height:800});
  await header.getByRole('button', {name:'Worlds', exact:true}).waitFor();
  assert.equal(await pages.count(), 0);
  await openBookPage(page, 2);
});

test('hero deletion can be canceled, and confirmed deletion survives reload', async (t) => {
  const page = await newPage(t, '');
  await createHero(page, 'Keeper of the Archive', 1);
  await jumpTo(page, notesPage.page);
  await page.getByRole('button', {name: 'Switch hero', exact: true}).click();
  await createHero(page, 'Discarded Expedition', 1);
  await page.getByRole('button', {name: 'Switch hero', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Choose your hero'});
  const remove = picker.getByRole('button', {name: 'Delete hero Discarded Expedition', exact: true});
  await remove.click();
  const confirmation = page.getByRole('dialog', {name: 'Delete hero?'});
  await confirmation.getByText('Discarded Expedition', {exact: true}).waitFor();
  await confirmation.getByRole('button', {name: 'Cancel', exact: true}).click();
  await confirmation.waitFor({state: 'hidden'});
  assert.equal(await remove.count(), 1);

  await remove.click();
  await confirmation.getByRole('button', {name: 'Delete hero', exact: true}).click();
  await picker.getByText('Deleted Discarded Expedition.', {exact: true}).waitFor();
  assert.equal(await remove.count(), 0);
  assert.equal(await page.locator('#header-callsign').textContent(), 'Explorer');
  await page.reload();
  await picker.getByRole('button', {name: /^Keeper of the Archive/}).waitFor();
  assert.equal(await remove.count(), 0);
  await picker.getByRole('button', {name: /^Keeper of the Archive/}).click();
  await openBookPage(page, notesPage.page);
});

test('a hero switch preserves the outgoing page and restores the right answer in a fresh context', async (t) => {
  const checkpoint = pages.find((page) => page.prompts.some((prompt) => prompt.id === 'checkpoint-1'));
  const choice = checkpoint.prompts.find((prompt) => prompt.id === 'checkpoint-1');
  const correctLabel = choice.options.find((entry) => entry.id === choice.correctOption).text;
  const page = await newPage(t, '');
  await createHero(page, 'Choice Scout', 1);
  await jumpTo(page, checkpoint.page);
  const option = page.getByRole('radio', { name: correctLabel });
  await option.check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.getByText('Saved to your quest log', { exact: true }).waitFor();
  await page.locator('#reader-viewport').focus();
  await page.keyboard.press('d');
  await openBookPage(page, checkpoint.page + 1);
  await page.getByRole('button', { name: 'Switch hero' }).click();
  await createHero(page, 'Other Scout', 1);

  const fresh = await newPage(t, '');
  await fresh.getByRole('button', { name: /^Choice Scout/ }).click();
  await openBookPage(fresh, checkpoint.page + 1);
  await fresh.keyboard.press('a');
  await openBookPage(fresh, checkpoint.page);
  const selected = fresh.getByRole('radio', { name: correctLabel });
  assert.equal(await selected.isChecked(), true);
});

test('an offline runner leaves the Rust editor available and saves Tab indentation to SQLite', async (t) => {
  const gradedPage = pages.find((page) => page.prompts.some((prompt) => prompt.exerciseId));
  const page = await newPage(t, '');
  await createHero(page, 'Forge Apprentice', 1);
  await jumpTo(page, gradedPage.page);
  const run = page.getByRole('button', { name: 'Submit solution' });
  assert.equal(await run.isDisabled(), true);
  const exercise = gradedPage.prompts.find((prompt) => prompt.exerciseId);
  const card = page.getByRole('form', { name: exercise.title, exact: true });
  const editor = card.getByRole('textbox', { name: 'Rust code' });
  const line = '// A saved attempt\n';
  const source = `${line}    fn draft() {}`;
  await editor.fill(`${line}fn draft() {}`);
  await indentWithTab(editor, line.length, line.length, source);
  await editor.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await editor.evaluate((field) => document.activeElement === field), false);
  await card.getByRole('button', { name: 'Save draft' }).click();
  await card.getByText('Draft saved', { exact: true }).waitFor();
  const saved = await page.request.get(`${origin}/api/progress`);
  assert.ok(saved.ok());
  const status = await saved.json();
  assert.ok(status.responses.some((answer) => answer.promptId === exercise.id && answer.value === source));
  await page.reload();
  await openBookPage(page, gradedPage.page);
  assert.equal(await editor.inputValue(), source);
});

test('a delayed save cannot erase a newer draft after revisiting its page', { timeout: 15000 }, async (t) => {
  const page = await newPage(t, '');
  await createHero(page, 'Careful Scribe', 1);
  await jumpTo(page, notesPage.page);
  const saved = Promise.withResolvers();
  const deliver = Promise.withResolvers();
  await page.route('**/api/answers', async (route) => {
    const response = await route.fetch();
    saved.resolve();
    await deliver.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  t.after(() => deliver.resolve());

  const note = page.getByRole('textbox', { name: 'Your written response' }).first();
  await note.fill('submitted version');
  await page.getByRole('button', { name: 'Submit response' }).first().click();
  await saved.promise;
  await jumpTo(page, nextNotesPage.page);
  await jumpTo(page, notesPage.page);
  await note.fill('newer draft');

  const reply = page.waitForResponse('**/api/answers');
  deliver.resolve();
  await (await reply).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.reload();
  await openBookPage(page, notesPage.page);
  assert.equal(await note.inputValue(), 'newer draft');
});

test('the home page offers all five worlds after playing as a Rust hero in the same tab', async (t) => {
  const page = await newPage(t, '', 'rust');
  await createHero(page, 'Home Page Scout', 1);

  await page.goto(`${origin}/`);
  const picker = page.getByRole('dialog', { name: 'Choose a world' });
  await picker.waitFor();
  await picker.getByRole('link', { name: /World 1 JavaScript/ }).waitFor();
  await picker.getByRole('link', { name: /World 2 TypeScript/ }).waitFor();
  await picker.getByRole('link', { name: /World 3 C# and \.NET/ }).waitFor();
  await picker.getByRole('link', { name: /World 4 Rust/ }).waitFor();
  await picker.getByRole('link', { name: /World 5 Go/ }).waitFor();
});

test('world selection opens separate books and restores the right hero and draft', async (t) => {
  const page = await newPage(t, '', null);
  const pick = async (label) => page.getByRole('link', { name: label }).click();
  await pick(/World 1 JavaScript/);
  await page.getByRole('dialog', { name: 'Choose your hero' }).waitFor();
  const js = JSON.parse(await readFile(new URL('data/worlds/javascript/campaign.json', project), 'utf8'));
  await page.locator('#hero-path').selectOption(js.paths[0].id);
  await createHero(page, 'World Scout', 1);
  assert.match(await page.locator('#world-caption').textContent(), /World 1 · JavaScript/);
  const encounter = js.quests[0].bossPage;
  await jumpTo(page, encounter);
  const source = '// My JavaScript draft';
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await editor.fill(source);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText('Draft saved', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Scouted' }).check();
  await page.getByText('Quest log updated', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Worlds', exact: true }).click();
  await pick(/World 2 TypeScript/);
  const typescriptHeroes = page.getByRole('dialog', {name:'Choose your hero'});
  await typescriptHeroes.waitFor();
  await typescriptHeroes.getByText('Loading saved heroes…', {exact:true}).waitFor({state:'hidden'});
  assert.equal(await typescriptHeroes.locator('.hero-slot').filter({hasText:'World Scout'}).count(), 0);
  await createHero(page, 'World Scout', 1);
  assert.match(await page.locator('#book-page').getAttribute('src'), /\/book\/typescript\/pages\/1\.webp/);
  await page.getByRole('button', { name: 'Worlds', exact: true }).click();
  await pick(/World 1 JavaScript/);
  await openBookPage(page, encounter);
  assert.equal(await editor.inputValue(), source);
  assert.equal(await page.getByRole('checkbox', { name: 'Scouted' }).isChecked(), true);
});

test('the active path continues in its authored order and keeps alternate exits available', async t => {
  const page = await newPage(t, '', 'typescript');
  const campaign = JSON.parse(await readFile(new URL('data/worlds/typescript/campaign.json', project), 'utf8'));
  const byLevel = level => campaign.quests.find(quest => quest.level === level);
  await page.locator('#hero-path').selectOption('contract-engineer');
  await createHero(page, 'Harbor Contract Engineer', 1);
  await jumpTo(page, byLevel(3).sidePage);

  const next = page.getByRole('link', {name:'Continue on Contract Engineer · Level 8', exact:true});
  await next.waitFor();
  assert.equal(await next.getAttribute('href'), '#page=' + byLevel(8).page);
  const alternate = page.locator('.route-links').getByRole('link', {name:/Continue · Level 4/});
  assert.equal(await alternate.getAttribute('href'), '#page=' + byLevel(4).page);
  await next.click();
  await openBookPage(page, byLevel(8).page);
  await page.getByRole('link', {name:'Continue on Contract Engineer · Level 9', exact:true}).waitFor();
  await jumpTo(page, byLevel(14).page);
  await page.getByRole('link', {name:/Continue on Contract Engineer/}).waitFor({state:'hidden'});
});

test('Rust path background detours open manuals and preserve the chosen expedition', async t => {
  const page = await newPage(t, '', 'rust');
  const campaign = JSON.parse(await readFile(new URL('data/campaign.json', project), 'utf8'));
  const quest = level => campaign.quests.find(quest => quest.level === level);
  const path = campaign.paths.find(path => path.id === 'architect');
  const originQuest = quest(18);
  const target = quest(33);
  assert.equal(path.levels[path.levels.indexOf(originQuest.level) + 1], target.level);
  await page.locator('#hero-path').selectOption(path.id);
  await createHero(page, 'Architect Background Scout', 1);
  await jumpTo(page, originQuest.sidePage);

  const background = page.locator(`details[aria-label="Background for Level ${target.level}"]`);
  await background.locator('summary').click();
  const expected = target.loadout.map(quest);
  const label = quest => `Level ${quest.level} · ${quest.topic ?? quest.mission_title}`;
  const links = background.getByRole('link');
  assert.deepEqual((await links.allTextContents()).map(text => text.trim()), expected.map(label));
  for (const entry of expected) {
    assert.equal(await background.getByRole('link', {name:label(entry), exact:true}).getAttribute('href'),
      '#page=' + entry.manualPage);
  }
  await background.getByRole('link', {name:label(quest(29)), exact:true}).click();
  await openBookPage(page, quest(29).manualPage);

  await jumpTo(page, originQuest.sidePage);
  const next = page.getByRole('link', {name:`Continue on ${path.name} · Level ${target.level}`, exact:true});
  await next.waitFor();
  assert.equal(await next.getAttribute('href'), '#page=' + target.page);
  await next.click();
  await openBookPage(page, target.page);
  // The same catch-up remains available at the destination's entry briefing.
  await background.locator('summary').click();
  await background.getByRole('link', {name:label(quest(29)), exact:true}).waitFor();
  await page.getByRole('button', {name:'Edit explorer profile', exact:true}).click();
  await page.getByRole('dialog', {name:'Set your loadout', exact:true}).waitFor();
  assert.equal(await page.locator('#path-input').inputValue(), path.id);
  await page.getByRole('button', {name:'Close profile', exact:true}).click();
});

test('Go beginner checkpoints update the character sheet and survive a reload', async (t) => {
  const page = await newPage(t, '', null);
  await page.getByRole('link', { name: /World 5 Go/ }).click();
  await page.getByRole('dialog', { name: 'Choose your hero' }).waitFor();
  const go = JSON.parse(await readFile(new URL('data/worlds/go/campaign.json', project), 'utf8'));
  const beginner = go.paths[0];
  await page.locator('#hero-path').selectOption(beginner.id);
  await page.locator('#hero-path-description').getByText(beginner.description).waitFor();
  await createHero(page, 'Gopher Scout', 1);
  assert.match(await page.locator('#book-page').getAttribute('src'), /\/book\/go\/pages\/1\.webp/);
  await page.getByRole('button', { name: 'World map' }).click();
  assert.equal(await page.getByRole('link', { name: 'Download field kit' }).getAttribute('href'), '/book/go/field-kit.zip');
  await page.getByRole('button', { name: 'Close world map' }).click();

  for (const quest of go.quests.slice(0, 2)) {
    await jumpTo(page, quest.bossPage);
    const editor = page.getByRole('textbox', { name: 'Go code' });
    await editor.fill(`// Keep this Go draft ${quest.level}`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByText('Draft saved', { exact: true }).waitFor();
    assert.equal(await page.locator('.recommendation').count(), 0);
    for (const name of ['Scouted', 'Explained']) {
      const saved = page.waitForResponse((response) =>
        response.url().endsWith(`/api/progress/${quest.level}`) && response.request().method() === 'PATCH');
      await page.getByRole('checkbox', { name, exact: true }).check();
      assert.equal((await saved).status(), 200);
    }
  }

  await page.reload();
  await openBookPage(page, go.quests[1].bossPage);
  await page.getByRole('button', { name: 'Character sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Character sheet' });
  await sheet.getByRole('heading', { name: 'Gopher Scout' }).waitFor();
  await sheet.getByText('Hero level 1 / 10', { exact: true }).waitFor();
  await sheet.getByText('World: 0 of 14 levels complete', { exact: true }).waitFor();
  await sheet.getByText(`Active path: 0 of ${beginner.levels.length} levels complete`, { exact: true }).waitFor();
  const skill = sheet.getByRole('listitem').filter({ hasText: go.zones[0].skill });
  assert.equal(await skill.getByRole('progressbar').getAttribute('value'), '4');
  assert.equal(await sheet.getByRole('progressbar', { name: 'World experience' }).getAttribute('value'), '4');
  await sheet.getByRole('link', { name: `Level 1 · ${go.quests[0].mission_title}` }).click();
  await openBookPage(page, go.quests[0].page);
  await jumpTo(page, go.quests[0].bossPage);
  assert.equal(await page.getByRole('textbox', { name: 'Go code' }).inputValue(), '// Keep this Go draft 1');
});

test('C# starts a beginner hero and keeps a notebook and Forge review after reload', async t => {
  const page = await newPage(t, '', null);
  await page.getByRole('link', {name:/World 3 C# and \.NET/}).click();
  const campaign = JSON.parse(await readFile(new URL('data/worlds/csharp/campaign.json', project), 'utf8'));
  await page.locator('#hero-path').selectOption(campaign.paths[0].id);
  await createHero(page, 'Lantern Apprentice', 1);
  const {bossPage} = campaign.quests[0];
  await jumpTo(page, bossPage);
  await page.getByText('Guided practice', {exact:true}).waitFor();
  const review = page.getByRole('checkbox', {name:'Forge self-review', exact:true});
  const editor = page.getByRole('textbox', {name:'C# code', exact:true});
  assert.equal(await page.getByRole('button', {name:'Run Examples', exact:true}).count(), 0);
  const draft = 'Console.WriteLine("Workshop ready");';
  await editor.fill(draft);
  await page.getByRole('button', {name:'Save code draft', exact:true}).click();
  await page.getByText('Draft saved', {exact:true}).waitFor();
  await review.check();
  await page.getByText('Quest log updated', {exact:true}).waitFor();
  await page.reload();
  await openBookPage(page, bossPage);
  assert.equal(await editor.inputValue(), draft);
  assert.ok(await review.isChecked());
});

test('the C# hidden diamond opens a two-question goblin and funds the merchant', async t => {
  const page = await newPage(t, '', 'csharp');
  await createHero(page, 'Lantern Delver', 1);
  const discovery = (await diamondPages(page, 8, 'csharp')).find(({sparkle}) => Boolean(sparkle));
  assert.ok(discovery);
  await jumpTo(page, discovery.number);
  await page.getByRole('button', {name:diamondName}).click();
  const fight = page.locator('.diamond-encounter');
  await fight.getByRole('heading', {name:'Read the sack lock', exact:true}).waitFor();
  assert.equal(await fight.getByRole('textbox').count(), 0);
  await fight.getByRole('radio', {name:'3', exact:true}).check();
  await fight.getByRole('button', {name:'Submit answer', exact:true}).click();
  await fight.getByRole('heading', {name:'Answer the goblin’s riddle', exact:true}).waitFor();
  await fight.getByRole('radio', {name:'counts.TryGetValue(key, out int count)', exact:true}).check();
  await fight.getByRole('button', {name:'Submit answer', exact:true}).click();
  await fight.getByText('Goblin defeated', {exact:true}).waitFor();
  await page.getByRole('button', {name:'Visit merchant', exact:true}).click();
  const shop = page.getByRole('dialog', {name:'Diamond merchant'});
  await shop.getByText('3 diamonds available', {exact:true}).waitFor();
  await shop.getByRole('button', {name:'Buy Vault Key · 2 diamonds', exact:true}).click();
  await shop.getByText('1 diamond available', {exact:true}).waitFor();
});

test('an unavailable Go sandbox keeps the creature standing and the draft available', async (t) => {
  const page = await newPage(t, '', 'go');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { quests: [quest] } = JSON.parse(await readFile(new URL('data/worlds/go/campaign.json', project), 'utf8'));
  await createHero(page, 'Creature Hunter', 1);
  await jumpTo(page, quest.manualPage);
  assert.equal(await page.locator('.creature-encounter').count(), 0);

  await jumpTo(page, quest.bossPage);
  const ready = page.locator('.creature-encounter[data-state="ready"]');
  await ready.locator('canvas').waitFor();
  assert.equal(await page.getByRole('checkbox', {name:'Forge self-review'}).count(), 0);
  assert.equal(await page.getByRole('button', {name:'Submit solution'}).isDisabled(), true);
  const code = 'package main\nfunc badge(raw string) string { return raw }';
  await page.getByRole('textbox', {name:'Go code'}).fill(code);
  await page.getByRole('button', {name:'Save draft'}).click();
  await page.getByText('Draft saved', {exact:true}).waitFor();
  await page.reload();
  await openBookPage(page, quest.bossPage);
  await ready.locator('canvas').waitFor();
  assert.equal(await page.getByRole('textbox', {name:'Go code'}).inputValue(), code);
});

test('Code Workbench examples leave the monster standing and a Hard submit defeats it', async (t) => {
  const page = await newPage(t, '', 'javascript');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const {quests:[quest]} = JSON.parse(await readFile(new URL('data/worlds/javascript/campaign.json', project), 'utf8'));
  await createHero(page, 'Ward Breaker', 1);
  await jumpTo(page, quest.bossPage);
  await page.getByRole('button', {name:'Hard Mode', exact:true}).click();
  await page.getByText('Coaching is locked for this encounter.', {exact:true}).waitFor();
  assert.equal(await page.getByRole('button', {name:'Hint one', exact:true}).count(), 0);
  const ready = page.locator('.creature-encounter[data-state="ready"]');
  await ready.waitFor();
  await page.getByRole('textbox', {name:'JavaScript code'}).fill(
    'function makeBadge(value) { return { name: value.trim().toUpperCase(), visits: 0 }; }',
  );
  await page.getByRole('button', {name:'Run Examples', exact:true}).click();
  await page.getByText('Examples passed', {exact:true}).waitFor();
  await ready.waitFor();
  await page.getByRole('button', {name:'Submit solution', exact:true}).click();
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByText('Hard Clear', {exact:true}).waitFor();
  await page.reload();
  await openBookPage(page, quest.bossPage);
  await page.locator('.creature-encounter[data-state="defeated"]').waitFor();
  await page.getByRole('button', {name:'Switch hero'}).click();
  await createHero(page, 'Untried Ward', 1);
  await jumpTo(page, quest.bossPage);
  await ready.locator('canvas').waitFor();
});

test('a Rust boss links to its graded drill and defeat follows recorded Forge', async (t) => {
  const campaign = JSON.parse(await readFile(new URL('data/campaign.json', project), 'utf8'));
  const quest = campaign.quests.find(({ level }) => level === 20);
  const drill = pages.find(({ level, prompts }) => level === quest.level && prompts.some((prompt) => prompt.exerciseId));
  const exercise = drill.prompts.find((prompt) => prompt.exerciseId);
  const page = await newPage(t, '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/status', (route) => route.fulfill({ json: { storage: 'SQLite', runner: 'available' } }));
  await page.reload();
  await createHero(page, 'Rust Creature Hunter', 1);
  await jumpTo(page, quest.bossPage);

  const ready = page.locator('.creature-encounter[data-state="ready"]');
  const defeated = page.locator('.creature-encounter[data-state="defeated"]');
  await ready.getByRole('link', { name: 'Open the graded drill' }).click();
  await openBookPage(page, drill.page);
  await ready.waitFor();

  let passed = false;
  let submissions = 0;
  await page.route('**/api/grade', (route) => {
    const body = route.request().postDataJSON();
    assert.deepEqual([body.page, body.promptId, body.exerciseId], [drill.page, exercise.id, exercise.exerciseId]);
    passed = ++submissions === 2;
    return route.fulfill({ json: { verdict: passed ? 'pass' : 'fail', passed: Number(passed), failed: Number(!passed) } });
  });
  await page.route('**/api/progress', async (route) => {
    const response = await route.fetch();
    const progress = await response.json();
    if (passed) {
      progress.levels.push({level:quest.level, forge:true});
      progress.workbench.clears.push(exercise.exerciseId);
    }
    await route.fulfill({ response, json: progress });
  });

  const form = page.getByRole('form', { name: exercise.title, exact: true });
  const code = form.getByRole('textbox', { name: 'Rust code' });
  const run = form.getByRole('button', { name: 'Submit solution' });
  await code.fill('// First attempt');
  await run.click();
  await form.getByText('0 passed · 1 failed', { exact: true }).waitFor();
  await ready.waitFor();
  await code.fill('// Revised attempt');
  await run.click();
  await form.getByText('Tests passed', { exact: true }).waitFor();
  assert.match(await defeated.getByRole('status').textContent(), /Defeated/i);

  await jumpTo(page, quest.bossPage);
  await defeated.waitFor();
});

test('Bug Hunt is discoverable from the map and restores the case after reload', async (t) => {
  const page = await newPage(t, '', 'javascript');
  await createHero(page, 'Trace Detective', 1);
  const catalog = await page.request.get(`${origin}/api/campaign`, {
    headers: { 'X-Ferrum-World': 'javascript' },
  });
  assert.ok(catalog.ok());
  const { specialEncounters: [encounter] } = await catalog.json();
  const [diagnose, reproduce, repair] = encounter.stages;

  await page.getByRole('button', { name: 'World map' }).click();
  await page.getByRole('dialog', { name: 'World map' })
    .getByRole('link', { name: /The Stolen Signal/ }).click();
  await openBookPage(page, encounter.page);
  const hunt = page.getByRole('region', { name: 'The Stolen Signal', exact: true });
  const progress = (count) => hunt.and(page.locator(`[data-completed="${count}"]`)).waitFor();
  const choose = async (stage, id) => {
    const option = stage.options.find((item) => item.id === id);
    await hunt.getByRole('radio', { name: option.label }).check();
  };
  const submit = async (stage) => {
    const reply = page.waitForResponse((response) =>
      response.url().endsWith(`/api/encounters/${encounter.id}`) && response.request().method() === 'POST');
    await hunt.getByRole('button', { name: stage.actionLabel, exact: true }).click();
    const response = await reply;
    assert.equal(response.status(), 200);
    return (await response.json()).result;
  };

  await progress(0);
  await choose(diagnose, diagnose.options.find(({ id }) => id !== 'late-request').id);
  const missed = await submit(diagnose);
  assert.equal(missed.correct, false);
  await hunt.getByText(missed.feedback, { exact: true }).waitFor();
  await progress(0);
  await choose(diagnose, 'late-request');
  assert.equal((await submit(diagnose)).correct, true);
  await progress(1);
  const replay = await submit(reproduce);
  assert.ok(replay.trace.length > 0);
  await hunt.getByText(replay.trace.at(-1), { exact: true }).waitFor();
  await progress(2);

  await page.reload();
  await openBookPage(page, encounter.page);
  await progress(2);
  await choose(repair, 'guard-both');
  const fixed = await submit(repair);
  assert.ok(fixed.checks.length >= 3);
  await hunt.getByText(fixed.checks[0].label, { exact: true }).waitFor();
  await progress(3);
  await hunt.getByText('Case closed', { exact: true }).waitFor();

  await page.reload();
  await openBookPage(page, encounter.page);
  await progress(3);
  await hunt.getByText('Case closed', { exact: true }).waitFor();
});

test('the Ironbound Scarab falls after its three locks without awarding regular Forge', async (t) => {
  const page = await newPage(t, '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createHero(page, 'Lockbreaker', 1);
  const catalog = await page.request.get(`${origin}/api/campaign`);
  assert.ok(catalog.ok());
  const { specialEncounters: [encounter] } = await catalog.json();

  await page.getByRole('button', { name: 'World map' }).click();
  await page.getByRole('dialog', { name: 'World map' })
    .getByRole('link', { name: 'The Ironbound Scarab', exact: true }).click();
  await openBookPage(page, encounter.page);
  const boss = page.getByRole('region', { name: 'The Ironbound Scarab', exact: true });
  await boss.getByText('0 / 3 locks broken', { exact: true }).waitFor();
  const canvas = boss.locator('canvas');
  await canvas.waitFor();
  const intact = await canvas.evaluate((node) => node.toDataURL());
  const correct = ['overlapping-borrows', 'split-disjoint', 'separate-regions'];
  for (const [index, stage] of encounter.stages.entries()) {
    const option = stage.options.find(({ id }) => id === correct[index]);
    await boss.getByRole('radio', { name: option.label, exact: true }).check();
    await boss.getByRole('button', { name: stage.actionLabel, exact: true }).click();
    await boss.and(page.locator(`[data-completed="${index + 1}"]`)).waitFor();
  }
  await boss.getByText('Elite defeated', { exact: true }).waitFor();
  assert.notEqual(await canvas.evaluate((node) => node.toDataURL()), intact);
  await page.locator('.creature-encounter[data-state="ready"]').waitFor();
  await page.reload();
  await openBookPage(page, encounter.page);
  await boss.getByText('Elite defeated', { exact: true }).waitFor();
});

test('a One Life hero takes damage from an answer and uses a saved potion', async (t) => {
  const checkpoint = pages.find((page) => page.prompts.some((prompt) => prompt.id === 'checkpoint-1'));
  const choice = checkpoint.prompts.find((prompt) => prompt.id === 'checkpoint-1');
  const wrongAnswer = choice.options.find((option) => option.id !== choice.correctOption);
  const page = await newPage(t, '');
  await page.getByRole('checkbox', { name: 'One Life' }).check();
  await createHero(page, 'Potion Keeper', 1);
  const health = page.locator('#combat-status');
  await health.getByText('100 / 100 HP', { exact: true }).waitFor();
  assert.equal(await health.getByRole('button', { name: 'Drink potion' }).isDisabled(), true);

  await jumpTo(page, checkpoint.page);
  await page.getByRole('radio', { name: wrongAnswer.text, exact: true }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await health.getByText('95 / 100 HP', { exact: true }).waitFor();
  await health.getByText('−5 HP', { exact: true }).waitFor();

  await page.reload();
  await openBookPage(page, checkpoint.page);
  await health.getByText('95 / 100 HP', { exact: true }).waitFor();
  await health.getByRole('button', { name: 'Drink potion' }).click();
  await health.getByText('100 / 100 HP', { exact: true }).waitFor();
  await health.getByText('0 potions', { exact: true }).waitFor();
});

test('the trial board records a failed attempt and saves its first clear reward', async (t) => {
  const page = await newPage(t, '');
  await page.getByRole('checkbox', { name: 'One Life' }).check();
  await createHero(page, 'Foundry Challenger', 1);
  await page.getByRole('button', { name: 'Trials', exact: true }).click();
  const trial = page.getByRole('dialog', { name: 'Trials', exact: true });
  await trial.getByRole('heading', { name: 'Borrowing Foundry Trial' }).waitFor();
  await trial.getByRole('radio', { name: 'Only scroll.', exact: true }).check();
  await trial.getByRole('radio', { name: '&mut String', exact: true }).check();
  await trial.getByRole('button', { name: 'Submit trial' }).click();
  await trial.getByText('1 / 2 correct', { exact: true }).waitFor();
  await trial.getByText(/95 \/ 100 HP.*−5 HP/).waitFor();

  await trial.getByRole('radio', { name: 'Only pack.', exact: true }).check();
  await trial.getByRole('button', { name: 'Submit trial' }).click();
  await trial.getByText('2 / 2 correct', { exact: true }).waitFor();
  await trial.getByText(/95 \/ 100 HP.*2 potions.*\+1 potion/).waitFor();
  assert.equal(await trial.getByRole('button', { name: 'Trial cleared' }).isDisabled(), true);

  await page.reload();
  await openBookPage(page, 1);
  await page.getByRole('button', { name: 'Trials', exact: true }).click();
  await trial.getByText(/95 \/ 100 HP.*2 potions/).waitFor();
  assert.equal(await trial.getByRole('button', { name: 'Trial cleared' }).isDisabled(), true);
});

test('a hidden diamond starts a saved goblin fight with two graded stages and one loot award', { timeout: 30_000 }, async (t) => {
  const page = await newPage(t, '', 'javascript');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('checkbox', { name: 'One Life' }).check();
  await createHero(page, 'Diamond Delver', 1);
  const diamond = page.getByRole('button', { name: diamondName });
  const fight = page.locator('.diamond-encounter');
  const health = page.locator('#combat-status');
  const views = await diamondPages(page, 16);
  const visible = views.filter(({ sparkle }) => sparkle);
  assert.equal(visible.length, 2);

  const offPage = views.find(({ sparkle, number }) => !sparkle && number !== 1);
  await jumpTo(page, offPage.number);
  await diamond.waitFor({ state: 'hidden' });
  await fight.waitFor({ state: 'hidden' });
  await jumpTo(page, visible[0].number);
  await assertDiamondWithinPage(page, diamond);
  await jumpTo(page, visible[1].number);
  await assertDiamondWithinPage(page, diamond);

  await diamond.click();
  await fight.getByRole('heading', { name: goblinName, exact: true }).waitFor();
  const editor = fight.getByRole('textbox', { name: 'Goblin code' });
  const submitCode = fight.getByRole('button', { name: 'Submit code', exact: true });
  await editor.fill('function sumDiamonds(values) { return 0; }');
  const examplesReply = page.waitForResponse('**/api/diamond/submit');
  await fight.getByRole('button', { name: 'Run Examples', exact: true }).click();
  assert.ok((await examplesReply).ok());
  await health.getByText('100 / 100 HP', { exact: true }).waitFor();
  await editor.waitFor();

  await submitCode.click();
  await health.getByText('95 / 100 HP', { exact: true }).waitFor();
  await editor.fill(diamondSolution);
  await submitCode.click();
  const submitAnswer = fight.getByRole('button', { name: 'Submit answer', exact: true });
  await submitAnswer.waitFor();

  await jumpTo(page, offPage.number);
  await submitAnswer.waitFor();
  await jumpTo(page, visible[1].number);

  await page.reload();
  await openBookPage(page, visible[1].number);
  await submitAnswer.waitFor();
  await editor.waitFor({ state: 'hidden' });
  await fight.getByRole('radio', { name: 'values.sort()', exact: true }).check();
  await submitAnswer.click();
  await health.getByText('90 / 100 HP', { exact: true }).waitFor();
  await fight.getByRole('radio', { name: 'values.slice()', exact: true }).check();
  await submitAnswer.click();
  await fight.getByText('Goblin defeated', { exact: true }).waitFor();
  await health.getByText('2 potions', { exact: true }).waitFor();
  await fight.getByRole('button', { name: 'Continue adventure', exact: true }).click();
  await fight.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#guide-panel').evaluate(node => document.activeElement === node), true);

  await page.reload();
  await openBookPage(page, visible[1].number);
  await fight.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Character sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Character sheet' });
  await sheet.getByText('Diamonds collected · 3', { exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Close character sheet' }).click();
  await jumpTo(page, visible[0].number);
  await fight.waitFor({ state: 'hidden' });
  await diamond.waitFor({ state: 'hidden' });
  const saved = await diamondPages(page, 16);
  assert.ok(saved.every(({ sparkle, diamonds }) => !sparkle && diamonds === 3));

  await page.getByRole('button', { name: 'Merchant', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Diamond merchant' });
  await shop.getByText('3 diamonds available', { exact: true }).waitFor();
  await shop.getByText('Buy the Vault Key to enter.', { exact: true }).waitFor();
  await shop.getByRole('button', { name: 'Buy Emerald Cloak · 1 diamond' }).click();
  await shop.getByRole('button', { name: 'Equip Emerald Cloak', exact: true }).click();
  await shop.getByRole('button', { name: 'Unequip Emerald Cloak', exact: true }).waitFor();
  await shop.getByRole('button', { name: 'Buy Vault Key · 2 diamonds' }).click();
  await shop.getByText('0 diamonds available', { exact: true }).waitFor();
  assert.equal(await shop.getByRole('button', { name: 'Buy Healing potion · 1 diamond' }).isDisabled(), true);
  await shop.getByRole('radio', { name: 'Use each object’s id string.', exact: true }).check();
  await shop.getByRole('radio', { name: 'quantities.has(id)', exact: true }).check();
  await shop.getByRole('button', { name: 'Submit vault answers', exact: true }).click();
  await shop.getByText('Vault cleared', { exact: true }).waitFor();
  await shop.getByText('2 / 2 correct', { exact: true }).waitFor();

  await page.reload();
  await openBookPage(page, visible[0].number);
  await page.getByRole('button', { name: 'Character sheet' }).click();
  await sheet.getByText('Diamonds to spend · 0', { exact: true }).waitFor();
  await sheet.getByText('Diamonds collected · 3', { exact: true }).waitFor();
  await sheet.getByText('Vault cleared · The Duplicate Dispatch', { exact: true }).waitFor();
  assert.equal(await sheet.locator('.sheet-hero').getAttribute('data-hero-skin'), 'emerald-cloak');
});

test('an offline Rust runner leaves the goblin editor available and preserves Tab indentation', async (t) => {
  const page = await newPage(t, '', 'rust');
  await createHero(page, 'Goblin Scribe', 1);
  const discovery = (await diamondPages(page, 8, 'rust')).find(({ sparkle }) => sparkle);
  assert.ok(discovery);
  if (discovery.number !== 1) await jumpTo(page, discovery.number);
  await page.getByRole('button', { name: diamondName }).click();
  const fight = page.locator('.diamond-encounter');
  await fight.getByText(/The local Rust runner is unavailable/).waitFor();
  assert.equal(await fight.getByRole('button', { name: 'Run Examples', exact: true }).isDisabled(), true);
  assert.equal(await fight.getByRole('button', { name: 'Submit code', exact: true }).isDisabled(), true);

  const editor = fight.getByRole('textbox', { name: 'Goblin code' });
  const firstLine = 'pub fn sum_diamonds(values: &[i32]) -> i32 {\n';
  const placeholder = 'REPLACE';
  const draft = `${firstLine}    todo!()\n}`;
  await editor.fill(`${firstLine}${placeholder}todo!()\n}`);
  await indentWithTab(editor, firstLine.length, firstLine.length + placeholder.length, draft);
  await editor.press('Shift+Tab');
  assert.equal(await editor.evaluate((field) => document.activeElement === field), false);
  await page.reload();
  await openBookPage(page, discovery.number);
  await editor.waitFor();
  assert.equal(await editor.inputValue(), draft);
});

test('a fallen hero keeps the book and cannot submit or drink a potion', async (t) => {
  const checkpoint = pages.find((page) => page.prompts.some((prompt) => prompt.id === 'checkpoint-1'));
  const choice = checkpoint.prompts.find((prompt) => prompt.id === 'checkpoint-1');
  const wrongAnswer = choice.options.find((option) => option.id !== choice.correctOption);
  const page = await newPage(t, '');
  await page.getByRole('checkbox', { name: 'One Life' }).check();
  await createHero(page, 'Last Stand', 1);
  await jumpTo(page, checkpoint.page);
  const health = page.locator('#combat-status');
  const answer = page.getByRole('button', { name: 'Check answer' });
  await page.getByRole('radio', { name: wrongAnswer.text, exact: true }).check();
  for (let hp = 95; hp >= 0; hp -= 5) {
    await answer.click();
    await health.getByText(`${hp} / 100 HP`, { exact: true }).waitFor();
  }
  await health.getByText(/Your hero has fallen/).waitFor();
  await health.getByText('1 potion', { exact: true }).waitFor();
  assert.equal(await health.getByRole('button', { name: 'Drink potion' }).isDisabled(), true);
  assert.equal(await answer.isDisabled(), true);

  await page.reload();
  await openBookPage(page, checkpoint.page);
  await health.getByText('0 / 100 HP', { exact: true }).waitFor();
  assert.equal(await answer.isDisabled(), true);
  await page.locator('#reader-viewport').focus();
  await page.keyboard.press('d');
  await openBookPage(page, checkpoint.page + 1);
});

test('book text mode shows prose and indented code without moving the saved reading page', async t => {
  const page = await newPage(t, '', 'typescript');
  await createHero(page, 'Text Edition Reader', 1);
  await jumpTo(page, 11);
  await page.getByRole('button', {name:'Read as text', exact:true}).click();
  const text = page.getByRole('article', {name:'Book text, page 11'});
  await text.getByRole('heading', {name:'The Two Signal Flags'}).waitFor();
  const code = await text.locator('pre code').textContent();
  assert.match(code, /\n  if \(arrival\.kind === 'assigned'\) \{\n    return/);
  assert.equal(await page.locator('#book-page').count(), 0);
  await text.getByText('Links on this page', {exact:true}).click();
  await text.getByRole('link', {name:'Open book page 2', exact:true}).click();
  await page.getByRole('article', {name:'Book text, page 2'}).waitFor();
  await page.reload();
  await page.getByRole('article', {name:'Book text, page 2'}).waitFor();
  await page.getByRole('button', {name:'Page image', exact:true}).click();
  await openBookPage(page, 2);
});

test('the Rust field labs open from the World Map and retain notebook variations after reload', async t => {
  const campaign = JSON.parse(await readFile(new URL('data/campaign.json', project), 'utf8'));
  assert.deepEqual(campaign.labs.map(lab => lab.id), ['lab-async', 'lab-dispatch', 'lab-schedules']);
  const page = await newPage(t, '', 'rust');
  await createHero(page, 'Field Lab Notebook Keeper', 1);
  for (const lab of campaign.labs) {
    await page.getByRole('button', {name:'World map', exact:true}).click();
    await page.getByRole('dialog', {name:'World map', exact:true})
      .getByRole('link', {name:lab.title, exact:true}).click();
    await openBookPage(page, lab.page);
    const matches = prompt => prompt.id.startsWith(lab.id + '-') && prompt.type === 'code';
    const notebook = pages.find(page => page.prompts.some(matches));
    assert.ok(notebook, `${lab.id} has an authored code notebook`);
    if (notebook.page !== lab.page) await jumpTo(page, notebook.page);
    const prompt = notebook.prompts.find(matches);
    const form = page.getByRole('form', {name:prompt.title, exact:true});
    const editor = form.getByRole('textbox', {name:'Rust code', exact:true});
    const draft = `// My saved ${lab.id} variation\n${prompt.starter}`;
    await editor.fill(draft);
    assert.equal(await form.getByRole('button', {name:'Submit solution', exact:true}).count(), 0);
    await form.getByRole('button', {name:'Save code notes', exact:true}).click();
    await form.getByText('Response saved', {exact:true}).waitFor();
    await page.reload();
    await openBookPage(page, notebook.page);
    assert.equal(await editor.inputValue(), draft);
  }
});
