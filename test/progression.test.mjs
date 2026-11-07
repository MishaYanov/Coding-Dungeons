import assert from 'node:assert/strict';
import { test } from 'node:test';
import { characterProgress } from '../public/progression.mjs';

const complete = { scout: true, forge: 1, explain: '1' };

test('hero XP, completed levels, route progress, and skills use current-world core marks', () => {
  const campaign = {
    quests: [{ level: 1 }, { level: 2 }, { level: 4 }],
    paths: [{ id: 'scout', name: 'Scout Route', levels: [1, 4] }],
    zones: [
      { name: 'Station', skill: 'Testing', first: 1, last: 2 },
      { name: 'Ridge', first: 3, last: 4 },
    ],
  };
  const levels = new Map([
    [1, { ...complete, side: true }],
    [2, { scout: '1', forge: '0', side: 1 }],
    [4, { forge: true, explain: 1, side: '0' }],
    [7, { ...complete, side: true }],
  ]);

  assert.deepEqual(characterProgress(campaign, levels, 'scout'), {
    heroLevel: 7, heroLevelCap: 10, xp: 6, xpMax: 9, nextLevelXp: 7,
    completed: 1, total: 3, marks: 6, marksTotal: 9,
    counts: { scout: 2, forge: 2, explain: 2, side: 2 },
    route: { name: 'Scout Route', completed: 1, total: 2 },
    skills: [
      { name: 'Testing', level: 3, earned: 4, total: 6 },
      { name: 'Ridge', level: 3, earned: 2, total: 3 },
    ],
  });
});

test('hero levels scale to the world size and reach the cap on completion', () => {
  for (const size of [14, 42]) {
    const quests = Array.from({ length: size }, (_, index) => ({ level: index + 1 }));
    const campaign = { quests, zones: [{ name: 'World skills', first: 1, last: size }] };
    const levels = new Map();
    const fresh = characterProgress(campaign, levels, '');
    assert.equal(fresh.heroLevel, 1);
    assert.equal(fresh.route, null);
    assert.equal(fresh.nextLevelXp, Math.ceil(size / 3));
    assert.equal(fresh.skills[0].level, 0);

    for (const { level } of quests.slice(0, size / 2)) levels.set(level, complete);
    const halfway = characterProgress(campaign, levels, '');
    assert.equal(halfway.heroLevel, 5);
    assert.equal(halfway.skills[0].level, 2);

    for (const { level } of quests) levels.set(level, complete);
    const finished = characterProgress(campaign, levels, '');
    assert.equal(finished.heroLevel, finished.heroLevelCap);
    assert.equal(finished.xp, finished.xpMax);
    assert.equal(finished.nextLevelXp, null);
    assert.equal(finished.skills[0].level, 5);
  }
});

test('an unavailable campaign has zero available XP and no skill tracks', () => {
  const progress = characterProgress({ zones: [{ name: 'Station', first: 1, last: 2 }] }, new Map(), '');
  assert.equal(progress.heroLevel, 1);
  assert.equal(progress.xpMax, 0);
  assert.equal(progress.nextLevelXp, null);
  assert.deepEqual(progress.skills, []);
});
