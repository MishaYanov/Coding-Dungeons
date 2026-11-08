import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStandaloneRunner } from '../lib/standalone-runner.mjs';

const digest = content => createHash('sha256').update(content).digest('hex');

async function bundle(t, language) {
  const directory = await mkdtemp(join(tmpdir(), 'coding-dungeons-bundle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiler = language === 'go' ? 'go/bin/go.exe' : 'rust/bin/rustc.exe';
  const files = { 'broker.exe': 'broker', 'wasm-worker/wasm-worker.exe': 'worker', [compiler]: 'compiler' };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    await mkdir(join(directory, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(directory, ...parts), content);
  }
  await writeFile(join(directory, 'native-runner.json'), JSON.stringify({ version: 1, languages: [language],
    executables: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, digest(content)])),
  }));
  return directory;
}

const probePass = 'LPAC, file isolation, loopback denial, and job cleanup verified.';

test('native execution stays unavailable after a failed probe or an asset hash mismatch', async t => {
  const directory = await bundle(t, 'go');
  let called = 0;
  const runner = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
    command: async () => { called++; return { code: 2, stdout: '' }; },
  });
  assert.equal(await runner.status('go'), false);
  assert.equal(await runner.status('go'), false);
  assert.equal(called, 1);
  assert.equal((await runner.grade({ language: 'go', source: 'package main', tests: [] })).status, 'unavailable');
  await writeFile(join(directory, 'broker.exe'), 'tampered');
  const tampered = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
    command: async () => { called++; return { code: 0, stdout: probePass }; },
  });
  assert.equal(await tampered.status('go'), false);
  assert.equal((await tampered.diagnostics('go')).reason, 'integrity');
  assert.equal(called, 1);
});

test('offline diagnostics distinguish broker startup failures without revealing raw output', async t => {
  const directory = await bundle(t, 'rust');
  for (const [probe, reason] of [
    [{reason: 'spawn'}, 'probe-launch'],
    [{reason: 'timeout'}, 'probe-timeout'],
    [{stderr: 'The isolation probe requires a Windows desktop process outside an existing AppContainer.\nprivate path'}, 'app-container'],
    [{stderr: 'CreateProcessW LPAC failed: private path'}, 'process-launch'],
    [{stderr: 'CreateProcessW LPAC failed (Windows error 5).\nprivate path'}, 'process-launch'],
    [{stderr: 'The restricted process did not pass the isolation probe (exit 17).'}, 'probe-process'],
    [{stderr: 'private path'}, 'probe-failed'],
  ]) {
    const runner = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
      command: async () => ({ code: 2, stdout: '', ...probe }),
    });
    const diagnostic = await runner.diagnostics('rust');
    assert.equal(diagnostic.available, false);
    assert.equal(diagnostic.reason, reason);
    assert.ok(diagnostic.detail);
    assert.doesNotMatch(diagnostic.detail, /private path/);
    if (probe.stderr?.includes('Windows error 5')) assert.match(diagnostic.detail, /Windows error 5\./);
  }
});

test('Rust stages the harness after compiling the source and uses only broker case results', async t => {
  const directory = await bundle(t, 'rust');
  const calls = [];
  const runner = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
    command: async (_executable, [operation, scratch, index]) => {
      calls.push(operation);
      if (operation === 'probe') return { code: 0, stdout: probePass };
      if (operation === 'rust-compile') {
        assert.equal(await readFile(join(scratch, 'submission.rs'), 'utf8'), 'pub fn run() {}');
        await assert.rejects(readFile(join(scratch, 'harness.rs')));
        await writeFile(join(scratch, 'libferrum_submission.rlib'), 'object');
      }
      if (operation === 'rust-link') {
        assert.match(await readFile(join(scratch, 'harness.rs'), 'utf8'), /fn coding_dungeons_run_case/);
        await writeFile(join(scratch, 'trial.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
      }
      return { code: operation === 'case' && index === '1' ? 10 : 0, stdout: 'untrusted-looking pass text' };
    },
  });
  const result = await runner.grade({ language: 'rust', source: 'pub fn run() {}', exercise: {
    tests: '#[test]\nfn first() {}\n#[test]\nfn second() {}', testNames: ['first', 'second'],
  } });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.tests.map(({ id, status }) => [id, status]), [['first', 'passed'], ['second', 'failed']]);
  assert.deepEqual(calls, ['probe', 'rust-compile', 'rust-link', 'case', 'case']);
});

test('Go compiler directives cannot reach the broker, while ordinary strings and comments can', async t => {
  const directory = await bundle(t, 'go');
  const calls = [];
  const runner = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
    command: async (_executable, [operation, scratch]) => {
      calls.push(operation);
      if (operation === 'probe') return { code: 0, stdout: probePass };
      if (operation === 'go-compile') {
        await writeFile(join(scratch, 'trial.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
      }
      return { code: 0, stdout: '' };
    },
  });
  const tests = [{ id: 'case', code: 't.Helper()' }];
  for (const source of [
    'package main\nimport _ "embed"\n//go:embed harness.go\nvar sealed string',
    'package main\r\nimport _ "unsafe"\r\n//go:linkname sealed main.codingDungeonsRunCase\r\nfunc sealed(int32) int32',
    'package main\n\t//go:wasmexport coding_dungeons_run_case\nfunc answer() int32 { return 1 }',
    '//go:build go1.25\n\npackage main',
    'package main\n//line harness.go:1\nfunc main() {}',
    'package main\n/*line harness.go:1*/func main() {}',
  ]) {
    const result = await runner.grade({ language: 'go', source, tests });
    assert.equal(result.status, 'compile_error', source);
    assert.match(result.diagnostics[0].message, /compiler directives/);
  }
  assert.deepEqual(calls, ['probe']);

  const source = 'package main\n// Mention //go:embed in an ordinary comment.\n/* //go:linkname */\n'
    + 'const one = "escaped \\\" //go:embed harness.go"\nconst two = `\n//go:wasmexport sample\n`\n'
    + 'const quote = \'\\\'\'\nfunc main() {}';
  assert.equal((await runner.grade({ language: 'go', source, tests })).status, 'passed');
  assert.deepEqual(calls, ['probe', 'go-compile', 'case']);
});

test('abort reaches an active broker, removes scratch, and leaves the backend available', async t => {
  const directory = await bundle(t, 'go');
  const controller = new AbortController();
  let opened;
  const started = new Promise(resolve => { opened = resolve; });
  const runner = createStandaloneRunner({ directory, platform: 'win32', architecture: 'x64',
    command: async (_executable, [operation, scratch], _timeout, signal) => {
      if (operation === 'probe') return { code: 0, stdout: probePass };
      assert.equal(operation, 'go-compile');
      assert.equal(signal, controller.signal);
      return new Promise(resolve => {
        signal.addEventListener('abort', () => resolve({ code: 126, reason: 'canceled' }), { once: true });
        opened(scratch);
      });
    },
  });
  const pending = runner.grade({ language: 'go', source: 'package main',
    tests: [{ id: 'case', code: 't.Fatal("test")' }], signal: controller.signal });
  const scratch = await Promise.race([started, pending.then(() => { throw new Error('Broker did not start'); })]);
  controller.abort();
  assert.equal((await pending).status, 'canceled');
  await assert.rejects(readFile(join(scratch, 'submission.go')), { code: 'ENOENT' });
  assert.equal(await runner.status('go'), true);
  assert.equal((await runner.grade({ language: 'go', signal: controller.signal })).status, 'canceled');
});

test('the packaged broker compiles and runs a suite from a Windows desktop session', {
  skip: !process.env.DUNGEONS_TEST_NATIVE_BUNDLE,
}, async () => {
  const directory = process.env.DUNGEONS_TEST_NATIVE_BUNDLE;
  const manifest = JSON.parse(await readFile(join(directory, 'native-runner.json'), 'utf8'));
  assert.ok(manifest.languages.length > 0);
  const runner = createStandaloneRunner({ directory });
  for (const language of manifest.languages) {
    assert.equal(await runner.status(language), true, `${language} isolation gate`);
    const rust = language === 'rust';
    const suite = rust ? {
      language,
      source: 'pub fn answer() -> i32 { 42 }',
      exercise: { tests: '#[test]\nfn right() { assert_eq!(answer(), 42); }\n#[test]\nfn wrong() { assert_eq!(answer(), 43); }',
        testNames: ['right', 'wrong'] },
    } : {
      language,
      source: 'package main\nfunc answer() int { return 42 }\nfunc main() {}\n',
      tests: [{ id: 'right', code: 'if answer() != 42 { t.Fatal("wrong answer") }' },
        { id: 'wrong', code: 'if answer() != 43 { t.Fatalf("wrong answer %d", answer()) }' }],
    };
    const outcome = await runner.grade(suite);
    assert.equal(outcome.status, 'failed', JSON.stringify(outcome));
    assert.deepEqual(outcome.tests.map(({ id, status }) => [id, status]), [['right', 'passed'], ['wrong', 'failed']]);
  }
});
