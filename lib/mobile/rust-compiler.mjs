import {WASI, WASIProcExit, File, Directory, OpenFile, PreopenDirectory, ConsoleStdout} from '@bjorn3/browser_wasi_shim';
import {caseExport} from '../standalone-runner-harness.mjs';
import {result} from '../workbench-runner-job.mjs';
import {capWasmMemory} from './wasm-memory.mjs';
import {rustToolchain} from './rust-toolchain.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toolPages = 4096; // 256 MiB linear memory; browser/code/library overhead is measured separately.
const guestPages = 1024;
const artifactLimit = 16 * 1024 * 1024;

async function verifiedAsset(name, signal) {
  const expectedSize = rustToolchain.sizes[name];
  const response = await fetch('/runtime/rust/' + name, {credentials:'same-origin', redirect:'error', signal});
  if (!response.ok || response.redirected || !response.body) throw new Error('Rust pack unavailable');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedSize);
  let offset = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) throw new Error('Rust asset exceeds its size');
      bytes.set(value, offset);
      offset += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  if (offset !== expectedSize || hash !== rustToolchain.files[name]) throw new Error('Rust asset integrity mismatch');
  return bytes;
}

export function rustLibraries(bytes) {
  if (bytes.length < 10 || decoder.decode(bytes.subarray(0, 6)) !== 'RIWB1\n') throw new Error('Invalid Rust library bundle');
  const length = new DataView(bytes.buffer, bytes.byteOffset + 6, 4).getUint32(0, true);
  if (length > 64 * 1024 || length + 10 > bytes.length) throw new Error('Invalid Rust library index');
  const {files, total} = JSON.parse(decoder.decode(bytes.subarray(10, 10 + length)));
  if (!Array.isArray(files) || !files.length || files.length > 256 || total !== bytes.length - 10 - length) {
    throw new Error('Invalid Rust library size');
  }
  const libraries = new Map();
  let offset = 0;
  for (const {p, o, l} of files) {
    if (typeof p !== 'string' || !/^lib\/rustlib\/wasm32-wasip1\/lib\/(?:self-contained\/)?[A-Za-z0-9_-]+\.(?:rlib|rmeta|a|o)$/.test(p)
      || libraries.has(p) || o !== offset || !Number.isSafeInteger(l) || l < 0 || o + l > total) {
      throw new Error('Invalid Rust library entry');
    }
    const file = new File([], {readonly:true});
    file.data = bytes.subarray(10 + length + o, 10 + length + o + l);
    libraries.set(p, file);
    offset += l;
  }
  if (offset !== total) throw new Error('Incomplete Rust library bundle');
  return libraries;
}

function libraryDirectory(libraries) {
  const root = new Map();
  for (const [path, file] of libraries) {
    const parts = path.split('/');
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Map());
      directory = directory.get(part);
    }
    directory.set(parts.at(-1), file);
  }
  const tree = entries => new Directory([...entries].map(([name, value]) => [name, value instanceof Map ? tree(value) : value]));
  return new PreopenDirectory('/sysroot', tree(root).contents);
}

// The compiler sees only virtual files. Bound writes before the shim allocates
// output buffers (a WASM heap limit alone does not bound the virtual filesystem).
function boundCompilerFiles(wasi) {
  let written = 0;
  const check = (fd, end, bytes = 0) => {
    const file = wasi.fds[fd]?.file;
    if (file && (file.readonly || end > BigInt(artifactLimit) || end < 0n)) throw new Error('Compiler file limit');
    written += bytes;
    if (written > 64 * 1024 * 1024) throw new Error('Compiler output limit');
  };
  for (const name of ['fd_write','fd_pwrite']) {
    const original = wasi.wasiImport[name];
    wasi.wasiImport[name] = (fd, ptr, count, ...rest) => {
      const view = new DataView(wasi.inst.exports.memory.buffer);
      if (count < 0 || count > 1024) throw new Error('Compiler write limit');
      let bytes = 0;
      for (let index = 0; index < count; index++) bytes += view.getUint32(ptr + index * 8 + 4, true);
      const offset = name === 'fd_pwrite' ? rest[0] : wasi.fds[fd]?.file_pos ?? 0n;
      check(fd, BigInt(offset) + BigInt(bytes), bytes);
      return original(fd, ptr, count, ...rest);
    };
  }
  for (const name of ['fd_allocate','fd_filestat_set_size']) {
    const original = wasi.wasiImport[name];
    wasi.wasiImport[name] = (fd, size, ...rest) => {
      check(fd, size + (name === 'fd_allocate' ? rest[0] : 0n));
      return original(fd, size, ...rest);
    };
  }
}

async function compile(module, libraries, args, contents, onMemory) {
  let output = '';
  const capture = new ConsoleStdout(bytes => {
    if (output.length < 16_384) output += decoder.decode(bytes.subarray(0, 16_384 - output.length));
  });
  const workspace = new PreopenDirectory('/work', contents);
  const wasi = new WASI(['rustc', ...args], ['CLIF2WASM_OBJECT=1'],
    [new OpenFile(new File([])), capture, capture, new PreopenDirectory('/tmp', []), libraryDirectory(libraries), workspace], {debug:false});
  boundCompilerFiles(wasi);
  const instance = await WebAssembly.instantiate(module, {wasi_snapshot_preview1:wasi.wasiImport});
  let exit;
  let trapped = false;
  try { exit = wasi.start(instance); }
  catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    // The port aborts after some ordinary diagnostics instead of returning an
    // exit code. Only a structured learner error can classify that as a rejection.
    exit = 1;
    trapped = true;
  } finally { onMemory(instance.exports.memory.buffer.byteLength); }
  return {exit, output, trapped, files:workspace.dir.contents};
}

export function compileFailure({output, trapped}, submission) {
  const backend = [];
  const diagnostics = output.split('\n').flatMap(line => {
    try {
      const diagnostic = JSON.parse(line);
      if (diagnostic?.level === 'error: internal compiler error') {
        backend.push('internal compiler error');
        return [];
      }
      const learner = Array.isArray(diagnostic?.spans)
        && diagnostic.spans.some(span => span?.file_name === '/work/submission.rs');
      if (learner) {
        const message = diagnostic.rendered || diagnostic.message;
        return diagnostic.level === 'error' && typeof message === 'string' ? [message] : [];
      }
      if (diagnostic?.level === 'error' && typeof diagnostic.message === 'string') backend.push(diagnostic.message);
    } catch {
      // Do not search truncated JSON: rendered snippets and diagnostic messages
      // can contain arbitrary learner text, including compiler-failure phrases.
      if (!line.trimStart().startsWith('{')) backend.push(line);
    }
    return [];
  });
  const compilerOutput = backend.join('\n');
  if (/wasm emission failed|unimplemented|not yet supported/i.test(compilerOutput)) return result('runner_error',
    'This program uses an operation the experimental mobile compiler cannot generate. Try the desktop Rust Workbench.');
  if (/internal compiler error|panicked at|memory access out of bounds|unsupported.*(?:instruction|relocation)/i.test(compilerOutput)) {
    return result('runner_error', 'The experimental Rust compiler could not compile this program.');
  }
  if (trapped && !diagnostics.length) return result('runner_error', 'The experimental Rust compiler stopped unexpectedly.');
  return result('compile_error', submission && diagnostics.length
    ? diagnostics.join('\n').replaceAll('/work/submission.rs', 'submission.rs').slice(0, 4096)
    : 'The submission could not compile with the challenge suite. Check the required signature.');
}

export async function loadRustCompiler(load = verifiedAsset, signal) {
  const compiler = await WebAssembly.compile(capWasmMemory(await load(rustToolchain.compiler, signal), toolPages));
  signal?.throwIfAborted();
  return compiler;
}

export async function loadRustRuntime(load = verifiedAsset, signal) {
  const compiler = await loadRustCompiler(load, signal);
  const sysroot = await load(rustToolchain.sysroot, signal);
  signal?.throwIfAborted();
  return {compiler, sysroot};
}

export async function runRustJob({source, harness, caseIds}, notify = () => {}, load = verifiedAsset, compiledModule, sysrootBytes) {
  const start = performance.now();
  const elapsed = from => Math.round(performance.now() - from);
  let peakWasmBytes = 0;
  const memory = bytes => { peakWasmBytes = Math.max(peakWasmBytes, bytes); };
  notify({phase:'compile'});
  const compiler = compiledModule ?? await loadRustCompiler(load);
  const libraries = rustLibraries(sysrootBytes ?? await load(rustToolchain.sysroot));
  const flags = ['--sysroot','/sysroot','--target','wasm32-wasip1','--edition','2024','-Cpanic=abort',
    '-Copt-level=0','--error-format=json'];
  // No test sources, reference answers or prior work exist in this workspace.
  const compiled = await compile(compiler, libraries,
    ['/work/submission.rs','--crate-name','ferrum_submission','--crate-type','rlib',...flags,'-o','/work/libferrum_submission.rlib'],
    [['submission.rs', new File(encoder.encode(source), {readonly:true})]], memory);
  if (compiled.exit) return {...compileFailure(compiled, true), compileMs:elapsed(start), peakWasmBytes};
  const library = compiled.files.get('libferrum_submission.rlib');
  if (!library?.data?.length || library.data.length > artifactLimit) throw new Error('Rust library unavailable');
  notify({phase:'link', memoryBytes:peakWasmBytes});
  const linked = await compile(compiler, libraries,
    ['/work/harness.rs','--crate-name','ferrum_harness','--crate-type','cdylib',...flags,
      '--extern','ferrum_submission=/work/libferrum_submission.rlib','-o','/work/trial.wasm'],
    [['libferrum_submission.rlib', new File(library.data, {readonly:true})],
      ['harness.rs', new File(encoder.encode(harness.source), {readonly:true})]], memory);
  if (linked.exit) return {...compileFailure(linked, false), compileMs:elapsed(start), peakWasmBytes};
  const binary = linked.files.get('trial.wasm')?.data;
  if (!binary?.length || binary.length > artifactLimit) throw new Error('Rust module unavailable');
  const guest = await WebAssembly.compile(capWasmMemory(binary, guestPages));
  if (WebAssembly.Module.imports(guest).some(item => item.module !== 'wasi_snapshot_preview1')) throw new Error('Unsupported Rust import');
  const runStart = performance.now();
  const tests = [];
  for (const [index, id] of caseIds.entries()) {
    notify({phase:'case', index, memoryBytes:peakWasmBytes});
    const caseStart = performance.now();
    const discard = new ConsoleStdout(() => {});
    const sandbox = new WASI([], [], [new OpenFile(new File([])), discard, discard], {debug:false});
    let passed = false;
    try {
      const instance = await WebAssembly.instantiate(guest, {wasi_snapshot_preview1:sandbox.wasiImport});
      sandbox.initialize(instance);
      passed = instance.exports[caseExport](harness.ids.indexOf(id)) === 1;
      memory(instance.exports.memory.buffer.byteLength);
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError || error instanceof WASIProcExit || error instanceof RangeError)) throw error;
    }
    tests.push({id, status:passed ? 'passed' : 'failed', durationMs:elapsed(caseStart)});
  }
  return {status:tests.every(test => test.status === 'passed') ? 'passed' : 'failed', tests, diagnostics:[],
    compileMs:Math.round(runStart - start), runtimeMs:elapsed(runStart), elapsedMs:elapsed(start), peakWasmBytes};
}
