import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {chromium, devices} from 'playwright-core';
import {build, preview} from 'vite';
import legacy from '../data/exercises.json' with {type:'json'};
import drills from '../data/workbench/rust.mjs';
import {definitions} from '../lib/diamond-content.mjs';
import {caseExport} from '../lib/standalone-runner-harness.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = join(project, 'out');
const pack = join(output, 'mobile-rust-pack');
const execute = promisify(execFile);
const goblin = {id:'diamond-goblin', ...definitions.rust};
const catalog = [...legacy, ...drills, goblin];

async function filesIn(folder) {
  return (await readdir(folder, {recursive:true, withFileTypes:true}))
    .filter(entry => entry.isFile())
    .map(entry => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
}

async function browserOptions() {
  if (process.env.FERRUM_BROWSER) return {executablePath:process.env.FERRUM_BROWSER};
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const name of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
      const executablePath = join(root, name);
      if (await access(executablePath).then(() => true, () => false)) return {executablePath};
    }
  }
  return {};
}

// This optional host measurement sums the test browser's process working sets.
// Shared pages can be counted twice; it is neither Android PSS nor a phone RAM guarantee.
async function memorySampler(browser) {
  if (process.env.FERRUM_MOBILE_MEASURE_MEMORY !== '1' || process.platform !== 'win32') return async () => null;
  const cdp = await browser.newBrowserCDPSession();
  let active;
  let samples = 0;
  let peakWorkingSetBytes = 0;
  let failure;
  function sample() {
    if (active || failure) return;
    active = (async () => {
      const {processInfo} = await cdp.send('SystemInfo.getProcessInfo');
      const ids = processInfo.map(item => item.id).filter(id => Number.isSafeInteger(id) && id > 0);
      if (!ids.length) return;
      const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `[long]((Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum)`],
      {windowsHide:true, timeout:5_000, maxBuffer:2048});
      const bytes = Number(stdout.trim());
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid process memory sample');
      samples++;
      peakWorkingSetBytes = Math.max(peakWorkingSetBytes, bytes);
    })().catch(error => { failure = error.message; }).finally(() => { active = null; });
  }
  sample();
  const timer = setInterval(sample, 1_000);
  return async () => {
    clearInterval(timer);
    await active;
    await cdp.detach().catch(() => {});
    return {samples, peakWorkingSetBytes, ...(failure ? {failure} : {})};
  };
}

async function openProbe(t) {
  await mkdir(output, {recursive:true});
  const folder = await mkdtemp(join(output, '.mobile-rust-test-'));
  const dist = join(folder, 'dist');
  let server;
  let browser;
  let stopMemory = async () => null;
  t.after(async () => {
    const memory = await stopMemory();
    if (memory) t.diagnostic('Host browser memory: ' + JSON.stringify(memory));
    try { await browser?.close(); }
    finally {
      if (server) await new Promise(resolve => {
        server.httpServer.close(resolve);
        server.httpServer.closeAllConnections();
      });
      assert.equal(relative(output, folder).startsWith('.mobile-rust-test-'), true);
      await rm(folder, {recursive:true, force:true, maxRetries:3});
    }
  });
  await writeFile(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'">
<script type="module" src="./app.mjs"></script>`);
  await writeFile(join(folder, 'app.mjs'), `import {runRustWorkbench} from '../../lib/mobile/rust-runner.mjs';
const NativeWorker = globalThis.Worker;
window.compilerMemory = [];
globalThis.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args);
    this.addEventListener('message', ({data}) => {
      if (Number.isSafeInteger(data?.memoryBytes)) window.compilerMemory.push({phase:data.phase, bytes:data.memoryBytes});
    });
  }
};
window.grade = request => runRustWorkbench(request);`);
  const config = {configFile:false, root:folder, publicDir:false, logLevel:'error',
    worker:{format:'es'}, build:{outDir:dist}};
  await build(config);
  await cp(pack, join(dist, 'runtime/rust'), {recursive:true});
  const packFiles = await filesIn(join(dist, 'runtime/rust'));
  const integrity = Object.fromEntries(await Promise.all(packFiles.map(async file => [
    '/runtime/rust/' + file, createHash('sha256').update(await readFile(join(pack, file))).digest('hex'),
  ])));
  const shellFiles = ['/index.html', ...(await filesIn(join(dist, 'assets'))).map(file => '/assets/' + file)];
  const offline = {shellVersion:'mobile-rust-test', shellFiles, integrity,
    worlds:{rust:{number:4, version:'mobile-rust-test', files:packFiles.map(file => '/runtime/rust/' + file)}}};
  await writeFile(join(dist, 'sw.js'), `const offline = ${JSON.stringify(offline)};\n`
    + await readFile(join(project, 'src/mobile/service-worker.js'), 'utf8'));
  server = await preview({...config, preview:{host:'127.0.0.1', port:0, strictPort:true}});
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(await browserOptions());
  const context = await browser.newContext(devices['Pixel 7']);
  stopMemory = await memorySampler(browser);
  const external = [];
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => { assert.deepEqual(external, []); assert.deepEqual(errors, []); });
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const downloaded = await page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data);
    navigator.serviceWorker.controller.postMessage({type:'download-world', world:'rust'}, [channel.port2]);
  }));
  assert.deepEqual(downloaded, {ready:true});
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof window.grade === 'function');
  return page;
}

function fixture(id, cases) {
  return {id, testNames:cases.map(([name]) => name),
    tests:cases.map(([name, code]) => `#[test]\nfn ${name}() { ${code} }`).join('\n')};
}
const answer = fixture('rust-conformance', [['answer_contract', 'assert_eq!(answer(), 42);']]);

test('the optional mobile Rust pack compiles real answers and enforces Rust and WASI boundaries offline', {timeout:900_000}, async t => {
  const ready = await access(join(pack, 'manifest.json')).then(() => true, () => false);
  if (!ready) {
    assert.notEqual(process.env.FERRUM_MOBILE_REQUIRE_RUST, '1', 'Stage the required Rust compiler pack first.');
    t.skip('Stage the optional Rust compiler pack to exercise real browser compilation.');
    return;
  }
  const page = await openProbe(t);
  const run = (exercise, source, extra = {}) => page.evaluate(request => window.grade(request), {exercise, source, ...extra});
  const selected = process.env.FERRUM_MOBILE_RUST_SMOKE === '1' ? [drills[0], goblin] : catalog;
  const timings = [];
  for (const exercise of selected) await t.test(exercise.id, async () => {
    const start = performance.now();
    const correct = await run(exercise, exercise.reference ?? exercise.solution);
    timings.push(performance.now() - start);
    assert.equal(correct.status, 'passed', JSON.stringify(correct));
    assert.deepEqual(correct.tests.map(({id}) => id), exercise.testNames);
    assert.ok(correct.tests.every(({status}) => status === 'passed'));
    const wrong = await run(exercise, exercise.starter);
    assert.ok(['failed','compile_error'].includes(wrong.status), JSON.stringify(wrong));
  });
  t.diagnostic(`${selected.length} references and starters; first reference ${Math.round(timings[0])} ms, `
    + `median ${Math.round([...timings].sort((a,b) => a-b)[Math.floor(timings.length / 2)])} ms.`);

  await t.test('examples run selected public cases without awarding success to an incorrect full solution', async () => {
    const source = goblin.starter.replace('todo!()', '9');
    const example = await run(goblin, source, {caseIds:[goblin.testNames[0]]});
    assert.equal(example.status, 'passed', JSON.stringify(example));
    assert.deepEqual(example.tests.map(({id}) => id), [goblin.testNames[0]]);
    const submitted = await run(goblin, source);
    assert.equal(submitted.status, 'failed', JSON.stringify(submitted));
    assert.ok(submitted.tests.some(({status}) => status === 'failed'));
  });
  await t.test('the portable atlas fixture still rejects wrapping a retired handle generation', async () => {
    const atlas = legacy.find(exercise => exercise.id === 'dense-atlas');
    const source = atlas.solution.replace('slot.generation.checked_add(1)', 'Some(slot.generation.wrapping_add(1))');
    assert.notEqual(source, atlas.solution, 'The mutation must change the authored generation policy.');
    const result = await run(atlas, source);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.deepEqual(result.tests.map(({status}) => status), ['passed','passed','failed']);
  });
  await t.test('the compiler rejects invalid borrows, moved values and escaping lifetimes', async () => {
    for (const source of [
      'pub fn answer() -> i32 { let mut values = vec![1, 2]; let first = &values[0]; values.push(3); *first }',
      'pub fn answer() -> i32 { let value = String::from("moved"); let _moved = value; value.len() as i32 }',
      'pub fn answer() -> i32 { let escaped; { let local = String::from("local"); escaped = &local; } escaped.len() as i32 }',
    ]) assert.equal((await run(answer, source)).status, 'compile_error');
  });
  await t.test('learner compilation cannot read the trusted fixture source', async () => {
    const result = await run(answer, `const FIXTURES: &str = include_str!("/work/harness.rs");
pub fn answer() -> i32 { std::hint::black_box(FIXTURES); 42 }`);
    assert.equal(result.status, 'compile_error', JSON.stringify(result));
  });
  await t.test('learner source text cannot impersonate an infrastructure failure', async () => {
    for (const source of [
      'pub fn answer() -> i32 { let unimplemented: i32 = "wrong"; unimplemented }',
      'compile_error!("internal compiler error: unimplemented"); pub fn answer() -> i32 { 42 }',
    ]) {
      const result = await run(answer, source);
      assert.equal(result.status, 'compile_error', JSON.stringify(result));
      assert.ok(result.diagnostics.length);
    }
  });
  await t.test('a learner export cannot replace the trusted harness verdict', async t => {
    const result = await run(answer, `pub fn answer() -> i32 { 0 }
#[unsafe(no_mangle)]
pub extern "C" fn ${caseExport}(_case: i32) -> i32 { 1 }`);
    assert.ok(['failed','compile_error','runner_error'].includes(result.status), JSON.stringify(result));
    t.diagnostic('Duplicate verdict export rejected with status: ' + result.status);
  });
  await t.test('guest file and network access is unavailable, and an early exit cannot pass', async () => {
    const denied = await run(answer, `pub fn answer() -> i32 {
      let file = std::fs::read_to_string("/work/submission.rs");
      let socket = std::net::TcpStream::connect("127.0.0.1:9");
      if file.is_err() && socket.is_err() { 42 } else { 0 }
    }`);
    assert.equal(denied.status, 'passed', JSON.stringify(denied));
    const exited = await run(answer, 'pub fn answer() -> i32 { std::process::exit(0) }');
    assert.equal(exited.status, 'failed', JSON.stringify(exited));
  });
  await t.test('every case has a fresh guest instance', async () => {
    const fresh = fixture('fresh-instance', [
      ['first_state', 'assert_eq!(answer(), 0);'], ['second_state', 'assert_eq!(answer(), 0);'],
    ]);
    const result = await run(fresh, `use std::sync::atomic::{AtomicUsize, Ordering};
static COUNTER: AtomicUsize = AtomicUsize::new(0);
pub fn answer() -> usize { COUNTER.fetch_add(1, Ordering::Relaxed) }`);
    assert.equal(result.status, 'passed', JSON.stringify(result));
  });
  await t.test('guest memory and execution limits stop abuse and leave the next job usable', async () => {
    const exhausted = await run(answer, `pub fn answer() -> i32 {
      let bytes = vec![7u8; 128 * 1024 * 1024]; std::hint::black_box(bytes); 42
    }`);
    assert.equal(exhausted.status, 'failed', JSON.stringify(exhausted));
    const timed = await run(answer, 'pub fn answer() -> i32 { loop { std::hint::black_box(0); } }');
    assert.equal(timed.status, 'timeout', JSON.stringify(timed));
    const canceled = await page.evaluate(async request => {
      const controller = new AbortController();
      const pending = window.grade({...request, signal:controller.signal});
      controller.abort();
      return pending;
    }, {exercise:answer, source:'pub fn answer() -> i32 { 42 }'});
    assert.equal(canceled.status, 'canceled');
    assert.equal((await run(answer, 'pub fn answer() -> i32 { 42 }')).status, 'passed');
  });
  const memory = await page.evaluate(() => window.compilerMemory);
  if (memory.length) t.diagnostic(`Peak reported compiler/guest linear memory: ${Math.max(...memory.map(item => item.bytes))} bytes; browser and asset overhead are additional.`);
});
