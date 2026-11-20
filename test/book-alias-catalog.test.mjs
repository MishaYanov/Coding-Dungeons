import assert from 'node:assert/strict';
import {test} from 'node:test';
import pages from '../data/pages.json' with {type:'json'};
import campaign from '../data/campaign.json' with {type:'json'};
import history from '../data/reading-revisions.json' with {type:'json'};
import {sideQuestRoutes} from '../lib/side-quests.mjs';

test('published page aliases terminate at unique current prompts, including dynamic repair drafts', () => {
  const occurrences = new Map();
  for (const page of pages) for (const prompt of page.prompts) {
    const values = occurrences.get(prompt.id) ?? [];
    values.push(page.page);
    occurrences.set(prompt.id, values);
  }
  const current = new Map([...occurrences].filter(([,values]) => values.length === 1)
    .map(([id,[page]]) => [id,page]));
  for (const route of sideQuestRoutes.values()) {
    if (route.world !== 'rust') continue;
    const page = campaign.quests.find(quest => quest.level === route.level).sidePage;
    for (const stage of route.catalog.stages) current.set(`${route.slug}-${stage.id}`,page);
  }
  assert.ok(Object.keys(history.rust).length > 0, 'The revised pagination must preserve historical prompts.');
  for (const [prior,target] of Object.entries(history.rust)) {
    const separator = prior.indexOf(':');
    const page = Number(prior.slice(0,separator));
    const promptId = prior.slice(separator+1);
    assert.ok(Number.isSafeInteger(page) && page > 0);
    assert.notEqual(page,target,prior);
    assert.equal(current.get(promptId),target,prior);
    assert.equal(Object.hasOwn(history.rust,`${target}:${promptId}`),false,`Alias chain at ${prior}`);
    assert.notEqual(promptId,'notes','Generic page notes must retain their own page identity.');
  }
});
