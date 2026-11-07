import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import catalog from '../data/workbench/go.mjs';

const exec = promisify(execFile);
const { lessons } = JSON.parse(await readFile(new URL('../data/worlds/go/source.json', import.meta.url), 'utf8'));
const env = {
  ...process.env, GO111MODULE: 'off', GOENV: 'off', GOFLAGS: '', GOPROXY: 'off', GOSUMDB: 'off',
  GOTOOLCHAIN: 'local', GOWORK: 'off', CGO_ENABLED: '0', GOMAXPROCS: '2',
};
delete env.GOOS;
delete env.GOARCH;
const command = { env, timeout: 90_000, maxBuffer: 32 * 1024, windowsHide: true };
const goAvailable = await exec('go', ['version'], command).then(() => true, () => false);
if (process.env.FERRUM_REQUIRE_GO === '1' && !goAvailable) throw new Error('The pinned Go compiler is required for catalog verification.');

// This developer test runs only checked-in reference, starter, and mutant code.
// Learner submissions use the isolated Workbench backend.
async function runFixture(directory, source) {
  await writeFile(join(directory, 'submission.go'), source, 'utf8');
  try {
    await exec('go', ['test', '-p=2', '-vet=off', '-timeout=5s', '-count=1'], { ...command, cwd: directory });
    return { passed: true };
  } catch (error) {
    assert.equal(error.code, 1, error.message);
    return { passed: false, report: `${error.stdout}\n${error.stderr}` };
  }
}

function harness(tests) {
  const imports = new Set(['testing']);
  for (const fixture of tests) for (const path of fixture.imports ?? []) imports.add(path);
  const cases = tests.map(({ code }, index) => `func TestWorkbench${index}(t *testing.T) {\n${code}\n}`);
  return `package main\nimport (\n${[...imports].map(path => JSON.stringify(path)).join('\n')}\n)\n${cases.join('\n')}`;
}

test('the Go workbench covers all boss levels with public and sealed fixtures', () => {
  assert.deepEqual(catalog.map(({ level }) => level), lessons.map((_, index) => index + 1));
  assert.equal(new Set(catalog.map(({ id }) => id)).size, lessons.length);
  for (const { id, tests } of catalog) {
    assert.ok(tests.some(fixture => fixture.visibility === 'public'), id);
    assert.ok(tests.some(fixture => fixture.visibility === 'sealed'), id);
    assert.ok(tests.every(fixture => fixture.group?.trim()), id);
    assert.equal(new Set(tests.map(fixture => fixture.id)).size, tests.length, id);
  }
});

for (const { id, level, reference, tests } of catalog) {
  test(`${id} passes the Go reference and rejects the book starter`, { skip: !goAvailable && 'Go is unavailable' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dungeons-go-catalog-'));
    try {
      await writeFile(join(directory, 'workbench_test.go'), harness(tests), 'utf8');
      const correct = await runFixture(directory, reference);
      assert.equal(correct.passed, true, correct.report);
      const starter = await runFixture(directory, lessons[level - 1].starter);
      assert.equal(starter.passed, false);
    } finally {
      await Promise.allSettled([
        unlink(join(directory, 'submission.go')), unlink(join(directory, 'workbench_test.go')),
      ]);
      await rmdir(directory);
    }
  });
}

test('the Go fixtures catch a spare-capacity alias and a ready signal after cancellation', { skip: !goAvailable && 'Go is unavailable' }, async () => {
  const mutants = [
    ['go-with-tag', 'independent-storage', `package main
func withTag(tags []string, tag string) []string { return append(tags, tag) }
func main() {}`],
    ['go-wait-for-rune', 'already-canceled', `package main
import ("context"; "io")
func waitForRune(ctx context.Context, signals <-chan string) (string, error) {
  select {
  case signal, ok := <-signals:
    if !ok { return "", io.EOF }; return signal, nil
  case <-ctx.Done(): return "", ctx.Err()
  }
}
func main() {}`],
  ];
  for (const [id, caseId, source] of mutants) {
    const fixture = catalog.find(challenge => challenge.id === id).tests.find(item => item.id === caseId);
    const directory = await mkdtemp(join(tmpdir(), 'dungeons-go-mutant-'));
    try {
      await writeFile(join(directory, 'workbench_test.go'), harness([fixture]), 'utf8');
      const result = await runFixture(directory, source);
      assert.equal(result.passed, false);
      assert.match(result.report, /FAIL:\s+TestWorkbench0/, id);
    } finally {
      await Promise.allSettled([
        unlink(join(directory, 'submission.go')), unlink(join(directory, 'workbench_test.go')),
      ]);
      await rmdir(directory);
    }
  }
});
