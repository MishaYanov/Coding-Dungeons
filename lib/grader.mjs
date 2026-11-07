import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const defaultImage = 'rust:1.99.1-slim-bookworm';
const script = readFileSync(new URL('../infra/run-suite.sh', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

const sourceLimit = 64 * 1024;
const testSourceLimit = 128 * 1024;
const outputLimit = 32 * 1024;
const maxTests = 24;
const controlTimeout = 2000;
const runTimeout = 27000;
const testModule = 'ferrum_tests::';

function result(verdict, output, passed = [], failed = []) {
  return { verdict, output, passed, failed };
}

function runDocker(args, { input, timeoutMs = controlTimeout, maxOutput = 4096, signal } = {}) {
  if (signal?.aborted) return Promise.resolve({code:null, reason:'canceled', stdout:'', stderr:''});
  return new Promise((resolve) => {
    // Pin invocations to the verified local socket, even if the active context changes.
    const environment = { ...process.env };
    if (args[0]?.startsWith('--host=')) {
      delete environment.DOCKER_CONTEXT;
      delete environment.DOCKER_HOST;
    }
    const child = spawn('docker', args, {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let totalBytes = 0;
    let reason = null;
    let finished = false;
    let killTimer;
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const cancel = () => stop('canceled');
    signal?.addEventListener('abort', cancel, {once:true});

    function finish(code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      if (reason) {
        child.stdin?.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }
      resolve({
        code,
        reason,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    }

    function stop(cause) {
      if (reason || finished) return;
      reason = cause;
      try {
        child.kill('SIGKILL');
      } catch {
        // The CLI may already have exited. Container cleanup uses a separate command.
      }
      killTimer = setTimeout(() => finish(null), 600);
    }

    function collect(destination, chunk) {
      if (finished || reason) return;
      const remaining = maxOutput - totalBytes;
      if (chunk.length > remaining) {
        if (remaining > 0) destination.push(chunk.subarray(0, remaining));
        stop('output_limit');
        return;
      }
      destination.push(chunk);
      totalBytes += chunk.length;
    }

    child.stdout.on('data', (chunk) => collect(stdout, chunk));
    child.stderr.on('data', (chunk) => collect(stderr, chunk));
    child.once('error', () => {
      reason ??= 'spawn_error';
      finish(null);
    });
    child.once('close', (code) => finish(code));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

function localHost(host) {
  return /^unix:\/\/\/[^\r\n\0]+$/.test(host)
    || /^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(host);
}

function validateInput({ code, tests, testNames } = {}) {
  if (typeof code !== 'string' || typeof tests !== 'string'
      || Buffer.byteLength(code, 'utf8') > sourceLimit
      || !tests.trim() || Buffer.byteLength(tests, 'utf8') > testSourceLimit
      || !Array.isArray(testNames) || !testNames.length || testNames.length > maxTests) {
    return null;
  }
  const names = [];
  const seen = new Set();
  for (const publicName of testNames) {
    if (typeof publicName !== 'string') return null;
    const bare = publicName.startsWith(testModule) ? publicName.slice(testModule.length) : publicName;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(bare) || seen.has(bare)) return null;
    seen.add(bare);
    names.push({ publicName, fullName: `${testModule}${bare}` });
  }
  return names;
}

function createArguments(name, imageId, names) {
  return [
    'create', '--name', name, '--interactive', '--rm', '--init',
    '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--user=10001:10001',
    '--cgroupns=private', '--ipc=private', '--memory=512m', '--memory-swap=512m',
    '--cpus=1.0', '--pids-limit=64', '--shm-size=8m',
    '--ulimit=core=0:0', '--ulimit=nofile=128:128', '--ulimit=fsize=8388608:8388608',
    '--tmpfs=/work:rw,exec,nosuid,nodev,size=64m,mode=1777', '--workdir=/work',
    '--env=HOME=/work', '--env=TMPDIR=/work', '--env=LC_ALL=C',
    '--env=RUST_BACKTRACE=0', '--env=RUST_TEST_NOCAPTURE=0',
    '--log-driver=none', '--no-healthcheck', '--entrypoint=/usr/bin/timeout',
    imageId, '--kill-after=2s', '24s', '/bin/sh', '-c', script, 'ferrum-runner',
    ...names.map(({ fullName }) => fullName),
  ];
}

function readPayload(encoded, limit) {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== encoded) return null;
  return bytes.toString('utf8')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '');
}

function readSuite(log, names, nativeStatus) {
  const lines = log.trim().split('\n');
  const count = lines[0]?.match(/^running (\d+) tests?$/);
  const summary = lines.at(-1)?.match(
    /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; 0 ignored; 0 measured; \d+ filtered out; finished in [\d.]+s$/,
  );
  if (!count || Number(count[1]) !== names.length || !summary) return null;

  const expected = new Set(names.map(({ fullName }) => fullName));
  const outcomes = new Map();
  // Pretty libtest output lists outcomes before it prints captured test diagnostics.
  for (const line of lines.slice(1, names.length + 1)) {
    const test = line.match(/^test (\S+)(?: - should panic)? \.\.\. (ok|FAILED)$/);
    if (!test || !expected.has(test[1]) || outcomes.has(test[1])) return null;
    outcomes.set(test[1], test[2]);
  }
  if (outcomes.size !== names.length) return null;
  const passed = [];
  const failed = [];
  for (const { publicName, fullName } of names) {
    (outcomes.get(fullName) === 'ok' ? passed : failed).push(publicName);
  }
  const success = failed.length === 0;
  const detailLines = lines.slice(names.length + 1, -1);
  if (success && detailLines.some((line) => line !== '')) return null;
  if (Number(summary[2]) !== passed.length || Number(summary[3]) !== failed.length
      || (summary[1] === 'ok') !== success || nativeStatus !== (success ? 0 : 101)) return null;
  return result(success ? 'pass' : 'fail', log.trim(), passed, failed);
}

function decodeRun(run, token, names) {
  const prefix = `FERRUM1 ${token} `;
  if (run.reason === 'timeout' || [124, 137].includes(run.code)) {
    return result('timeout', 'The Rust runner reached its time or resource limit.');
  }
  if (run.reason === 'output_limit') {
    return result('fail', 'The Rust runner exceeded its output limit.');
  }
  if (run.reason) {
    return result('error', 'The Rust runner could not complete this attempt.');
  }

  const lines = run.stdout.split('\n');
  if (lines.pop() !== '') return result('error', 'The runner returned an incomplete report.');
  const compiled = lines[0] === `${prefix}compiled`;
  if (compiled) lines.shift();

  if (run.code === 22 && lines.length === 1 && lines[0] === `${prefix}timeout`) {
    return result('timeout', 'The Rust runner reached its time or resource limit.');
  }
  if (run.code === 23 && compiled && lines.length === 1 && lines[0] === `${prefix}output_limit`) {
    return result('fail', 'The test suite exceeded its output limit.');
  }
  if (run.stderr.trim()) {
    return result('error', 'The Rust runner could not complete this attempt.');
  }
  if (lines.length !== 3 || lines[2] !== `${prefix}done`) {
    return result('error', 'The runner returned an incomplete report.');
  }
  const [header, encoded] = lines;
  if (!compiled && run.code === 20 && header === `${prefix}compile_error`) {
    const output = readPayload(encoded, 8192);
    if (output !== null) return result('compile_error', output.trim() || 'Rust compilation failed.');
  }
  if (compiled && header.startsWith(`${prefix}tests `)) {
    const status = header.slice(`${prefix}tests `.length);
    if (/^\d{1,3}$/.test(status) && Number(status) <= 255
        && run.code === (Number(status) === 0 ? 0 : 21)) {
      const log = readPayload(encoded, 16384);
      if (log !== null) {
        const complete = readSuite(log, names, Number(status));
        if (complete) return complete;
        return result('fail', 'The test harness exited without completing the expected tests.');
      }
    }
  }
  return result('error', 'The runner returned an invalid report.');
}

// The injected command runner is used only by the local grader tests.
export function createGrader({ command = runDocker,
  image = process.env.FERRUM_RUST_IMAGE ?? defaultImage,
  dockerHost = process.env.DOCKER_CONTEXT ? '' : (process.env.DOCKER_HOST ?? ''),
} = {}) {
  let busy = false;
  let probe = null;
  let pendingRemoval = null;

  async function findRunner() {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/.test(image)) return null;
    let host = dockerHost;
    if (!host) {
      const context = await command(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
      if (context.code !== 0 || context.reason) return null;
      host = context.stdout.trim();
    }
    if (!localHost(host)) return null;
    const imageInfo = await command([
      `--host=${host}`, 'image', 'inspect', '--format', '{{.Os}} {{.Id}} {{json .Config.Volumes}}', image,
    ]);
    if (imageInfo.code !== 0 || imageInfo.reason) return null;
    const match = imageInfo.stdout.trim().match(/^linux (sha256:[a-f0-9]{64}) (?:null|\{\})$/);
    return match ? { host, imageId: match[1] } : null;
  }

  function availableRunner() {
    if (!probe) {
      probe = findRunner().catch(() => null).finally(() => { probe = null; });
    }
    return probe;
  }

  async function remove(container, verifyAbsentTwice = false) {
    let absent = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const removed = await command([
        `--host=${container.host}`, 'rm', '--force', '--volumes', container.name,
      ]).catch(() => null);
      if (removed && !removed.reason) {
        if (removed.code === 0) return true;
        if (/No such (?:container|object)/i.test(removed.stderr)) {
          if (!verifyAbsentTwice || absent) return true;
          absent = true;
        }
      }
      if (attempt < 2) await delay(120);
    }
    return false;
  }

  async function runnerStatus() {
    return await availableRunner() ? 'available' : 'unavailable';
  }

  async function grade(input) {
    const names = validateInput(input ?? undefined);
    if (!names) return result('error', 'The submission or test configuration is invalid.');
    const {signal} = input;
    const canceled = () => result('canceled', 'The run was canceled.');
    if (signal?.aborted) return canceled();
    if (busy) return result('busy', 'The Rust runner is grading another attempt.');
    busy = true;
    try {
      if (pendingRemoval) {
        if (!await remove(pendingRemoval)) {
          return result('unavailable', 'The Rust runner is waiting for container cleanup.');
        }
        pendingRemoval = null;
      }
      const runner = await availableRunner();
      if (signal?.aborted) return canceled();
      if (!runner) {
        return result('unavailable', `Start the local Docker engine and load ${image} to enable Rust grading.`);
      }

      const token = randomBytes(16).toString('hex');
      const name = `ferrum-grade-${randomBytes(16).toString('hex')}`;
      const container = { host: runner.host, name };
      pendingRemoval = container;
      let outcome;
      let creationUncertain = true;
      try {
        const created = await command([
          `--host=${runner.host}`, ...createArguments(name, runner.imageId, names),
        ], { timeoutMs: 5000, signal });
        creationUncertain = ['timeout','canceled'].includes(created.reason);
        if (signal?.aborted || created.reason === 'canceled') {
          outcome = canceled();
        } else if (created.code !== 0 || created.reason || created.stderr.trim()
            || !/^[a-f0-9]{64}$/.test(created.stdout.trim())) {
          outcome = result('unavailable', 'Docker could not create the Rust runner with the required isolation.');
        } else {
          const stdin = [token, input.code, input.tests]
            .map((value, index) => index === 0 ? value : Buffer.from(value, 'utf8').toString('base64'))
            .join('\n') + '\n';
          const run = await command([
            `--host=${runner.host}`, 'start', '--attach', '--interactive', '--detach-keys=ctrl-p,ctrl-q', name,
          ], { input: stdin, timeoutMs: runTimeout, maxOutput: outputLimit, signal });
          outcome = signal?.aborted || run.reason === 'canceled' ? canceled() : decodeRun(run, token, names);
        }
      } catch {
        outcome = result('error', 'The Rust runner could not complete this attempt.');
      } finally {
        if (await remove(container, creationUncertain)) pendingRemoval = null;
        else outcome = result('error', 'The Rust runner could not confirm container cleanup.');
      }
      return outcome;
    } finally {
      busy = false;
    }
  }

  return { grade, runnerStatus };
}

export const { grade, runnerStatus } = createGrader();
