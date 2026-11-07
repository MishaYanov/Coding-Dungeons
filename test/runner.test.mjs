import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrader } from '../lib/grader.mjs';

const host = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const image = 'rust:1.99.1-slim-bookworm';
const imageId = `sha256:${'a'.repeat(64)}`;
const input = {
  code: 'pub fn answer() -> u8 { 42 }',
  tests: '#[test] fn result_is_correct() { assert_eq!(answer(), 42); }',
  testNames: ['result_is_correct'],
};

function processResult({ code = 0, stdout = '', stderr = '', reason = null } = {}) {
  return { code, stdout, stderr, reason };
}

function passReport(options, { failed = false, status = failed ? 101 : 0, details = '' } = {}) {
  const [token] = options.input.split('\n');
  const prefix = `FERRUM1 ${token}`;
  const name = `ferrum_tests::${input.testNames[0]}`;
  const log = `\nrunning 1 test\ntest ${name} ... ${failed ? 'FAILED' : 'ok'}\n\n${details}`
    + `test result: ${failed ? 'FAILED' : 'ok'}. ${failed ? 0 : 1} passed; ${failed ? 1 : 0} failed; `
    + '0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n';
  return processResult({
    code: status === 0 ? 0 : 21,
    stdout: `${prefix} compiled\n${prefix} tests ${status}\n${Buffer.from(log).toString('base64')}\n${prefix} done\n`,
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const grader = createGrader({
    image,
    dockerHost: overrides.host ?? '',
    async command(args, options) {
      calls.push({ args, options });
      if (args[0] === 'context') return processResult({ stdout: `${host}\n` });
      assert.equal(args[0], `--host=${overrides.host ?? host}`);
      switch (args[1]) {
        case 'image': return processResult({ stdout: overrides.imageInfo ?? `linux ${imageId} null\n` });
        case 'create': return overrides.create?.() ?? processResult({ stdout: `${'b'.repeat(64)}\n` });
        case 'start': return overrides.start ? overrides.start(options) : passReport(options);
        case 'rm': return overrides.remove?.() ?? processResult();
        default: assert.fail(`Unexpected Docker command ${args[1]}`);
      }
    },
  });
  return { grader, calls };
}

test('rejects invalid source and test names before invoking Docker', async () => {
  const { grader, calls } = fixture();
  for (const candidate of [undefined, null, { ...input, code: 42 },
    { ...input, code: '🦀'.repeat(16_385) }, { ...input, tests: '' },
    { ...input, testNames: ['--list'] }, { ...input, testNames: [] },
    { ...input, testNames: ['result_is_correct', 'ferrum_tests::result_is_correct'] }]) {
    assert.equal((await grader.grade(candidate)).verdict, 'error');
  }
  assert.deepEqual(calls, []);
});

test('refuses remote engines and images that introduce volumes or use Windows', async () => {
  const remote = fixture({ host: 'tcp://127.0.0.1:2375' });
  assert.equal(await remote.grader.runnerStatus(), 'unavailable');
  assert.equal((await remote.grader.grade(input)).verdict, 'unavailable');
  assert.deepEqual(remote.calls, []);

  for (const imageInfo of [`linux ${imageId} {"/mnt":{}}`, `windows ${imageId} null`]) {
    const { grader, calls } = fixture({ imageInfo });
    assert.equal((await grader.grade(input)).verdict, 'unavailable');
    assert.deepEqual(calls.map(({ args }) => args[1]), ['inspect', 'image']);
  }
});

test('runs in a bounded local container and removes it after a passing suite', async () => {
  const { grader, calls } = fixture();
  const graded = await grader.grade(input);
  assert.equal(graded.verdict, 'pass');
  assert.deepEqual(graded.passed, input.testNames);
  assert.deepEqual(graded.failed, []);
  assert.deepEqual(calls.map(({ args }) => args[1]), ['inspect', 'image', 'create', 'start', 'rm']);
  const [inspect, create, start, remove] = calls.slice(1);
  assert.equal(inspect.args.at(-1), image);
  assert.ok(create.args.includes(imageId));
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--user=10001:10001', '--cgroupns=private', '--ipc=private',
    '--memory=512m', '--memory-swap=512m', '--cpus=1.0', '--pids-limit=64', '--log-driver=none', '--rm']) {
    assert.ok(create.args.includes(flag), flag);
  }
  assert.ok(create.args.some((arg) => arg.startsWith('--tmpfs=/work:')));
  assert.ok(create.args.some((arg) => arg.startsWith('--ulimit=fsize=')));
  assert.ok(!create.args.some((arg) => /^(?:--(?:mount|volume|privileged|device|publish)(?:=|$)|-[vp]$)/.test(arg)));
  assert.equal(create.args.at(-1), 'ferrum_tests::result_is_correct');
  const [token, code, tests, end] = start.options.input.split('\n');
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(Buffer.from(code, 'base64').toString(), input.code);
  assert.equal(Buffer.from(tests, 'base64').toString(), input.tests);
  assert.equal(end, '');
  assert.equal(start.options.maxOutput, 32 * 1024);
  assert.ok(start.options.timeoutMs < 30_000);
  const name = create.args[create.args.indexOf('--name') + 1];
  assert.match(name, /^ferrum-grade-[0-9a-f]{32}$/);
  assert.equal(start.args.at(-1), name);
  assert.deepEqual(remove.args.slice(1), ['rm', '--force', '--volumes', name]);
});

test('keeps test failure, compile diagnostics, timeout, and output limits distinct', async () => {
  const details = 'failures:\n\n---- ferrum_tests::result_is_correct stdout ----\n'
    + 'test ferrum_tests::result_is_correct ... ok\n\n';
  const failure = fixture({ start: (options) => passReport(options, { failed: true, details }) });
  const failed = await failure.grader.grade(input);
  assert.equal(failed.verdict, 'fail');
  assert.deepEqual(failed.passed, []);
  assert.deepEqual(failed.failed, input.testNames);
  assert.ok(failed.output.includes(details.trim()));

  const syntax = fixture({ start({ input: payload }) {
    const [token] = payload.split('\n');
    const message = Buffer.from('\x1b[31mexpected expression\x1b[0m\u202e').toString('base64');
    return processResult({ code: 20, stdout: `FERRUM1 ${token} compile_error\n${message}\nFERRUM1 ${token} done\n` });
  } });
  assert.deepEqual(await syntax.grader.grade(input), {
    verdict: 'compile_error', output: 'expected expression', passed: [], failed: [],
  });

  for (const [run, expected] of [[{ reason: 'timeout' }, 'timeout'], [{ code: 137 }, 'timeout'],
    [{ reason: 'output_limit' }, 'fail'], [{ reason: 'spawn_error' }, 'error']]) {
    const { grader, calls } = fixture({ start: () => processResult(run) });
    assert.equal((await grader.grade(input)).verdict, expected);
    assert.equal(calls.at(-1).args[1], 'rm');
  }
});

test('rejects incomplete, mismatched, or internally inconsistent test reports', async () => {
  for (const [start, expected] of [
    [() => processResult({ stdout: 'test result: ok.' }), 'error'],
    [(options) => ({ ...passReport(options), code: 21 }), 'error'],
    [(options) => passReport(options, { status: 101 }), 'fail'],
    [(options) => passReport(options, { status: 1, failed: true }), 'fail'],
    [(options) => passReport(options, { details: 'additional output\n' }), 'fail'],
    [(options) => ({ ...passReport(options), stderr: 'unexpected stderr\n' }), 'error'],
    [(options) => ({ ...passReport(options), stdout: passReport(options).stdout.slice(0, -1) }), 'error'],
  ]) {
    const { grader } = fixture({ start });
    assert.equal((await grader.grade(input)).verdict, expected);
  }
});

test('admits only one submission while a test suite is still running', async () => {
  const running = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { grader, calls } = fixture({ async start(options) {
    running.resolve();
    await finish.promise;
    return passReport(options);
  } });
  const first = grader.grade(input);
  await running.promise;
  try {
    assert.equal((await grader.grade(input)).verdict, 'busy');
    assert.equal(calls.filter(({ args }) => args[1] === 'create').length, 1);
  } finally {
    finish.resolve();
  }
  assert.equal((await first).verdict, 'pass');
  assert.equal((await grader.grade(input)).verdict, 'pass');
});

test('blocks new containers until a failed cleanup can be confirmed', async () => {
  let allowCleanup = false;
  const { grader, calls } = fixture({ remove() {
    return allowCleanup ? processResult() : processResult({ code: 1, stderr: 'Engine disconnected' });
  } });
  const first = await grader.grade(input);
  assert.equal(first.verdict, 'error');
  assert.match(first.output, /container cleanup/);
  assert.equal((await grader.grade(input)).verdict, 'unavailable');
  assert.equal(calls.filter(({ args }) => args[1] === 'create').length, 1);
  assert.equal(calls.filter(({ args }) => args[1] === 'rm').length, 6);
  allowCleanup = true;
  assert.equal((await grader.grade(input)).verdict, 'pass');
});

test('confirms absence twice when Docker times out during creation', async () => {
  const { grader, calls } = fixture({
    create: () => processResult({ code: null, reason: 'timeout' }),
    remove: () => processResult({ code: 1, stderr: 'Error response from daemon: No such container' }),
  });
  assert.equal((await grader.grade(input)).verdict, 'unavailable');
  assert.equal(calls.filter(({ args }) => args[1] === 'rm').length, 2);
  assert.ok(!calls.some(({ args }) => args[1] === 'start'));
});

test('grades submissions with the real Docker runner when the local image is ready', { timeout: 150_000 }, async (t) => {
  const grader = createGrader();
  if (await grader.runnerStatus() !== 'available') {
    const configuredImage = process.env.FERRUM_RUST_IMAGE ?? image;
    if (process.env.FERRUM_REQUIRE_DOCKER === '1') assert.fail(`The local Docker runner needs ${configuredImage}.`);
    t.skip(`Start Docker in Linux container mode and pull ${configuredImage} to run this test.`);
    return;
  }

  const valid = await grader.grade(input);
  assert.equal(valid.verdict, 'pass', valid.output);
  assert.deepEqual(valid.passed, input.testNames);
  const wrong = await grader.grade({ ...input, code: 'pub fn answer() -> u8 { 0 }' });
  assert.equal(wrong.verdict, 'fail', wrong.output);
  assert.deepEqual(wrong.failed, input.testNames);
  const invalid = await grader.grade({ ...input, code: 'pub fn answer() -> u8 { ? }' });
  assert.equal(invalid.verdict, 'compile_error', invalid.output);
  assert.match(invalid.output, /error/i);
  const earlyExit = await grader.grade({ ...input, code: 'pub fn answer() -> u8 { std::process::exit(0) }' });
  assert.equal(earlyExit.verdict, 'fail', earlyExit.output);
  assert.deepEqual(earlyExit.passed, []);
});
