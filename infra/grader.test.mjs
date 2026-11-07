import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrader } from '../lib/grader.mjs';

const host = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const digest = 'b'.repeat(64);
const exercise = {
  code: 'pub fn identity(value: u32) -> u32 { value }',
  tests: '#[test] fn exact() { assert_eq!(identity(2), 2); }',
  testNames: ['exact'],
};

function commandResult(stdout = '', code = 0, stderr = '', reason = null) {
  return { code, reason, stdout, stderr };
}

function frame(token, status, log, done = true) {
  const prefix = `FERRUM1 ${token} `;
  const compiled = status.startsWith('tests ') ? `${prefix}compiled\n` : '';
  return `${compiled}${prefix}${status}\n${Buffer.from(log).toString('base64')}\n`
    + (done ? `${prefix}done\n` : '');
}

const success = `
running 1 test
test ferrum_tests::exact ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

`;

function fixture({ start, remove } = {}) {
  const calls = [];
  const command = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === 'context') return commandResult(`${host}\n`);
    assert.equal(args[0], `--host=${host}`);
    switch (args[1]) {
      case 'image': return commandResult(`linux sha256:${digest} null\n`);
      case 'create': return commandResult(`${'a'.repeat(64)}\n`);
      case 'rm': return remove?.(args) ?? commandResult('');
      case 'start': {
        const [token, code, tests] = options.input.split('\n');
        return start?.({ token, code, tests })
          ?? commandResult(frame(token, 'tests 0', success));
      }
      default: assert.fail(`unexpected Docker command: ${args[1]}`);
    }
  };
  return { ...createGrader({ command, dockerHost: '' }), calls };
}

test('only local daemon endpoints receive commands after discovery', async () => {
  const commands = [];
  const grader = createGrader({ dockerHost: '', command: async (args) => {
    commands.push(args);
    return commandResult('ssh://other-machine.example\n');
  } });
  assert.equal(await grader.runnerStatus(), 'unavailable');
  assert.equal((await grader.grade(exercise)).verdict, 'unavailable');
  assert.deepEqual(commands.map((args) => args[0]), ['context', 'context']);
});

test('secure Docker arguments, stdin-only code, and cleanup on success', async () => {
  const code = `${exercise.code}\n// '\"; & arguments stay literal 🦀`;
  const { grade, calls } = fixture({ start: ({ token, code: encodedCode, tests }) => {
    assert.match(token, /^[a-f0-9]{32}$/);
    assert.equal(Buffer.from(encodedCode, 'base64').toString(), code);
    assert.equal(Buffer.from(tests, 'base64').toString(), exercise.tests);
    return commandResult(frame(token, 'tests 0', success));
  } });
  const output = await grade({ ...exercise, code });
  assert.equal(output.verdict, 'pass');
  assert.deepEqual(output.passed, ['exact']);
  assert.deepEqual(output.failed, []);

  const creation = calls.find(({ args }) => args[1] === 'create').args;
  for (const flag of [
    '--interactive', '--rm', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=10001:10001',
    '--pids-limit=64', '--memory=512m', '--memory-swap=512m', '--cpus=1.0',
    '--log-driver=none', '--tmpfs=/work:rw,exec,nosuid,nodev,size=64m,mode=1777',
    `sha256:${digest}`, 'ferrum_tests::exact',
  ]) assert.ok(creation.includes(flag), flag);
  assert.ok(!creation.some((arg) => /^--(?:privileged|mount|volume|env-file)(?:=|$)|^-v$/.test(arg)));
  assert.ok(!creation.join(' ').includes(code));

  const name = creation[creation.indexOf('--name') + 1];
  assert.match(name, /^ferrum-grade-[a-f0-9]{32}$/);
  const attach = calls.find(({ args }) => args[1] === 'start');
  assert.equal(attach.args.at(-1), name);
  assert.equal(attach.options.timeoutMs, 27000);
  assert.equal(attach.options.maxOutput, 32 * 1024);
  assert.deepEqual(calls.at(-1).args.slice(1), ['rm', '--force', '--volumes', name]);
});

test('normal compile and test failures have distinct verdicts', async () => {
  const compiler = fixture({ start: ({ token }) => commandResult(
    frame(token, 'compile_error', 'submission.rs:1:1: error: invalid item'), 20,
  ) });
  const compileError = await compiler.grade(exercise);
  assert.equal(compileError.verdict, 'compile_error');
  assert.match(compileError.output, /invalid item/);

  const bad = success.replace('... ok', '... FAILED')
    .replace('ok. 1 passed; 0 failed;', 'FAILED. 0 passed; 1 failed;');
  const tests = fixture({ start: ({ token }) => commandResult(frame(token, 'tests 101', bad), 21) });
  const testFailure = await tests.grade(exercise);
  assert.equal(testFailure.verdict, 'fail');
  assert.deepEqual(testFailure.passed, []);
  assert.deepEqual(testFailure.failed, ['exact']);
});

test('premature exit, wrong tests, output limit, and timeout cannot pass', async () => {
  const scenarios = [
    [(token) => commandResult(frame(token, 'tests 0', 'running 1 test\n')), 'fail'],
    [(token) => commandResult(frame(token, 'tests 0', success.replace('::exact', '::other'))), 'fail'],
    [(token) => commandResult(frame(token, 'tests 0', success, false)), 'error'],
    [(token) => commandResult(frame(token, 'tests 0', success), 0, '', 'output_limit'), 'fail'],
    [(token) => commandResult(frame(token, 'tests 0', success), 0, '', 'timeout'), 'timeout'],
    [(token) => commandResult(`FERRUM1 ${token} compiled\nFERRUM1 ${token} timeout\n`, 22, 'Killed\n'), 'timeout'],
  ];
  for (const [simulate, verdict] of scenarios) {
    const { grade, calls } = fixture({ start: ({ token }) => simulate(token) });
    const output = await grade(exercise);
    assert.equal(output.verdict, verdict);
    assert.deepEqual(output.passed, []);
    assert.equal(calls.at(-1).args[1], 'rm');
  }
});

test('admission rejects a second attempt while the only slot is occupied', async () => {
  let release;
  const finish = new Promise((resolve) => { release = resolve; });
  let onStart;
  const started = new Promise((resolve) => { onStart = resolve; });
  const { grade, calls } = fixture({ start: async ({ token }) => {
    onStart();
    await finish;
    return commandResult(frame(token, 'tests 0', success));
  } });
  const first = grade(exercise);
  await started;
  try {
    assert.equal((await grade(exercise)).verdict, 'busy');
    assert.equal(calls.filter(({ args }) => args[1] === 'create').length, 1);
  } finally {
    release();
  }
  assert.equal((await first).verdict, 'pass');
});

test('invalid and duplicate test names never reach Docker', async () => {
  const { grade, calls } = fixture();
  assert.equal((await grade({ ...exercise, testNames: ['--list'] })).verdict, 'error');
  assert.equal((await grade({ ...exercise, testNames: ['exact', 'ferrum_tests::exact'] })).verdict, 'error');
  assert.equal((await grade({ ...exercise, code: '🦀'.repeat(16385) })).verdict, 'error');
  assert.equal(calls.length, 0);
});

test('unconfirmed cleanup fails closed and is retried before reuse', async () => {
  let cleanupWorks = false;
  const { grade, calls } = fixture({ remove: () => cleanupWorks
    ? commandResult('', 1, 'Error response from daemon: No such container')
    : commandResult('', 1, 'Error response from daemon: request failed') });
  const first = await grade(exercise);
  assert.equal(first.verdict, 'error');
  assert.deepEqual(first.passed, []);
  assert.equal((await grade(exercise)).verdict, 'unavailable');
  assert.equal(calls.filter(({ args }) => args[1] === 'create').length, 1);
  cleanupWorks = true;
  assert.equal((await grade(exercise)).verdict, 'pass');
  assert.equal(calls.filter(({ args }) => args[1] === 'create').length, 2);
});
