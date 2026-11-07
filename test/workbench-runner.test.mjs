import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorkbench } from '../lib/workbench-runner.mjs';

test('JavaScript fixtures check actual values, shared identity, and independent cases', async () => {
  const result = await runWorkbench({
    language: 'javascript',
    source: 'let calls = 0; function setTheme(profile) { calls++; return {...profile, settings: {...profile.settings, theme: "moon"}}; }',
    tests: [
      { id: 'identity', code: `const profile = { tags: [], settings: { theme: 'sun' } };
        const result = setTheme(profile);
        assert(result !== profile && result.tags === profile.tags, 'Keep the tags array shared.');
        assert(result.settings.theme === 'moon' && profile.settings.theme === 'sun');` },
      { id: 'fresh', code: `assert(calls === 0, 'Cases must start from a fresh state.');` },
      { id: 'failure', code: `assert(false, 'This fixture deliberately fails.');` },
    ],
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.tests.map(({ id, status }) => [id, status]), [
    ['identity', 'passed'], ['fresh', 'passed'], ['failure', 'failed'],
  ]);
  assert.equal(result.tests[2].message, 'This fixture deliberately fails.');
  assert.ok(result.tests.every(({ durationMs }) => durationMs >= 0));
  assert.ok(result.runtimeMs >= 0);
});

test('Promise cases can control completion order without timers', async () => {
  const result = await runWorkbench({
    language: 'javascript',
    source: 'const loadInOrder = (ids, load) => Promise.all(ids.map(load));',
    tests: [{ id: 'ordering', code: `const release = [];
      const result = loadInOrder(['first', 'last'], id => new Promise(resolve => release.push(() => resolve(id))));
      assert(release.length === 2, 'Start both requests.');
      release[1](); release[0]();
      assert((await result).join(',') === 'first,last', 'Keep input order.');` }],
  });
  assert.equal(result.status, 'passed');
});

test('guest constructors cannot resolve Node, browser, or network APIs', async () => {
  const result = await runWorkbench({
    language: 'javascript',
    source: `const names = () => [typeof process, typeof require, typeof fetch, typeof WebSocket,
      typeof document, typeof setTimeout, ({}).constructor.constructor('return typeof process')()];`,
    tests: [{ id: 'guest', code: `assert(names().every(value => value === 'undefined'));` }],
  });
  assert.equal(result.status, 'passed');
});

test('submission code cannot replace assertion helpers or their built-ins', async () => {
  const result = await runWorkbench({
    language: 'javascript',
    source: `const assert = () => {}; const Object = {is: () => true};
      function bad() { return 9; }`,
    tests: [{ id: 'protected', code: `assert(Object.is(bad(), 3), 'Wrong result.');` }],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.tests[0].message, 'Wrong result.');
});

test('syntax errors, interrupted loops, and stalled async tests are distinct', async () => {
  const fixtures = [{ id: 'run', code: 'await work();' }];
  const invalid = await runWorkbench({ language: 'javascript', source: 'function {', tests: fixtures });
  assert.equal(invalid.status, 'compile_error');
  assert.equal(invalid.tests.length, 0);
  assert.ok(invalid.diagnostics[0].message);

  for (const body of ['while (true) {}', 'return new Promise(() => {});', 'const loop = () => Promise.resolve().then(loop); return loop();']) {
    const hung = await runWorkbench({
      language: 'javascript', source: `function work() { ${body} }`, tests: fixtures, limits: { timeoutMs: 60 },
    });
    assert.equal(hung.status, 'timeout', body);
    assert.equal(hung.tests[0].status, 'timeout');
  }
});

test('resource limits and untrusted thrown values cannot manufacture a pass', async () => {
  const tests = [{ id: 'run', code: 'await work();' }];
  for (const source of [
    'function work() { return new Uint8Array(64 * 1024 * 1024); }',
    'function work() { throw {get message() { while (true) {} }}; }',
  ]) {
    const result = await runWorkbench({ language: 'javascript', source, tests, limits: { memoryBytes: 4 * 1024 * 1024 } });
    assert.equal(result.status, 'failed');
    assert.equal(result.tests[0].status, 'failed');
  }
});

test('TypeScript checks compiler-only contracts and runs emitted JavaScript', async () => {
  const typeTests = [{ id: 'keys', code: `const names: string[] = getValues([{ label: 'x' }], 'label');
    // @ts-expect-error non-existent key
    getValues([{ label: 'x' }], 'missing');` }];
  const runtimeTests = [{ id: 'behavior', code: `assert(getValues([{ n: 2 }, { n: 4 }], 'n').join(',') === '2,4');` }];
  const correct = await runWorkbench({
    language: 'typescript',
    source: 'function getValues<T, K extends keyof T>(values: readonly T[], key: K): T[K][] { return values.map(item => item[key]); }',
    tests: runtimeTests,
    typeTests,
  });
  assert.equal(correct.status, 'passed', JSON.stringify(correct));
  assert.deepEqual(correct.tests.map(({ id, status }) => [id, status]), [['keys', 'passed'], ['behavior', 'passed']]);

  const loose = await runWorkbench({
    language: 'typescript',
    source: 'function getValues(values: any[], key: string): any[] { return values.map(item => item[key]); }',
    tests: runtimeTests,
    typeTests,
  });
  assert.equal(loose.status, 'failed');
  assert.equal(loose.tests[0].id, 'keys');
  assert.equal(loose.tests[0].status, 'failed');
});

test('TypeScript rejects compilation errors, suppression, and non-bundled file references', async () => {
  const tests = [{ id: 'truth', code: 'assert(true);' }];
  for (const source of [
    'const n: number = "a";',
    '// @ts-nocheck\nconst n: number = "a";',
    '/// <reference path="../../package.json" />\nconst n = 1;',
    'import fs from "node:fs"; const n = fs;',
  ]) {
    const result = await runWorkbench({ language: 'typescript', source, tests });
    assert.equal(result.status, 'compile_error', source);
    assert.equal(result.tests.length, 0);
    assert.ok(result.diagnostics[0].message);
  }
});

test('TypeScript can exercise a public export through a virtual module', async () => {
  const result = await runWorkbench({
    language: 'typescript',
    source: `export type Decision = 'north' | 'south';
      export function route(value: Decision): number { return value === 'north' ? 1 : 2; }`,
    typeTests: [{ id: 'contract', code: `import { route, type Decision } from './submission';
      const direction: Decision = 'south';
      const dock: number = route(direction);
      // @ts-expect-error unsupported route
      route('west');` }],
    tests: [{ id: 'behavior', code: `assert(submission.route('north') === 1 && submission.route('south') === 2);` }],
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
});

test('unsupported languages and empty or repeated fixture IDs fail closed', async () => {
  for (const [language, tests] of [
    ['rust', [{ id: 'r', code: 'assert(true);' }]],
    ['javascript', []],
    ['javascript', [{ id: 'r', code: 'assert(true);' }, { id: 'r', code: 'assert(true);' }]],
  ]) {
    const result = await runWorkbench({ language, source: 'const test = 1;', tests });
    assert.equal(result.status, 'runner_error');
    assert.equal(result.tests.length, 0);
  }
});
