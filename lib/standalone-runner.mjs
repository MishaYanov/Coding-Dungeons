import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { goWasiHarness, rustWasiHarness } from './standalone-runner-harness.mjs';

const paths = { broker: 'broker.exe', worker: 'wasm-worker/wasm-worker.exe', rust: 'rust/bin/rustc.exe', go: 'go/bin/go.exe' };
const languages = ['rust', 'go'];
const probePass = 'LPAC, file isolation, loopback denial, and job cleanup verified.';
const moduleLimit = 16 * 1024 * 1024;
const diagnosticsLimit = 16 * 1024;
const sourceLimit = 48 * 1024;
const unavailableReasons = {
  platform: 'The bundled runner requires 64-bit Windows.',
  files: 'The native runner bundle is missing or incomplete. Reinstall Coding Dungeons from the full Windows setup.',
  integrity: 'A native runner file did not match its checksum. Reinstall Coding Dungeons from the full Windows setup.',
  'app-container': 'The app is already running in a Windows AppContainer. Open Coding Dungeons directly from the Windows Start menu.',
  'probe-launch': 'Windows could not start the native runner broker.',
  'probe-timeout': 'The Windows isolation check timed out. Restart the app to try again.',
  'probe-failed': 'The native runner did not pass its Windows isolation check.',
  'process-launch': 'Windows could not launch the isolated test process.',
  'probe-process': 'The restricted test process did not pass the Windows isolation check.',
  runtime: 'The Windows sandbox failed during a run and disabled the runner for this session.',
};

function result(status, { tests = [], compileMs = 0, runtimeMs = 0, message } = {}) {
  return { status, tests, compileMs, runtimeMs, diagnostics: message ? [{ message }] : [] };
}

function runBroker(executable, args, timeoutMs, signal) {
  if (signal?.aborted) return Promise.resolve({ code: null, reason: 'canceled', stdout: '' });
  return new Promise(resolveCommand => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let length = 0;
    let reason;
    let killTimer;
    const stop = cause => {
      if (reason) return;
      reason = cause;
      // Closing the private broker pipe lets it stop its job and release the
      // temporary ACLs. The hard stop closes the job handle if it hangs.
      child.stdin.end();
      killTimer = setTimeout(() => child.kill(), 2_000);
    };
    const onAbort = () => stop('canceled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length <= diagnosticsLimit) stdout.push(chunk);
      else stop('output');
    });
    child.stderr.on('data', chunk => {
      length += chunk.length;
      if (length <= diagnosticsLimit) stderr.push(chunk);
      else stop('output');
    });
    child.stdin.on('error', () => {});
    child.once('error', () => { reason ??= 'spawn'; });
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolveCommand({ code, reason, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

async function boundedFile(path, root, maximum) {
  const absolute = resolve(path);
  const within = relative(root, absolute);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Unsafe native runner path');
  const info = await lstat(path);
  if (!info.isFile() || !samePath(await realpath(path), absolute) || info.size > maximum) throw new Error('Unsafe native runner file');
  return path;
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function probeProblem({ reason, stderr = '' }) {
  if (reason === 'spawn') return 'probe-launch';
  if (reason === 'timeout') return 'probe-timeout';
  if (stderr.includes('outside an existing AppContainer')) return 'app-container';
  if (stderr.startsWith('CreateProcessW LPAC')) return 'process-launch';
  if (stderr.startsWith('The restricted process did not pass the isolation probe')) return 'probe-process';
  return 'probe-failed';
}

async function checkBundle(directory, command) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) return null;
  const root = await realpath(directory);
  if (!samePath(root, resolve(directory))) return null;
  const manifestPath = await boundedFile(join(root, 'native-runner.json'), root, 4096);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const selected = manifest.languages;
  if (manifest.version !== 1 || !Array.isArray(selected) || !selected.length || selected.length > languages.length
      || selected.some(language => !languages.includes(language)) || new Set(selected).size !== selected.length) return null;
  for (const name of [paths.broker, paths.worker, ...selected.map(language => paths[language])]) {
    const expected = manifest.executables?.[name];
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) return null;
    const executable = await boundedFile(join(root, ...name.split('/')), root, 128 * 1024 * 1024);
    const actual = createHash('sha256').update(await readFile(executable)).digest('hex');
    if (actual !== expected.toLowerCase()) return { problem: 'integrity' };
  }
  const scratch = await mkdtemp(join(tmpdir(), 'coding-dungeons-native-'));
  try {
    const executable = join(root, paths.broker);
    const probe = await command(executable, ['probe', scratch], 15_000);
    if (probe.code !== 0 || probe.reason || probe.stdout.trim() !== probePass) {
      const problem = probeProblem(probe);
      const windowsCode = problem === 'process-launch'
        ? /^CreateProcessW LPAC failed \(Windows error (\d{1,10})\)\./.exec(probe.stderr)?.[1] : undefined;
      return { problem, windowsCode };
    }
    return { executable, languages: selected };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 40 });
  }
}

async function requireArtifact(directory, name) {
  const path = join(directory, name);
  return boundedFile(path, directory, moduleLimit);
}

async function compilerMessage(scratch, directory, language) {
  try {
    const log = await boundedFile(join(scratch, `${directory}.log`), scratch, diagnosticsLimit);
    const text = await readFile(log, 'utf8');
    const source = language === 'rust' ? 'submission.rs' : 'submission.go';
    const line = text.split(/\r?\n/).find(value => value.includes(`${source}:`));
    if (line) return line.slice(line.indexOf(source), line.indexOf(source) + 320);
  } catch {
    // Fixture diagnostics are private and the log is optional.
  }
  return 'The compiler rejected the submission.';
}

function statusForCompile(run) {
  if (run.code === 0 && !run.reason) return 'passed';
  if (run.reason === 'timeout' || run.code === 124 || run.code === 125) return 'timeout';
  if (run.reason || run.code === 126 || run.code === null) return 'runner_error';
  return 'compile_error';
}

function elapsed(start) {
  return Math.round(performance.now() - start);
}

function containsGoDirective(source) {
  // The compiler consumes directives only from comments. Matching quoted and
  // raw literals first keeps their contents out of the comment scan.
  const tokens = /"(?:\\[^\n]|[^"\\\n])*"|'(?:\\[^\n]|[^'\\\n])*'|`[^`]*`|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
  for (const [token] of source.matchAll(tokens)) {
    if (/^(?:\/\/(?:go:|line )|\/\*line )/.test(token.replaceAll('\r', ''))) return true;
  }
  return false;
}

function awaitBundle(pending, signal) {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolveBundle => {
    const onAbort = () => resolveBundle(null);
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then(bundle => {
      signal.removeEventListener('abort', onAbort);
      resolveBundle(bundle);
    });
  });
}

export function createStandaloneRunner({
  directory = process.env.DUNGEONS_NATIVE_RUNNER_DIR, platform = process.platform,
  architecture = process.arch, command = runBroker,
} = {}) {
  let startup;
  let active = false;
  const failed = new Set();
  const readBundle = () => {
    if (platform !== 'win32' || architecture !== 'x64') return Promise.resolve({ problem: 'platform' });
    startup ??= checkBundle(directory, command).catch(() => null);
    return startup;
  };

  async function diagnostics(language) {
    const bundle = await readBundle();
    const reason = bundle?.problem ?? (!bundle?.languages.includes(language) ? 'files' : failed.has(language) ? 'runtime' : null);
    if (!reason) return { available: true };
    const detail = bundle?.windowsCode
      ? `${unavailableReasons[reason]} Windows error ${bundle.windowsCode}.` : unavailableReasons[reason];
    return { available: false, reason, detail };
  }

  async function status(language) {
    return (await diagnostics(language)).available;
  }

  async function grade({ language, source, exercise, tests, caseIds, signal } = {}) {
    if (signal?.aborted) return result('canceled');
    const bundle = await awaitBundle(readBundle(), signal);
    if (signal?.aborted) return result('canceled');
    if (!bundle?.languages?.includes(language) || failed.has(language)) return result('unavailable');
    if (active) return result('runner_error', { message: 'The native runner is busy.' });
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > sourceLimit) {
      return result('runner_error', { message: 'The submission is missing or exceeds the size limit.' });
    }
    if (language === 'go' && containsGoDirective(source)) {
      return result('compile_error', { message: 'Remove Go compiler directives before running this challenge.' });
    }
    let harness;
    try {
      harness = language === 'rust' ? rustWasiHarness(exercise) : goWasiHarness(tests);
    } catch {
      return result('runner_error', { message: 'The native suite definition is invalid.' });
    }
    const selected = caseIds ?? harness.ids;
    if (!Array.isArray(selected) || !selected.length || selected.length > harness.ids.length
        || selected.some(id => !harness.ids.includes(id)) || new Set(selected).size !== selected.length) {
      return result('runner_error', { message: 'The native case list is invalid.' });
    }
    active = true;
    let scratch;
    try {
      scratch = await mkdtemp(join(tmpdir(), 'coding-dungeons-native-'));
      const stage = join(scratch, 'compile');
      await mkdir(stage);
      const started = performance.now();
      const invoke = (operation, workspace, timeout, args = []) => {
        if (signal?.aborted) return Promise.resolve({ code: null, reason: 'canceled' });
        const remaining = Math.round(45_000 - (performance.now() - started));
        if (remaining <= 0) return Promise.resolve({ code: null, reason: 'timeout' });
        return command(bundle.executable, [operation, workspace, ...args], Math.min(timeout, remaining), signal);
      };
      const rust = language === 'rust';
      await writeFile(join(stage, rust ? 'submission.rs' : 'submission.go'), source, { flag: 'wx' });
      if (!rust) await writeFile(join(stage, 'harness.go'), harness.source, { flag: 'wx' });
      const compile = await invoke(rust ? 'rust-compile' : 'go-compile', stage, 20_000);
      if (signal?.aborted || compile.reason === 'canceled' || compile.code === 127) return result('canceled', { compileMs: elapsed(started) });
      const compileStatus = statusForCompile(compile);
      if (compileStatus !== 'passed') {
        if (compile.code === 126) failed.add(language);
        return result(compileStatus, { compileMs: elapsed(started),
          message: compileStatus === 'compile_error' ? await compilerMessage(scratch, 'compile', language) : 'The sandbox could not complete compilation.' });
      }

      let linked = stage;
      if (rust) {
        linked = join(scratch, 'link');
        await mkdir(linked);
        const library = await requireArtifact(stage, 'libferrum_submission.rlib');
        await copyFile(library, join(linked, 'libferrum_submission.rlib'));
        await writeFile(join(linked, 'harness.rs'), harness.source, { flag: 'wx' });
        const link = await invoke('rust-link', linked, 20_000);
        if (signal?.aborted || link.reason === 'canceled' || link.code === 127) return result('canceled', { compileMs: elapsed(started) });
        const linkStatus = statusForCompile(link);
        if (linkStatus !== 'passed') {
          if (link.code === 126) failed.add(language);
          return result(linkStatus, { compileMs: elapsed(started), message: 'The submission could not link with the challenge suite.' });
        }
      }
      const artifact = await requireArtifact(linked, 'trial.wasm');
      const execution = join(scratch, 'execute');
      await mkdir(execution);
      await copyFile(artifact, join(execution, 'trial.wasm'));
      const compileMs = elapsed(started);
      const runStarted = performance.now();
      const reports = [];
      for (const id of selected) {
        const caseStarted = performance.now();
        const run = await invoke('case', execution, 6500, [String(harness.ids.indexOf(id))]);
        if (signal?.aborted || run.reason === 'canceled' || run.code === 127) {
          return result('canceled', { tests: reports, compileMs, runtimeMs: elapsed(runStarted) });
        }
        const timedOut = run.reason === 'timeout' || run.code === 11 || run.code === 124;
        if (!timedOut && (run.reason || ![0, 10].includes(run.code))) {
          if (run.code === 126) failed.add(language);
          return result('runner_error', { tests: reports, compileMs, runtimeMs: elapsed(runStarted),
            message: 'The sandbox could not complete the suite.' });
        }
        reports.push({ id, status: timedOut ? 'timeout' : run.code === 0 ? 'passed' : 'failed', durationMs: elapsed(caseStarted) });
        if (timedOut) return result('timeout', { tests: reports, compileMs, runtimeMs: elapsed(runStarted) });
      }
      return result(reports.every(report => report.status === 'passed') ? 'passed' : 'failed',
        { tests: reports, compileMs, runtimeMs: elapsed(runStarted) });
    } catch {
      return result('runner_error', { message: 'The sandbox could not prepare a valid challenge artifact.' });
    } finally {
      try { if (scratch) await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 40 }); }
      finally { active = false; }
    }
  }

  return { status, grade, diagnostics };
}
