import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [pages, campaign] = await Promise.all([
  readJson('../data/pages.json'), readJson('../data/campaign.json'),
]);

test('every reader page has a WebP asset tagged with the current PDF revision', async () => {
  const pdf = await readFile(new URL('../public/book/ferrum-expedition.pdf', import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const revision = createHash('sha256').update(pdf).digest('hex').slice(0, 16);
  assert.equal(pages.length, 559);
  for (const [index, page] of pages.entries()) {
    const number = index + 1;
    assert.equal(page.page, number);
    assert.equal(page.image, `/book/pages/${number}.webp?v=${revision}`);
    const file = await open(new URL(`../public${page.image}`, import.meta.url));
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await file.read(header);
      assert.equal(bytesRead, 12, `page ${number}`);
      assert.equal(header.toString('ascii', 0, 4), 'RIFF', `page ${number}`);
      assert.equal(header.toString('ascii', 8, 12), 'WEBP', `page ${number}`);
    } finally {
      await file.close();
    }
  }
});

test('the campaign map, page links, and printed questions stay bound to the reader', () => {
  assert.equal(campaign.quests.length, 42);
  assert.equal(campaign.rooms.length, 3);
  const ids = new Map();
  const counts = new Map();
  for (const page of pages) {
    assert.ok(page.prompts.length > 0, `page ${page.page} has no GM card`);
    const pageIds = new Set();
    for (const prompt of page.prompts) {
      assert.ok(!pageIds.has(prompt.id), `duplicate ${prompt.id} on page ${page.page}`);
      pageIds.add(prompt.id);
      ids.set(prompt.id, page.page);
      const family = prompt.id.split('-')[0];
      counts.set(family, (counts.get(family) ?? 0) + 1);
      if (prompt.type === 'choice') {
        const options = new Set(prompt.options.map((option) => option.id));
        assert.equal(options.size, prompt.options.length);
        assert.ok(options.has(prompt.correctOption), `${prompt.id} has an invalid answer key`);
      }
    }
    for (const { x, y, w, h, page: destination, url } of page.links) {
      assert.ok([x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0
        && w > 0 && h > 0 && x + w <= 100 && y + h <= 100, `invalid link on page ${page.page}`);
      if (url) assert.equal(new URL(url).protocol, 'https:');
      else assert.ok(Number.isInteger(destination) && destination >= 1 && destination <= pages.length);
    }
  }
  assert.equal(counts.get('checkpoint'), 42);
  assert.equal(counts.get('training'), 126);
  assert.equal(counts.get('listing'), 156);
  for (const quest of campaign.quests) {
    assert.equal(ids.get(`checkpoint-${quest.level}`), quest.manualPage);
    assert.equal(ids.get(`boss-${quest.level}`), quest.bossPage);
    assert.equal(ids.get(`side-${quest.level}`), quest.sidePage);
  }
  for (const room of campaign.rooms) assert.equal(ids.get(`room-${room.id}`), room.page);
});
