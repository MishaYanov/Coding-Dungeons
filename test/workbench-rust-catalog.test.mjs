import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import catalog, { rustBossCoverage } from '../data/workbench/rust.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../server.mjs', import.meta.url)));
const tempRoot = join(root, 'state');
const rustc = process.env.FERRUM_TEST_RUSTC ?? 'rustc';
const flags = ['--edition=2024', '--color=never'];
const pages = JSON.parse(await readFile(new URL('../data/pages.json', import.meta.url), 'utf8'));
const options = { cwd: root, timeout: 30_000, windowsHide: true, maxBuffer: 128 * 1024 };

test('every previously ungraded Rust code boss has a documented coverage decision', () => {
  const uncovered = pages.filter(page => page.prompts.some(prompt =>
    prompt.id === `boss-${page.level}` && prompt.type === 'code' && !prompt.exerciseId));
  assert.deepEqual(rustBossCoverage.map(({ level }) => level), uncovered.map(({ level }) => level));
  const executable = rustBossCoverage.filter(item => item.status === 'executable-component');
  assert.deepEqual(catalog.map(({ level }) => level), executable.map(({ level }) => level));
  assert.equal(new Set(catalog.map(({ id }) => id)).size, catalog.length);
  for (const { reason } of rustBossCoverage) assert.ok(reason.trim());
  for (const { id, starter, reference, testNames, tests } of catalog) {
    assert.match(id, /^[a-z][a-z0-9-]+$/);
    assert.match(starter, /\btodo!\s*\(/);
    assert.doesNotMatch(reference, /\btodo!\s*\(/);
    assert.ok(testNames.length >= 2 && testNames.length <= 24);
    assert.deepEqual([...tests.matchAll(/#\[test\]\s*fn ([a-z_][a-z0-9_]*)\(\)/g)].map(match => match[1]), testNames);
    assert.equal(new Set(testNames).size, testNames.length);
  }
});

async function compile(directory, source, tests) {
  const submission = join(directory, 'submission.rs');
  const library = join(directory, 'libferrum_submission.rlib');
  const harness = join(directory, 'harness.rs');
  const executable = join(directory, process.platform === 'win32' ? 'suite.exe' : 'suite');
  await writeFile(submission, source, 'utf8');
  const localOptions = { ...options, cwd: directory };
  await exec(rustc, [...flags, '--crate-type=rlib', '--crate-name=ferrum_submission', '-o', library, submission], localOptions);
  await writeFile(harness, `mod ferrum_tests { use ferrum_submission::*;\n${tests}\n}`, 'utf8');
  await exec(rustc, [...flags, '--test', '--crate-name=ferrum_harness', '--extern', `ferrum_submission=${library}`,
    '-o', executable, harness], localOptions);
  return executable;
}

test('Rust 2024 references satisfy the drill while their starter remains incomplete', { timeout: 180_000 }, async t => {
  try {
    const version = await exec(rustc, ['--version'], options);
    t.diagnostic(version.stdout.trim());
  } catch (error) {
    if (error.code !== 'ENOENT' || process.env.FERRUM_TEST_RUSTC || process.env.FERRUM_REQUIRE_RUSTC === '1') throw error;
    t.skip('Install rustc to verify the authored Rust workbench drills.');
    return;
  }

  await mkdir(tempRoot, { recursive: true });
  for (const { id, starter, reference, tests, testNames } of catalog) {
    await t.test(id, async () => {
      const directory = await mkdtemp(join(tempRoot, 'coding-dungeons-rust-drill-'));
      const names = testNames.map(name => `ferrum_tests::${name}`);
      const args = ['--exact', '--test-threads=1', '--color=never', ...names];
      try {
        const starterExecutable = await compile(directory, starter, tests);
        await assert.rejects(exec(starterExecutable, args, { ...options, cwd: directory }), error => {
          assert.equal(error.code, 101, error.stdout || error.stderr);
          assert.match(error.stdout, /test result: FAILED/);
          return true;
        });

        const executable = await compile(directory, reference, tests);
        const listing = await exec(executable, ['--list'], { ...options, cwd: directory });
        assert.deepEqual([...listing.stdout.matchAll(/^([^\r\n]+): test\r?$/gm)].map(match => match[1]).toSorted(), names.toSorted());
        const report = await exec(executable, args, { ...options, cwd: directory });
        assert.match(report.stdout, new RegExp(`test result: ok\\. ${names.length} passed; 0 failed; 0 ignored`));
      } finally {
        const artifacts = await readdir(directory);
        await Promise.all(artifacts.map(file => unlink(join(directory, file))));
        await rmdir(directory);
      }
    });
  }
});
