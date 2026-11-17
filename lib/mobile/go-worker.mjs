import {WASI, WASIProcExit, File, OpenFile, ConsoleStdout, PreopenDirectory} from '@bjorn3/browser_wasi_shim';
import {caseExport} from '../standalone-runner-harness.mjs';
import {result} from '../workbench-runner-job.mjs';
import {capWasmMemory} from './wasm-memory.mjs';

const encoder = new TextEncoder();
const maxToolPages = 4_096;
const maxGuestPages = 1_024;
const packDirectory = '/runtime/go/';

async function packAsset(file) {
  const response = await fetch(packDirectory + file, {credentials:'same-origin'});
  if (!response.ok) throw new Error('Go workbench file is unavailable');
  return response;
}

async function bytesOf(file) {
  return new Uint8Array(await (await packAsset(file)).arrayBuffer());
}

async function tool(name, args, workspace, stdlib) {
  let output = '';
  const text = new TextDecoder();
  const capture = new ConsoleStdout(bytes => {
    if (output.length < 4096) output += text.decode(bytes.subarray(0, 4096 - output.length), {stream:true});
  });
  const wasi = new WASI([name, ...args], ['GOOS=wasip1', 'GOARCH=wasm', 'GOMAXPROCS=1'],
    [new OpenFile(new File([])), capture, capture, workspace, stdlib]);
  const {instance} = await WebAssembly.instantiate(capWasmMemory(await bytesOf(name), maxToolPages),
    {wasi_snapshot_preview1:wasi.wasiImport});
  const exit = wasi.start(instance);
  return {exit, output:output.trim().slice(0, 4096)};
}

async function run(source, harness) {
  const start = performance.now();
  const manifest = await (await packAsset('manifest.json')).json();
  if (manifest.version !== '1.27.4' || manifest.compiler !== 'compile.wasm' || manifest.linker !== 'link.wasm') {
    throw new Error('Go workbench pack does not match');
  }
  const packages = Object.entries(manifest.packages);
  if (!packages.length || packages.length > 500 || packages.some(([name, file]) =>
    !/^[a-z][a-z0-9_/]*$/.test(name) || !/^\d{4}\.a$/.test(file))) throw new Error('Invalid Go archive index');
  const archives = await Promise.all(packages.map(async ([, file]) => [file, new File(await bytesOf(file), {readonly:true})]));
  const stdlib = new PreopenDirectory('/sdk', archives);
  const config = packages.map(([name,file]) => `packagefile ${name}=/sdk/${file}`).join('\n');
  const workspace = new PreopenDirectory('/work', [
    ['imports.cfg', new File(encoder.encode(config), {readonly:true})],
    ['submission.go', new File(encoder.encode(source), {readonly:true})],
    ['harness.go', new File(encoder.encode(harness.source), {readonly:true})],
  ]);
  const compile = await tool(manifest.compiler, ['-p','main','-lang=go1.25','-complete','-pack','-importcfg','/work/imports.cfg',
    '-o','/work/trial.a','/work/submission.go','/work/harness.go'], workspace, stdlib);
  const elapsed = from => Math.round(performance.now() - from);
  if (compile.exit) {
    const crash = /internal compiler error|^fatal error:|^panic:/m.test(compile.output);
    const sourceErrors = compile.output.split('\n').filter(line => line.startsWith('/work/submission.go:'))
      .map(line => line.replace('/work/', '')).join('\n');
    const message = crash ? 'The Go compiler could not finish this suite.'
      : sourceErrors || 'The submission could not compile with the challenge suite. Check the required signature.';
    return {...result(crash ? 'runner_error' : 'compile_error', message), compileMs:elapsed(start)};
  }
  const link = await tool(manifest.linker, ['-buildmode=c-shared','-linkmode=internal','-importcfg','/work/imports.cfg','-s','-w',
    '-o','/work/trial.wasm','/work/trial.a'], workspace, stdlib);
  if (link.exit) return {...result('runner_error', 'The Go linker could not finish this suite.'), compileMs:elapsed(start)};
  const binary = workspace.dir.contents.get('trial.wasm')?.data;
  if (!binary) throw new Error('The Go linker produced no module');
  const guest = await WebAssembly.compile(capWasmMemory(binary, maxGuestPages));
  const runStart = performance.now();
  const reports = [];
  for (const [index, id] of harness.ids.entries()) {
    const caseStart = performance.now();
    const discard = new ConsoleStdout(() => {});
    const sandbox = new WASI([], [], [new OpenFile(new File([])), discard, discard]);
    const instance = await WebAssembly.instantiate(guest, {wasi_snapshot_preview1:sandbox.wasiImport});
    // The guest has no preopened directories, browser APIs, or network access.
    let passed = false;
    try {
      sandbox.initialize(instance);
      passed = instance.exports[caseExport](index) === 1;
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError || error instanceof WASIProcExit)) throw error;
    }
    reports.push({id, status:passed ? 'passed' : 'failed', durationMs:elapsed(caseStart)});
  }
  return {status:reports.every(test => test.status === 'passed') ? 'passed' : 'failed', tests:reports,
    compileMs:Math.round(runStart - start), runtimeMs:elapsed(runStart), elapsedMs:elapsed(start), diagnostics:[]};
}

self.addEventListener('message', async ({data}) => {
  try {
    self.postMessage(await run(data.source, data.harness));
  } catch {
    self.postMessage(result('runner_error', 'The Go workbench could not finish. Download the Go world and try again.'));
  }
}, {once:true});
