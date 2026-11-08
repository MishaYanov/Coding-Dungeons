import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openStore } from '../lib/store.mjs';

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ferrum-combat-'));
  const file = join(directory, 'combat.sqlite');
  const store = await openStore({file});
  try {
    await run(store, file);
  } finally {
    store.close();
    await rm(directory, {recursive:true, force:true});
  }
}

function createHero(store, id, oneLife = false) {
  return store.createHero({id, name:id, oneLife});
}

function submission(id, options) {
  return {id, fingerprint:`submission:${id}`, ...options};
}

test('Only One Life heroes take damage and the first trial and Forge clears grant potions', async () => {
  await withStore(store => {
    const standard = createHero(store, 'Standard');
    const delver = createHero(store, 'Delver', true);
    assert.equal(delver.oneLife, true);
    assert.equal(store.heroes().find(hero => hero.id === delver.id).oneLife, true);
    assert.deepEqual(store.combatState(standard.id), {mode:'standard', hp:null, maxHp:null, potions:0, fallen:false, completedTrials:[]});
    assert.deepEqual(store.combatState(delver.id), {mode:'one-life', hp:100, maxHp:100, potions:1, fallen:false, completedTrials:[]});

    store.settleCombat(standard.id, submission('miss', {wrong:true}));
    store.settleCombat(standard.id, submission('clear', {trialId:'bridge'}));
    assert.deepEqual(store.combatState(standard.id), {mode:'standard', hp:null, maxHp:null, potions:0, fallen:false, completedTrials:['bridge']});

    const wrong = store.settleCombat(delver.id, submission('miss', {wrong:true, trialId:'bridge'}));
    assert.equal(wrong.combat.hp, 95);
    assert.equal(wrong.combatEvent.damage, 5);
    assert.deepEqual(wrong.combat.completedTrials, []);

    const clear = store.settleCombat(delver.id, submission('clear', {trialId:'bridge'}));
    assert.equal(clear.combatEvent.potionsEarned, 1);
    assert.deepEqual(clear.combat.completedTrials, ['bridge']);
    assert.equal(clear.combat.potions, 2);
    assert.equal(store.settleCombat(delver.id, submission('another-clear', {trialId:'bridge'})).combatEvent.potionsEarned, 0);
    assert.equal(store.settleCombat(delver.id, submission('forge', {rewardKey:'forge:riddle'})).combat.potions, 3);
    assert.equal(store.settleCombat(delver.id, submission('forge-again', {rewardKey:'forge:riddle'})).combat.potions, 3);
  });
});

test('a retried submission returns the original result without replaying its writes or damage', async () => {
  await withStore(async (store, file) => {
    const hero = createHero(store, 'Scout', true);
    const second = await openStore({file});
    try {
      const first = submission('first', {wrong:true});
      const saved = store.settleCombat(hero.id, first, () => {
        store.saveResponse(hero.id, 1, 'quiz', 'a', 'Try again.', false);
        return {correct:false};
      });
      assert.equal(saved.replayed, false);
      assert.equal(saved.combat.hp, 95);
      second.settleCombat(hero.id, submission('second', {wrong:true}));

      const replay = second.settleCombat(hero.id, first, () => assert.fail('replayed the write'));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, {correct:false});
      assert.equal(replay.combatEvent.damage, 0);
      assert.equal(replay.combat.hp, 90);
      assert.deepEqual(store.combatReceipt(hero.id, first), replay);
      assert.deepEqual(store.response(hero.id, 1, 'quiz'), {value:'a'});
      assert.throws(() => second.combatReceipt(hero.id, {...first, fingerprint:'different'}), {code:'COMBAT_SUBMISSION_CONFLICT'});

      const rollback = submission('rollback', {wrong:true});
      assert.throws(() => store.settleCombat(hero.id, rollback, () => {
        store.saveResponse(hero.id, 1, 'quiz', 'b', 'A new answer.', false);
        throw new Error('failed to settle');
      }), /failed to settle/);
      assert.equal(second.combatState(hero.id).hp, 90);
      assert.equal(second.combatReceipt(hero.id, rollback), undefined);
      assert.deepEqual(second.response(hero.id, 1, 'quiz'), {value:'a'});
    } finally {
      second.close();
    }
  });
});

test('a potion heals up to twenty HP without overflowing health or spending twice on retry', async () => {
  await withStore(store => {
    const hero = createHero(store, 'Healer', true);
    assert.throws(() => store.consumePotion(hero.id, submission('full')), {code:'HEALTH_FULL'});
    assert.equal(store.combatState(hero.id).potions, 1);
    for (let hit = 0; hit < 5; hit++) store.settleCombat(hero.id, submission(`hit-${hit}`, {wrong:true}));

    const potion = submission('drink');
    const healed = store.consumePotion(hero.id, potion);
    assert.equal(healed.combat.hp, 95);
    assert.equal(healed.combat.potions, 0);
    assert.equal(healed.combatEvent.healing, 20);
    assert.equal(store.consumePotion(hero.id, potion).combatEvent.healing, 0);
    assert.throws(() => store.consumePotion(hero.id, submission('empty')), {code:'POTION_UNAVAILABLE'});

    store.settleCombat(hero.id, submission('reward', {trialId:'well'}));
    const toppedUp = store.consumePotion(hero.id, submission('top-up'));
    assert.equal(toppedUp.combat.hp, 100);
    assert.equal(toppedUp.combatEvent.healing, 5);
  });
});

test('a fallen hero stays at zero HP on reopen and cannot submit or heal', async () => {
  await withStore(async (store, file) => {
    const hero = createHero(store, 'Fallen', true);
    for (let hit = 0; hit < 19; hit++) store.settleCombat(hero.id, submission(`hit-${hit}`, {wrong:true}));
    const fatal = submission('fatal', {wrong:true});
    assert.equal(store.settleCombat(hero.id, fatal).combat.hp, 0);

    const reopened = await openStore({file});
    try {
      assert.deepEqual(reopened.combatState(hero.id), {mode:'one-life', hp:0, maxHp:100, potions:1, fallen:true, completedTrials:[]});
      assert.equal(reopened.settleCombat(hero.id, fatal).replayed, true);
      assert.throws(() => reopened.settleCombat(hero.id, submission('late-clear', {trialId:'bridge'}),
        () => assert.fail('wrote to a fallen hero')), {code:'HERO_FALLEN'});
      assert.throws(() => reopened.consumePotion(hero.id, submission('late-potion')), {code:'HERO_FALLEN'});
    } finally {
      reopened.close();
    }
  });
});
