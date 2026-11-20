import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prerequisiteBackground} from '../lib/path-background.mjs';
import {remapBookResponses, remapBookDrafts, compatibleBookResponse} from '../lib/book-revisions.mjs';

test('background links follow the target loadout and omit only fully cleared levels', () => {
  const campaign = {quests:[{level:1, manualPage:2}, {level:2, manualPage:8},
    {level:3, manualPage:15, loadout:[2,1,2,99]}]};
  assert.deepEqual(prerequisiteBackground(campaign, 3, new Map([
    [1, {scout:true, forge:1, explain:'1'}], [2, {scout:true, forge:false, explain:true}],
  ])).map(quest => quest.level), [2]);
  assert.deepEqual(prerequisiteBackground(campaign, 3).map(quest => quest.level), [2,1]);
  assert.deepEqual(prerequisiteBackground(campaign, 99), []);
});

const revisions = {rust:{'26:boss-1':29, '58:training-4-1':62}};
test('a moved prompt retains its saved answer and assessment without changing another world', () => {
  const answer = {page:26, promptId:'boss-1', value:'owned answer', assessment:{score:60}};
  const prior = structuredClone(answer);
  assert.deepEqual(remapBookResponses('rust', [answer], revisions), [{...answer, page:29}]);
  assert.deepEqual(answer, prior);
  assert.deepEqual(remapBookResponses('go', [answer], revisions), [answer]);
  assert.deepEqual(remapBookResponses('rust', [{page:26,promptId:'notes',value:'page note'}], revisions),
    [{page:26,promptId:'notes',value:'page note'}]);
});

test('an answer written on the current page wins over an older alias in either input order', () => {
  const old = {page:26,promptId:'boss-1',value:'old'};
  const current = {page:29,promptId:'boss-1',value:'new'};
  for (const values of [[old,current], [current,old]]) {
    assert.deepEqual(remapBookResponses('rust', values, revisions), [current]);
  }
});

test('successive editions choose the most recent historical page consistently', () => {
  // The generator places the immediately preceding edition before older aliases.
  const history = {rust:{'29:boss-1':31, '26:boss-1':31}};
  const old = {page:26,promptId:'boss-1',value:'first edition'};
  const newer = {page:29,promptId:'boss-1',value:'revised answer'};
  const values = [old,newer];
  assert.equal(remapBookResponses('rust', values, history)[0].value, newer.value);
  assert.equal(compatibleBookResponse('rust',31,'boss-1',
    (page,id) => values.find(row => row.page===page && row.promptId===id),history).value,newer.value);
});

test('unsent drafts move by authored prompt identity and keep current drafts ahead of aliases', () => {
  const drafts = new Map([['29:boss-1','new draft'],['26:boss-1','older draft'],
    ['58:training-4-1','borrow model'], ['side-quest:rogue-rust','quest draft']]);
  assert.deepEqual([...remapBookDrafts('rust', drafts, revisions)], [
    ['29:boss-1','new draft'], ['62:training-4-1','borrow model'], ['side-quest:rogue-rust','quest draft'],
  ]);
  assert.equal(drafts.size, 4);
});
