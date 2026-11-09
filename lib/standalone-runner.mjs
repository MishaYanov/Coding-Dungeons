import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { goWasiHarness, rustWasiHarness } from './standalone-runner-harness.mjs';

const paths = { broker: 'broker.exe', probe: 'sandbox-probe.exe', worker: 'wasm-worker/wasm-worker.exe' };
const compilerFiles = {
  rust: ['rust/bin/rustc.exe', 'rust/wasm-linker.exe'],
  go: ['go/pkg/tool/windows_amd64/compile.exe', 'go/pkg/tool/windows_amd64/link.exe', 'go/stdlib/packages.txt'],
};
const workerCompanions = ['hostfxr.dll', 'hostpolicy.dll', 'coreclr.dll', 'clrjit.dll', 'System.Private.CoreLib.dll',
  'wasmtime.dll', 'Wasmtime.Dotnet.dll', 'wasm-worker.dll', 'wasm-worker.deps.json', 'wasm-worker.runtimeconfig.json'];
const rustWasiLibraries = 'rust/lib/rustlib/wasm32-wasip1/lib';
const rustWasiCrates = ['alloc', 'compiler_builtins', 'core', 'panic_abort', 'std', 'wasip1'];
const languages = Object.keys(compilerFiles);
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
  'probe-token': 'Windows could not verify the restricted test process token.',
  'probe-network-policy': 'Windows could not verify that the restricted test process had no loopback exemption.',
  'probe-process': 'The restricted test process did not pass the Windows isolation check.',
  runtime: 'The Windows sandbox failed during a run and disabled the runner for this session.',
};
const probeChecks = {
  10: 'The test could not read its input file.',
  11: 'The test could not confirm that the private file was blocked.',
  12: 'The test could not confirm that loopback access was blocked.',
  13: 'The test could not confirm that child process creation was blocked.',
  14: 'The test could not write or rename a file in its scratch folder.',
  15: 'The test could not write to its output handle.',
};
const probeNetworkSteps = ['initialize Winsock', 'create a TCP socket', 'connect to loopback'];

function probeExitDetail(exit) {
  if (probeChecks[exit]) return probeChecks[exit];
  const step = probeNetworkSteps[Math.floor(exit / 100000) - 1];
  const error = exit % 100000;
  if (step && error >= 10000 && error < 12000) return `The test could not ${step} (Winsock error ${error}).`;
  return `Process exit 0x${(exit >>> 0).toString(16).toUpperCase().padStart(8, '0')}.`;
}

function result(status, { tests = [], compileMs = 0, runtimeMs = 0, message } = {}) {
  return { status, tests, compileMs, runtimeMs, diagnostics: message ? [{ message }] : [] };
}

export function nativeBrokerEnvironment(host = process.env) {
  const entries = Object.entries(host);
  const windowsVariable = name => entries.find(([key, value]) => key.toUpperCase() === name && value)?.[1];
  const localAppData = windowsVariable('LOCALAPPDATA');
  return {
    SystemRoot: windowsVariable('SYSTEMROOT') ?? 'C:\\Windows',
    // Windows resolves the AppContainer profile using the broker's environment.
    ...(localAppData ? { LOCALAPPDATA: localAppData } : {}),
  };
}

function runBroker(executable, args, timeoutMs, signal) {
  if (signal?.aborted) return Promise.resolve({ code: null, reason: 'canceled', stdout: '' });
  return new Promise(resolveCommand => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env: nativeBrokerEnvironment(),
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

async function boundedFile(path, root, maximum, minimum = 0) {
  const absolute = resolve(path);
  const within = relative(root, absolute);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Unsafe native runner path');
  const info = await lstat(path);
  if (!info.isFile() || !samePath(await realpath(path), absolute) || info.size > maximum || info.size < minimum) {
    throw new Error('Unsafe native runner file');
  }
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
  if (stderr.startsWith('Verify sandbox token failed')) return 'probe-token';
  if (stderr.startsWith('Verify sandbox loopback policy failed')) return 'probe-network-policy';
  if (stderr.startsWith('The restricted process did not pass the isolation probe')) return 'probe-process';
  return 'probe-failed';
}

async function requireBundleFile(root, name, maximum = 128 * 1024 * 1024) {
  return boundedFile(join(root, name), root, maximum, 1);
}

async function checkCompilerCompanions(root, language) {
  try {
    if (language === 'go') {
      const index = await boundedFile(join(root, 'go/stdlib/packages.txt'), root, 65536, 1);
      const rows = (await readFile(index, 'utf8')).split(/\r?\n/);
      if (rows.at(-1) === '') rows.pop();
      const packages = new Map();
      for (const row of rows) {
        const match = /^([A-Za-z0-9_./-]+) ([0-9]{4}\.a)$/.exec(row);
        if (!match || packages.has(match[1])) return false;
        packages.set(match[1], match[2]);
      }
      if (!packages.has('runtime')) return false;
      await Promise.all([...packages.values()].map(name => requireBundleFile(root, `go/stdlib/${name}`)));
    } else {
      const drivers = (await readdir(join(root, 'rust/bin'))).filter(name => /^rustc_driver-.+\.dll$/i.test(name));
      if (drivers.length !== 1) return false;
      const libraryNames = await readdir(join(root, rustWasiLibraries));
      const crates = rustWasiCrates.map(crate => libraryNames.find(name =>
        name.startsWith(`lib${crate}-`) && name.endsWith('.rlib')));
      if (crates.includes(undefined)) return false;
      await requireBundleFile(root, `rust/bin/${drivers[0]}`, 256 * 1024 * 1024);
      await Promise.all([`${rustWasiLibraries}/self-contained/libc.a`,
        ...crates.map(name => `${rustWasiLibraries}/${name}`)].map(name => requireBundleFile(root, name)));
    }
    return true;
  } catch {
    return false;
  }
}

async function readBundleAssets(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) return null;
  const root = await realpath(directory);
  if (!samePath(root, resolve(directory))) return null;
  const manifestPath = await boundedFile(join(root, 'native-runner.json'), root, 4096);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const selected = manifest.languages;
  if (manifest.version !== 1 || !Array.isArray(selected) || !selected.length || selected.length > languages.length
      || selected.some(language => !languages.includes(language)) || new Set(selected).size !== selected.length) return null;
  for (const name of [paths.broker, paths.probe, paths.worker, ...selected.flatMap(language => compilerFiles[language])]) {
    const expected = manifest.executables?.[name];
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) return null;
    const executable = await requireBundleFile(root, name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(executable)) hash.update(chunk);
    if (hash.digest('hex') !== expected.toLowerCase()) return { problem: 'integrity' };
  }
  await Promise.all(workerCompanions.map(name => requireBundleFile(root, `wasm-worker/${name}`)));
  const complete = await Promise.all(selected.map(language => checkCompilerCompanions(root, language)));
  const available = selected.filter((_language, index) => complete[index]);
  return available.length ? { executable: join(root, paths.broker), languages: available } : null;
}

export async function inspectNativeRunnerAssets(directory) {
  return readBundleAssets(directory).catch(() => null);
}

async function checkBundle(directory, command) {
  const assets = await inspectNativeRunnerAssets(directory);
  if (!assets || assets.problem) return assets;
  const scratch = await mkdtemp(join(tmpdir(), 'coding-dungeons-native-'));
  try {
    const probe = await command(assets.executable, ['probe', scratch], 15_000);
    if (probe.code !== 0 || probe.reason || probe.stdout.trim() !== probePass) {
      const problem = probeProblem(probe);
      const windowsCode = /^(?:CreateProcessW LPAC|Verify sandbox token|Verify sandbox loopback policy) failed \(Windows error (\d{1,10})\)\./
        .exec(probe.stderr ?? '')?.[1];
      const exit = problem === 'probe-process'
        ? /^The restricted process did not pass the isolation probe \(exit (-?\d{1,10})\)\./.exec(probe.stderr)?.[1]
        : undefined;
      const probeExit = exit === undefined ? null : Number(exit);
      return { problem, windowsCode, probeExit };
    }
    return assets;
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 40 });
  }
}

async function requireArtifact(directory, name) {
  const path = join(directory, name);
  return boundedFile(path, directory, moduleLimit);
}

async function learnerCompilerError(scratch, phase, language) {
  try {
    const linkerLog = language === 'go' ? 'go-link' : phase === 'link' ? 'lld' : null;
    if (linkerLog) {
      const startedLinker = await lstat(join(scratch, `${linkerLog}.log`)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (startedLinker) {
        if (language === 'go') {
          const log = await boundedFile(join(scratch, 'go-link.log'), scratch, diagnosticsLimit);
          const text = await readFile(log, 'utf8');
          if (/^runtime\.main_main·f: function main is undeclared in the main package\s*$/m.test(text)) {
            return 'Keep the func main() {} declaration from the challenge starter.';
          }
        }
        return undefined;
      }
    }
    const log = await boundedFile(join(scratch, `${phase}.log`), scratch, diagnosticsLimit);
    const text = await readFile(log, 'utf8');
    // Go uses the same exit code for ordinary diagnostics and compiler bugs.
    if (/^(?:(?:.+:\d+(?::\d+)?:\s*)?(?:error:\s*)?internal compiler error\b|panic:|fatal error:|thread .+ panicked at)/mi.test(text)) {
      return undefined;
    }
    if (language === 'go' && /could not import [^\r\n]+ \((?:open [^\r\n]+\.a:|can't find export data|not the start of an archive file|not a (?:go object|package) file|object is \[|unknown export data header|[^)\r\n]*recompile package)/i.test(text)) {
      return undefined;
    }
    const sourceError = language === 'rust' ? /^(?:\.[\\/])?(submission\.rs:\d+:\d+: error(?:\[E\d+\])?: .+)$/m
      : /^(?:\.[\\/])?(submission\.go:\d+:\d+: .+)$/m;
    const learnerLine = sourceError.exec(text)?.[1];
    if (learnerLine) return learnerLine.slice(0, 320);

    // A public contract can cause errors in the private harness. Only name the contract.
    if (language === 'rust' && phase === 'link'
      && /^harness\.rs:\d+:\d+: error\[(?:E0061|E0277|E0308|E0412|E0422|E0425|E0432|E0433|E0599|E0603|E0609|E0659)\]/m.test(text)) {
      return 'Use the public Rust function signature shown in the challenge. Check the name, parameter types, and return type.';
    }
    if (language === 'go' && /^(?:\.[\\/])?harness\.go:\d+:\d+: (?:undefined:|cannot use |not enough arguments in call|too many arguments in call|assignment mismatch:|invalid operation:|.*\(no value\) used as value|multiple-value .* in single-value context)/m.test(text)) {
      return 'Use the public Go function signature shown in the challenge. Check the name, parameter types, and return type.';
    }
  } catch {
    // Missing or unsafe logs cannot establish that the submission caused the failure.
  }
  return undefined;
}

async function compileOutcome(run, scratch, phase, language) {
  if (run.code === 0 && !run.reason) return {status: 'passed'};
  if (run.reason === 'timeout' || run.code === 124 || run.code === 125) {
    return {status: 'timeout', message: 'The sandbox could not complete the build within its limits.'};
  }
  const compilerErrorCode = language === 'go' ? 2 : 1;
  if (!run.reason && run.code === compilerErrorCode) {
    const message = await learnerCompilerError(scratch, phase, language);
    if (message) return {status: 'compile_error', message};
  }
  return {status: 'runner_error', message: 'The Windows runner could not complete the build.'};
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
    let detail = unavailableReasons[reason];
    if (bundle?.windowsCode) detail += ` Windows error ${bundle.windowsCode}.`;
    if (reason === 'probe-process' && bundle.probeExit !== null
      && bundle.probeExit >= -2147483648 && bundle.probeExit <= 2147483647) {
      detail += ` ${probeExitDetail(bundle.probeExit)}`;
    }
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
      const build = await compileOutcome(compile, scratch, 'compile', language);
      if (build.status !== 'passed') {
        if (compile.code === 126) failed.add(language);
        return result(build.status, { compileMs: elapsed(started), message: build.message });
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
        const linkedBuild = await compileOutcome(link, scratch, 'link', language);
        if (linkedBuild.status !== 'passed') {
          if (link.code === 126) failed.add(language);
          return result(linkedBuild.status, { compileMs: elapsed(started), message: linkedBuild.message });
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
