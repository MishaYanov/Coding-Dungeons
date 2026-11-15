import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { build, preview } from 'vite';
import go from '../data/workbench/go.mjs';
import javascript from '../data/workbench/javascript.mjs';
import typescript from '../data/workbench/typescript.mjs';
import { definitions } from '../lib/diamond-content.mjs';
import { sideQuestRoutes } from '../lib/side-quests.mjs';
import { mobileTypeScript } from '../work/scripts/mobile-typescript.mjs';
import { quickjsSecurityCases, quickjsSecurityJob } from '../test/fixtures/quickjs-security.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = join(project, 'out');
const goPack = join(output, 'mobile-go-pack');
const catalogs = { javascript, typescript, go };

async function browserOptions() {
  if (process.env.FERRUM_BROWSER) return { executablePath:process.env.FERRUM_BROWSER };
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const name of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
        const executablePath = join(root, name);
        if (await access(executablePath).then(() => true, () => false)) return { executablePath };
      }
    }
  }
  return {};
}

async function openProbe(t, {includeGo = true} = {}) {
  const goFiles = await readdir(goPack).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const goReady = includeGo && goFiles.includes('manifest.json');
  if (includeGo && process.env.FERRUM_MOBILE_REQUIRE_GO === '1') {
    assert.ok(goReady, 'Stage the required Go compiler pack with npm run mobile:stage-go.');
  }

  await mkdir(output, { recursive:true });
  const folder = await mkdtemp(join(output, '.mobile-runtime-test-'));
  const dist = join(folder, 'dist');
  let browser;
  let server;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      if (server) await new Promise(resolve => {
        server.httpServer.close(resolve);
        server.httpServer.closeAllConnections();
      });
      await rm(folder, { recursive:true, force:true, maxRetries:3 });
    }
  });

  await writeFile(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'">
<script type="module" src="./app.mjs"></script>`);
  await writeFile(join(folder, 'app.mjs'), `import { runBrowserWorkbench } from '../../lib/mobile/runner.mjs';
import { runGoWorkbench } from '../../lib/mobile/go-runner.mjs';
window.grade = request => request.language === 'go' ? runGoWorkbench(request) : runBrowserWorkbench(request);`);
  const config = { configFile:false, root:folder, publicDir:false, logLevel:'error',
    worker:{ format:'es', plugins:() => [mobileTypeScript()] }, build:{outDir:dist} };
  await build(config);
  if (goReady) await cp(goPack, join(dist, 'runtime/go'), { recursive:true });
  const shellFiles = ['/index.html', ...(await readdir(join(dist, 'assets'))).map(file => `/assets/${file}`)];
  const worlds = goReady ? {go:{ number:4, version:'mobile-runtime-test', files:goFiles.map(file => `/runtime/go/${file}`) }} : {};
  const worker = await readFile(join(project, 'src/mobile/service-worker.js'), 'utf8');
  await writeFile(join(dist, 'sw.js'), `const offline = ${JSON.stringify({shellVersion:'mobile-runtime-test', shellFiles, worlds})};\n${worker}`);
  server = await preview({ ...config, preview:{ port:0, host:'127.0.0.1', strictPort:true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(await browserOptions());
  const context = await browser.newContext(devices['Pixel 7']);
  const external = [];
  const errors = [];
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => {
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  if (goReady) {
    const ready = await page.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => resolve(event.data);
      navigator.serviceWorker.controller.postMessage({ type:'download-world', world:'go' }, [channel.port2]);
    }));
    assert.deepEqual(ready, { ready:true });
  }
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof window.grade === 'function');
  return {page, goReady};
}

function reportTiming(t, values) {
  values.sort((a, b) => a - b);
  t.diagnostic(`${values.length} offline runs, median ${Math.round(values[Math.floor(values.length / 2)])} ms, max ${Math.round(values.at(-1))} ms.`);
}

test('offline browser JavaScript and TypeScript workers reject the QuickJS buffer over-read regression', {timeout:60_000}, async t => {
  const {page} = await openProbe(t, {includeGo:false});
  for (const language of ['javascript', 'typescript']) {
    const result = await page.evaluate(request => window.grade(request), quickjsSecurityJob(language));
    assert.equal(result.status, 'passed', language + ': the bundled worker must use the corrected interpreter.');
    assert.deepEqual(result.tests.map(({id, status}) => ({id, status})),
      quickjsSecurityCases.map(({id}) => ({id, status:'passed'})));
  }
});

test('offline browser side quest stages accept references and reject starters in all supported worlds', {timeout:90_000}, async t => {
  const {page, goReady} = await openProbe(t);
  for (const {world:language, catalog} of sideQuestRoutes.values()) {
    await t.test(catalog.title, {skip:language === 'go' && !goReady ? 'Stage the optional Go compiler pack.' : false}, async () => {
      for (const stage of catalog.stages.filter(stage => stage.kind === 'code')) {
        const carry = catalog.stages.find(previous => previous.id === stage.carryFrom)?.exercise.reference;
        const {reference, starter, tests, typeTests} = stage.exercise;
        for (const [code, expected] of [[reference, 'passed'], [starter, 'failed']]) {
          const source = [carry, code].filter(Boolean).join('\n\n');
          const result = await page.evaluate(request => window.grade(request), {language, source, tests, typeTests});
          assert.equal(result.status, expected, `${catalog.id}/${stage.id}: ${JSON.stringify(result)}`);
          if (expected === 'passed') {
            assert.deepEqual(result.tests.map(item => item.id), [...typeTests ?? [], ...tests].map(item => item.id));
          }
        }
      }
    });
  }
});

test('browser runtimes grade every bundled reference and reject its starter offline', { timeout:210_000 }, async t => {
  const {page, goReady} = await openProbe(t);
  for (const [language, catalog] of Object.entries(catalogs)) {
    await t.test(language, { skip:language === 'go' && !goReady ? 'Stage the optional Go compiler pack.' : false }, async t => {
      const {lessons} = JSON.parse(await readFile(join(project, 'data/worlds', language, 'source.json'), 'utf8'));
      const wallTimes = [];
      for (const {id, level, reference, starter, tests, typeTests} of [...catalog, {id:'diamond', ...definitions[language]}]) {
        for (const [source, expectations] of [[reference, ['passed']], [starter ?? lessons[level - 1].starter, ['failed', 'compile_error']]]) {
          const start = performance.now();
          const result = await page.evaluate(request => window.grade(request), { language, source, tests, typeTests });
          wallTimes.push(performance.now() - start);
          assert.ok(expectations.includes(result.status), `${id}: ${JSON.stringify(result)}`);
          if (expectations[0] === 'passed') {
            assert.deepEqual(result.tests.map(item => item.id), [...typeTests ?? [], ...tests].map(item => item.id), id);
            assert.ok(result.tests.every(item => item.status === 'passed'), id);
          }
        }
      }
      reportTiming(t, wallTimes);
    });
  }

  await t.test('worker limits and cancellation leave the workbench ready for another run', async () => {
    const testCode = { language:'javascript', source:'function work() { while (true) {} }',
      tests:[{ id:'loop', code:'work();' }], limits:{timeoutMs:35} };
    const timed = await page.evaluate(request => window.grade(request), testCode);
    assert.equal(timed.status, 'timeout');
    const canceled = await page.evaluate(async request => {
      const controller = new AbortController();
      const attempt = window.grade({...request, signal:controller.signal});
      controller.abort();
      return attempt;
    }, testCode);
    assert.equal(canceled.status, 'canceled');
    const normal = await page.evaluate(request => window.grade(request), {
      ...testCode, source:'function work() { return typeof document === "undefined" && typeof fetch === "undefined"; }',
      tests:[{ id:'guest', code:'assert(work());' }], limits:undefined,
    });
    assert.equal(normal.status, 'passed', JSON.stringify(normal));
  });

  await t.test('Go denies filesystem and network access and never accepts a guest exit as a pass', {
    skip:goReady ? false : 'Stage the optional Go compiler pack.',
  }, async () => {
    const run = source => page.evaluate(source => window.grade({ language:'go', source,
      tests:[{ id:'contract', code:'if !check() { t.Fatal("Invalid result") }' }], }), source);
    const denied = await run(`package main
import ("os"; "syscall")
func check() bool {
  _, fileErr := os.ReadFile("/work/harness.go")
  _, socketErr := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
  return fileErr != nil && socketErr != nil
}
func main() {}`);
    assert.equal(denied.status, 'passed', JSON.stringify(denied));
    const exited = await run(`package main
import "os"
func check() bool { os.Exit(0); return false }
func main() {}`);
    assert.equal(exited.status, 'failed', JSON.stringify(exited));
    assert.deepEqual(exited.tests.map(({status}) => status), ['failed']);
  });
});
