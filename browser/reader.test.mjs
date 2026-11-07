import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';

const project = new URL('../', import.meta.url);
const pages = JSON.parse(await readFile(new URL('data/pages.json', project), 'utf8'));
let app;
let browser;
let scratch;
let origin;

async function startServer() {
  scratch = await mkdtemp(join(tmpdir(), 'ferrum-browser-'));
  app = spawn(process.execPath, ['server.mjs'], {
    cwd: project,
    env: { ...process.env, PORT: '0', FERRUM_DB: join(scratch, 'browser.sqlite'),
      DOCKER_CONTEXT: '', DOCKER_HOST: 'tcp://127.0.0.1:1' },
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
    for (const database of ['browser.sqlite', 'browser.javascript.sqlite', 'browser.typescript.sqlite', 'browser.go.sqlite']) {
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

test('page shortcuts follow focus, preserve typed A/D, and ignore open dialogs', async (t) => {
  const page = await newPage(t, '#page=15', null);
  await page.getByText('Your saved heroes will appear here.').waitFor();
  await createHero(page, 'Keyboard Warden', 15);
  await page.keyboard.press('d');
  await openBookPage(page, 16);
  await page.keyboard.press('a');
  await openBookPage(page, 15);
  const note = page.getByRole('textbox', { name: 'Your written response' }).first();
  await note.focus();
  await note.press('a');
  await note.press('d');
  assert.equal(await note.inputValue(), 'ad');
  await openBookPage(page, 15);
  await page.getByRole('button', { name: 'World map' }).click();
  await page.getByRole('dialog', { name: 'World map' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Close world map' }).click();
  await openBookPage(page, 15);
  await page.locator('#reader-viewport').focus();
  await page.keyboard.press('ArrowRight');
  await openBookPage(page, 16);
  await page.locator('#page-hotspots a[href="#page=6"]').first().click();
  await openBookPage(page, 6);
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
  await fresh.getByRole('button', { name: /Choice Scout/ }).click();
  await openBookPage(fresh, checkpoint.page + 1);
  await fresh.keyboard.press('a');
  await openBookPage(fresh, checkpoint.page);
  const selected = fresh.getByRole('radio', { name: correctLabel });
  assert.equal(await selected.isChecked(), true);
});

test('an offline runner leaves the Rust editor and SQLite draft save available', async (t) => {
  const gradedPage = pages.find((page) => page.prompts.some((prompt) => prompt.exerciseId));
  const page = await newPage(t, '');
  await createHero(page, 'Forge Apprentice', 1);
  await jumpTo(page, gradedPage.page);
  const run = page.getByRole('button', { name: 'Run Rust tests' });
  assert.equal(await run.isDisabled(), true);
  const exercise = gradedPage.prompts.find((prompt) => prompt.exerciseId);
  const card = page.getByRole('form', { name: exercise.title, exact: true });
  const editor = card.getByRole('textbox', { name: 'Rust code' });
  const source = '// A saved attempt\nfn draft() {}';
  await editor.fill(source);
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
  await jumpTo(page, 15);
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
  await jumpTo(page, 16);
  await jumpTo(page, 15);
  await note.fill('newer draft');

  const reply = page.waitForResponse('**/api/answers');
  deliver.resolve();
  await (await reply).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.reload();
  await openBookPage(page, 15);
  assert.equal(await note.inputValue(), 'newer draft');
});

test('the home page offers all four worlds after playing as a Rust hero in the same tab', async (t) => {
  const page = await newPage(t, '', 'rust');
  await createHero(page, 'Home Page Scout', 1);

  await page.goto(`${origin}/`);
  const picker = page.getByRole('dialog', { name: 'Choose a world' });
  await picker.waitFor();
  await picker.getByRole('link', { name: /World 1 JavaScript/ }).waitFor();
  await picker.getByRole('link', { name: /World 2 TypeScript/ }).waitFor();
  await picker.getByRole('link', { name: /World 3 Rust/ }).waitFor();
  await picker.getByRole('link', { name: /World 4 Go/ }).waitFor();
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
  await page.getByRole('button', { name: 'Save code notes' }).click();
  await page.getByText('Saved to your quest log', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Forge self-review' }).check();
  await page.getByText('Quest log updated', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Worlds', exact: true }).click();
  await pick(/World 2 TypeScript/);
  await page.getByText('Your saved heroes will appear here.').waitFor();
  await createHero(page, 'World Scout', 1);
  assert.match(await page.locator('#book-page').getAttribute('src'), /\/book\/typescript\/pages\/1\.webp/);
  await page.getByRole('button', { name: 'Worlds', exact: true }).click();
  await pick(/World 1 JavaScript/);
  await openBookPage(page, encounter);
  assert.equal(await editor.inputValue(), source);
  assert.equal(await page.getByRole('checkbox', { name: 'Forge self-review' }).isChecked(), true);
});

test('Go beginner checkpoints update the character sheet and survive a reload', async (t) => {
  const page = await newPage(t, '', null);
  await page.getByRole('link', { name: /World 4 Go/ }).click();
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
    await page.getByRole('button', { name: 'Save code notes' }).click();
    await page.getByText('Saved to your quest log', { exact: true }).waitFor();
    assert.equal(await page.locator('.recommendation').count(), 0);
    for (const name of ['Scouted', 'Forge self-review', 'Explained']) {
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
  await sheet.getByText('Hero level 2 / 10', { exact: true }).waitFor();
  await sheet.getByText('World: 2 of 14 levels complete', { exact: true }).waitFor();
  await sheet.getByText(`Active path: 2 of ${beginner.levels.length} levels complete`, { exact: true }).waitFor();
  const skill = sheet.getByRole('listitem').filter({ hasText: go.zones[0].skill });
  assert.equal(await skill.getByRole('progressbar').getAttribute('value'), '6');
  assert.equal(await sheet.getByRole('progressbar', { name: 'World experience' }).getAttribute('value'), '6');
  await sheet.getByRole('link', { name: `Level 1 · ${go.quests[0].mission_title}` }).click();
  await openBookPage(page, go.quests[0].page);
  await jumpTo(page, go.quests[0].bossPage);
  assert.equal(await page.getByRole('textbox', { name: 'Go code' }).inputValue(), '// Keep this Go draft 1');
});

test('a creature is defeated only after Forge is earned by the current hero', async (t) => {
  const page = await newPage(t, '', 'go');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { quests: [quest] } = JSON.parse(await readFile(new URL('data/worlds/go/campaign.json', project), 'utf8'));
  await createHero(page, 'Creature Hunter', 1);
  await jumpTo(page, quest.manualPage);
  assert.equal(await page.locator('.creature-encounter').count(), 0);

  await jumpTo(page, quest.bossPage);
  const encounter = page.locator('.creature-encounter');
  const ready = page.locator('.creature-encounter[data-state="ready"]');
  const defeated = page.locator('.creature-encounter[data-state="defeated"]');
  await ready.locator('canvas').waitFor();
  const forge = page.getByRole('checkbox', { name: 'Forge self-review' });
  await forge.click();
  await page.getByText('Save your boss encounter draft before marking Forge.', { exact: true }).waitFor();
  assert.equal(await forge.isChecked(), false);
  await ready.waitFor();

  await page.getByRole('textbox', { name: 'Go code' }).fill('func badge(raw string) string { return raw }');
  await page.getByRole('button', { name: 'Save code notes' }).click();
  await page.getByText('Saved to your quest log', { exact: true }).waitFor();
  await ready.waitFor();

  await Promise.all([
    page.locator('.creature-encounter[data-state="defeating"]').waitFor(),
    forge.check(),
  ]);
  await defeated.waitFor();
  await encounter.getByText(/Defeated/i).waitFor();

  await page.reload();
  await openBookPage(page, quest.bossPage);
  await defeated.locator('canvas').waitFor();

  await page.getByRole('button', { name: 'Switch hero' }).click();
  await createHero(page, 'Creature Scout', 1);
  await jumpTo(page, quest.bossPage);
  await ready.locator('canvas').waitFor();
});

test('a Rust boss links to its graded drill and defeat follows recorded Forge', async (t) => {
  const campaign = JSON.parse(await readFile(new URL('data/campaign.json', project), 'utf8'));
  const quest = campaign.quests.find(({ level }) => level === 3);
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
    if (passed) progress.levels.push({ level: quest.level, forge: true });
    await route.fulfill({ response, json: progress });
  });

  const form = page.getByRole('form', { name: exercise.title, exact: true });
  const code = form.getByRole('textbox', { name: 'Rust code' });
  const run = form.getByRole('button', { name: 'Run Rust tests' });
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
