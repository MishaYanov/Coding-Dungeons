import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const rustc = process.env.FERRUM_TEST_RUSTC ?? 'rustc';
const tempRoot = fileURLToPath(new URL('../state/', import.meta.url));
const exercises = JSON.parse(await readFile(new URL('../data/exercises.json', import.meta.url), 'utf8'));
const editionFlags = ['--edition=2024', '--error-format=short', '--color=never', '-A', 'warnings',
  '-C', 'debuginfo=0', '-C', 'strip=debuginfo'];
const library = 'libferrum_submission.rlib';
const suite = process.platform === 'win32' ? 'suite.exe' : 'suite';
const harness = `mod ferrum_tests {
    use ferrum_submission::*;
    include!("tests.rs");
}
`;

const negativeProbes = {
  'cargo-handoff': ['E0382', `
    fn probe() {
        let mut dock = Dock::new(4);
        let capsule = Capsule::new(1, vec![2]);
        let _ = dock.submit(capsule);
        let _ = capsule.bytes();
    }
  `],
  'manifest-scope': [/lifetime may not live long enough/, `
    fn probe() {
        let _ = inspect_manifest("east:1", |rows| rows[0].station.as_str());
    }
  `],
  'lending-windows': ['E0499', `
    fn probe() {
        let mut bytes = [0, 1, 2];
        let mut windows = WindowsMut::new(&mut bytes, 2);
        let first = windows.next().unwrap();
        let second = windows.next().unwrap();
        assert_eq!(first[1], second[0]);
    }
  `],
  'dispatch-ticket': ['E0599', `
    fn probe() {
        let draft = Ticket::new(1, 2, vec![]);
        let _ = draft.dispatch(Handoff::Acknowledged);
    }
  `],
  'last-sequence': ['E0599', `
    fn probe() {
        let mut closed = Connection::at_sequence(0).close();
        let _ = closed.send(vec![]);
    }
  `],
};

function run(command, args, cwd) {
  return exec(command, args, { cwd, timeout: 30_000, windowsHide: true, maxBuffer: 128 * 1024 });
}

async function compileLibrary(directory, source) {
  await writeFile(join(directory, 'submission.rs'), source);
  await run(rustc, [...editionFlags, '--crate-type=rlib', '--crate-name', 'ferrum_submission',
    '-o', library, 'submission.rs'], directory);
}

async function compileHarness(directory) {
  await run(rustc, [...editionFlags, '--test', '--crate-name', 'ferrum_harness',
    '--extern', `ferrum_submission=${library}`, '-o', suite, 'harness.rs'], directory);
}

test('exercise IDs, level bindings, and test names are unique and usable', () => {
  assert.ok(exercises.length > 0);
  assert.equal(new Set(exercises.map(({ id }) => id)).size, exercises.length);
  assert.equal(new Set(exercises.map(({ level }) => level)).size, exercises.length);
  for (const { id, level, testNames, starter, solution } of exercises) {
    assert.match(id, /^[a-z][a-z0-9-]+$/);
    assert.ok(Number.isInteger(level) && level > 0);
    assert.ok(testNames.length > 0 && testNames.length <= 24, id);
    assert.equal(new Set(testNames).size, testNames.length, id);
    for (const name of testNames) assert.match(name, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
    assert.match(starter, /\btodo!\s*\(/, id);
    assert.doesNotMatch(solution, /\btodo!\s*\(/, id);
  }
  for (const id of Object.keys(negativeProbes)) assert.ok(exercises.some((exercise) => exercise.id === id), id);
});

test('Rust 2024 exercises compile and their exact advertised tests discriminate between starter and reference',
  { concurrency: 3, timeout: 150_000 }, async (t) => {
    try {
      const { stdout } = await run(rustc, ['--version']);
      t.diagnostic(stdout.trim());
    } catch (error) {
      if (error.code !== 'ENOENT' || process.env.FERRUM_TEST_RUSTC || process.env.FERRUM_REQUIRE_RUSTC === '1') {
        throw error;
      }
      t.skip('Install rustc or set FERRUM_TEST_RUSTC to validate the exercise code.');
      return;
    }

    await mkdir(tempRoot, { recursive: true });
    await Promise.all(exercises.map((exercise) => t.test(exercise.id, { timeout: 65_000 }, async (t) => {
      const directory = await mkdtemp(join(tempRoot, 'ferrum-rust-'));
      t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }));
      const executable = join(directory, suite);
      const names = exercise.testNames.map((name) => `ferrum_tests::${name}`);
      const testArgs = ['--exact', '--format=pretty', '--color=never', '--test-threads=1', ...names];

      // Match the container order: the learner library compiles before the test source is present.
      await compileLibrary(directory, exercise.starter);
      await writeFile(join(directory, 'harness.rs'), harness);
      await writeFile(join(directory, 'tests.rs'), exercise.tests);
      await compileHarness(directory);
      await assert.rejects(run(executable, testArgs, directory), (error) => {
        assert.equal(error.code, 101, error.stdout || error.stderr);
        assert.match(error.stdout, /test result: FAILED\./);
        return true;
      });

      await rm(join(directory, 'tests.rs'));
      await compileLibrary(directory, exercise.solution);
      await writeFile(join(directory, 'tests.rs'), exercise.tests);
      await compileHarness(directory);
      const { stdout: listing } = await run(executable, ['--list'], directory);
      const discovered = [...listing.matchAll(/^([^\r\n]+): test\r?$/gm)].map((match) => match[1]);
      assert.deepEqual(discovered.toSorted(), names.toSorted());
      const { stdout: report } = await run(executable, testArgs, directory);
      assert.match(report, new RegExp(`test result: ok\\. ${names.length} passed; 0 failed; 0 ignored;`));

      const negative = negativeProbes[exercise.id];
      if (negative) {
        const [diagnostic, code] = negative;
        await writeFile(join(directory, 'probe.rs'), `use ferrum_submission::*;\n${code}`);
        await assert.rejects(run(rustc, [...editionFlags, '--crate-type=lib', '--emit=metadata',
          '--extern', `ferrum_submission=${library}`, 'probe.rs'], directory), (error) => {
          assert.equal(error.code, 1, error.stderr);
          if (typeof diagnostic === 'string') assert.ok(error.stderr.includes(diagnostic), error.stderr);
          else assert.match(error.stderr, diagnostic);
          return true;
        });
      }
    })));
  });
