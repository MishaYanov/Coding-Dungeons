import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import javascript from '../data/workbench/javascript.mjs';
import typescript from '../data/workbench/typescript.mjs';
import { runWorkbench } from '../lib/workbench-runner.mjs';

const catalogs = { javascript, typescript };

for (const [language, catalog] of Object.entries(catalogs)) {
  const lessonFile = new URL(`../data/worlds/${language}/source.json`, import.meta.url);
  const { lessons } = JSON.parse(await readFile(lessonFile, 'utf8'));

  test(`${language} workbench covers each boss challenge with public and sealed cases`, () => {
    assert.deepEqual(catalog.map(({ level }) => level), lessons.map((_, index) => index + 1));
    assert.equal(new Set(catalog.map(({ id }) => id)).size, lessons.length);
    for (const { id, tests, typeTests = [] } of catalog) {
      assert.ok(tests.some(fixture => fixture.visibility === 'public'), id);
      assert.ok(tests.some(fixture => fixture.visibility === 'sealed'), id);
      assert.ok(tests.every(fixture => fixture.group?.trim()), id);
      assert.equal(new Set([...tests, ...typeTests].map(fixture => fixture.id)).size, tests.length + typeTests.length, id);
    }
  });

  for (const { id, level, reference, tests, typeTests } of catalog) {
    test(`${id} passes the authored reference and rejects the book starter`, async () => {
      const run = source => runWorkbench({ language, source, tests, typeTests, limits: { totalMs: 15_000 } });
      const correct = await run(reference);
      assert.equal(correct.status, 'passed', JSON.stringify(correct));
      assert.equal(correct.tests.length, tests.length + (typeTests?.length ?? 0));
      const starter = await run(lessons[level - 1].starter);
      assert.ok(['failed', 'compile_error'].includes(starter.status), JSON.stringify(starter));
    });
  }
}

const mutants = [
  {
    id: 'js-make-badge', language: 'javascript', caseId: 'fresh-badges',
    source: `const badge = {name: '', visits: 0};
function makeBadge(rawName) { badge.name = rawName.trim().toUpperCase(); return badge; }`,
  },
  {
    id: 'js-make-latest', language: 'javascript', caseId: 'same-query-race',
    source: `function makeLatest(load, publish) {
  let current;
  return async query => {
    current = query;
    let outcome;
    try { outcome = { ok: true, value: await load(query) }; }
    catch (error) { outcome = { ok: false, error }; }
    if (current === query) publish(outcome);
  };
}`,
  },
  {
    id: 'ts-pallet-label', language: 'typescript', caseId: 'invalid-counts',
    source: 'function palletLabel(n: number): string { return `Pallets: ${Math.ceil(n / 10)}`; }',
  },
  {
    id: 'ts-parse-dock-id', language: 'typescript', caseId: 'dock-id-brand',
    source: `type DockId = string;
function parseDockId(value: unknown): DockId | undefined {
  return typeof value === 'string' && /^D-[0-9]{2}$/.test(value) ? value : undefined;
}`,
  },
];

for (const { id, language, caseId, source } of mutants) {
  test(`${id} catches a plausible regression in ${caseId}`, async () => {
    const { tests, typeTests } = catalogs[language].find(challenge => challenge.id === id);
    const result = await runWorkbench({ language, source, tests, typeTests, limits: { totalMs: 15_000 } });
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.tests.find(fixture => fixture.id === caseId)?.status, 'failed', JSON.stringify(result));
  });
}
