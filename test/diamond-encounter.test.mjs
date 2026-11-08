import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openStore } from '../lib/store.mjs';
import { runCourseExercise } from '../lib/workbench-service.mjs';
import {
  diamondExercise, diamondStage, diamondView, evaluateDiamondChoice, evaluateDiamondCode,
  refreshDiamondOutcome, settleDiamond, startDiamond,
} from '../lib/diamond-encounter.mjs';

const world = 'javascript';
const ticket = id => ({ id, fingerprint:`goblin:${id}` });
const pass = evaluateDiamondCode({ verdict:'pass', purpose:'submit' });
const miss = evaluateDiamondCode({ verdict:'fail', purpose:'submit' });

async function withStores(run) {
  const directory = await mkdtemp(join(tmpdir(), 'dungeons-goblin-'));
  const file = join(directory, 'save.sqlite');
  const first = await openStore({file});
  const second = await openStore({file});
  try {
    await run(first, second);
  } finally {
    second.close();
    first.close();
    await rm(directory, {recursive:true, force:true});
  }
}

function sparkles(store, hero, total) {
  return Array.from({length:total}, (_, index) => index + 1)
    .filter(page => diamondView(store, hero, world, page, total).sparkle);
}

test('the gem has a stable random location in every eight-page block, including a short ending', async () => {
  await withStores((first, second) => {
    first.createHero({id:'Scout', name:'Scout'});
    first.createHero({id:'Ranger', name:'Ranger'});
    const pages = sparkles(first, 'Scout', 19);
    assert.equal(pages.length, 3);
    assert.ok(pages[0] <= 8 && pages[1] >= 9 && pages[1] <= 16 && pages[2] >= 17);
    assert.deepEqual(sparkles(second, 'Scout', 19), pages);
    assert.notDeepEqual(sparkles(first, 'Ranger', 19), pages);
    const point = diamondView(first, 'Scout', world, pages[0], 19).sparkle;
    assert.ok(point.x > 0 && point.x < 100 && point.y > 0 && point.y < 100);
    assert.deepEqual(diamondView(second, 'Scout', world, pages[0], 19).sparkle, point);
    assert.equal(diamondView(first, 'Scout', world, 20, 19).sparkle, null);
  });
});

test('clicking a real gem opens a persistent battle and keeps answers and fixtures private', async () => {
  await withStores((first, second) => {
    first.createHero({id:'Scout', name:'Scout'});
    const [page] = sparkles(first, 'Scout', 8);
    assert.throws(() => startDiamond(first, 'Scout', world, page === 1 ? 2 : 1, 8), {code:'DIAMOND_NOT_FOUND'});
    assert.throws(() => diamondStage(first, 'Scout', world, 'code'), {code:'DIAMOND_NOT_FOUND'});
    const started = startDiamond(first, 'Scout', world, page, 8);
    assert.equal(started.sparkle, null);
    assert.deepEqual(started.encounter.stages.map(({kind}) => kind), ['code','choice']);
    assert.equal(started.encounter.rewardDiamonds, 3);
    assert.equal(started.encounter.stages[0].testNames.length, 1);
    assert.equal(Object.hasOwn(started.encounter.stages[0], 'tests'), false);
    assert.equal(Object.hasOwn(started.encounter.stages[0], 'reference'), false);
    assert.equal(Object.hasOwn(started.encounter.stages[1], 'answer'), false);
    assert.throws(() => diamondStage(first, 'Scout', world, 'choice'), {code:'DIAMOND_STAGE_LOCKED'});
    assert.throws(() => diamondStage(first, 'Scout', world, 'reward'), {code:'DIAMOND_STAGE_INVALID'});
    assert.equal(evaluateDiamondChoice(world, 'missing-option'), null);
    first.saveDiamondDraft('Scout', 'function sumDiamonds(values) { return 9; }');
    assert.equal(diamondView(second, 'Scout', world, 8, 8).draft, 'function sumDiamonds(values) { return 9; }');
    assert.equal(diamondView(second, 'Scout', world, 8, 8).encounter.title, started.encounter.title);
  });
});

test('only a graded miss costs HP and repeated or stale submissions cannot duplicate damage or loot', async () => {
  await withStores((first, second) => {
    const hero = 'Scout';
    first.createHero({id:hero, name:hero, oneLife:true});
    startDiamond(first, hero, world, 1, 1);
    const examples = evaluateDiamondCode({ verdict:'pass', purpose:'examples' });
    assert.deepEqual(settleDiamond(first, hero, world, 'code', ticket('examples'), examples).result.completed, []);
    const offline = evaluateDiamondCode({ verdict:'unavailable', purpose:'submit' });
    assert.equal(settleDiamond(first, hero, world, 'code', ticket('offline'), offline).combat.hp, 100);
    const originalMiss = settleDiamond(first, hero, world, 'code', ticket('miss'), miss);
    assert.equal(originalMiss.combat.hp, 95);
    assert.equal(originalMiss.combatEvent.damage, 5);
    assert.equal(settleDiamond(second, hero, world, 'code', ticket('miss'), miss).combatEvent.damage, 0);
    const code = settleDiamond(first, hero, world, 'code', ticket('code'), pass);
    assert.deepEqual(code.result.completed, ['code']);
    assert.equal(code.result.diamonds, 0);
    assert.equal(settleDiamond(second, hero, world, 'code', ticket('stale-miss'), miss).combat.hp, 95);
    const wrong = settleDiamond(second, hero, world, 'choice', ticket('choice-miss'), evaluateDiamondChoice(world, 'sort'));
    assert.equal(wrong.combat.hp, 90);
    const win = settleDiamond(first, hero, world, 'choice', ticket('choice'), evaluateDiamondChoice(world, 'slice'));
    assert.deepEqual(win.result.completed, ['code','choice']);
    assert.equal(win.result.diamonds, 3);
    assert.equal(win.combatEvent.potionsEarned, 1);
    assert.equal(win.combat.potions, 2);
    assert.equal(settleDiamond(second, hero, world, 'choice', ticket('late-choice'), evaluateDiamondChoice(world, 'slice')).combat.potions, 2);
    const replay = refreshDiamondOutcome(second, hero, world, second.combatReceipt(hero, ticket('miss')));
    assert.equal(replay.result.result.correct, false);
    assert.deepEqual(replay.result.completed, ['code','choice']);
    assert.equal(replay.result.diamonds, 3);
    assert.equal(diamondView(second, hero, world, 1, 1).sparkle, null);
    assert.deepEqual(second.progress(hero).levels, [], 'the side fight does not clear a book level');
  });
});

test('fallen heroes cannot start new battles, and Standard heroes can earn the diamonds', async () => {
  await withStores(first => {
    first.createHero({id:'Fallen', name:'Fallen', oneLife:true});
    for (let i = 0; i < 20; i++) first.settleCombat('Fallen', {...ticket(`fall-${i}`), wrong:true});
    assert.equal(diamondView(first, 'Fallen', world, 1, 1).sparkle, null);
    assert.throws(() => startDiamond(first, 'Fallen', world, 1, 1), {code:'HERO_FALLEN'});
    first.createHero({id:'Standard', name:'Standard'});
    startDiamond(first, 'Standard', world, 1, 1);
    settleDiamond(first, 'Standard', world, 'code', ticket('code'), pass);
    const win = settleDiamond(first, 'Standard', world, 'choice', ticket('choice'), evaluateDiamondChoice(world, 'slice'));
    assert.equal(win.result.diamonds, 3);
    assert.equal(win.combat.potions, 0);
  });
});

test('each world’s riddle accepts its single authored answer', async () => {
  await withStores(first => {
    const answers = {javascript:'slice', typescript:'readonly', rust:'shared', go:'shared'};
    for (const [world, answer] of Object.entries(answers)) {
      first.createHero({id:world, name:world});
      const {encounter} = startDiamond(first, world, world, 1, 1);
      const choice = encounter.stages[1];
      const correct = choice.options.filter(option => evaluateDiamondChoice(world, option.id)?.correct);
      assert.deepEqual(correct.map(option => option.id), [answer]);
    }
  });
});

for (const world of ['javascript','typescript']) {
  test(`${world} goblin suite accepts the reference and catches an example-only answer`, async () => {
    const exercise = diamondExercise(world);
    const report = await runCourseExercise(world, exercise.reference, exercise, 'submit');
    assert.equal(report.verdict, 'pass', report.output);
    const cheat = exercise.reference.replace(/return .+;/, 'return 9;');
    const examples = await runCourseExercise(world, cheat, exercise, 'examples');
    assert.equal(examples.verdict, 'pass', examples.output);
    const graded = await runCourseExercise(world, cheat, exercise, 'submit');
    assert.equal(graded.verdict, 'fail', graded.output);
    assert.deepEqual(graded.cases.map(item => item.id), exercise.tests.filter(item => item.visibility === 'public').map(item => item.id));
  });
}
