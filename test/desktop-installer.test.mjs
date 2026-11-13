import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import forgeConfig from '../desktop/forge.config.cjs';

test('the desktop package copies only the application and excludes local credentials', () => {
  const ignore = forgeConfig.packagerConfig.ignore;
  for (const path of ['', '/server.mjs', '/desktop/preload.cjs', '/lib/standalone-runner.mjs',
    '/data/worlds/go/pages.json', '/dist/renderer/book/javascript/pages/1.webp', '/dist/renderer/book/ferrum-expedition.pdf',
    '/dist/renderer/assets/index-Ab23.js', '/node_modules/quickjs-emscripten/dist/index.js']) {
    assert.equal(ignore(path), false, path);
  }
  for (const path of ['/local-backup.txt', '/.env', '/state/ferrum.sqlite', '/dist/renderer/assets/private.key', '/infra/run-suite.sh',
    '/desktop/runtime/credentials.pfx', '/node_modules/package/.env.local', '/data/worlds/go/source.json']) {
    assert.equal(ignore(path), true, path);
  }
});

async function isolatedForge(t, {local = true, debug = false} = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'dungeons-installer-config-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const config = join(folder, 'desktop', 'forge.config.cjs');
  await Promise.all(['desktop', 'lib'].map(name => mkdir(join(folder, name))));
  for (const path of ['desktop/forge.config.cjs', 'lib/standalone-runner.mjs', 'lib/standalone-runner-harness.mjs']) {
    await copyFile(new URL(`../${path}`, import.meta.url), join(folder, path));
  }
  const configEnv = ['FERRUM_ALLOW_UNSIGNED_INSTALLER', 'FERRUM_WINDOWS_CERTIFICATE_FILE',
    'FERRUM_WINDOWS_CERTIFICATE_THUMBPRINT', 'FERRUM_DESKTOP_TEST_PACKAGE'];
  const previous = configEnv.map(key => process.env[key]);
  for (const key of configEnv) delete process.env[key];
  if (local) process.env.FERRUM_ALLOW_UNSIGNED_INSTALLER = '1';
  if (debug) process.env.FERRUM_DESKTOP_TEST_PACKAGE = '1';
  let forge;
  try {
    ({default:forge} = await import(pathToFileURL(config)));
  } finally {
    for (const [index, key] of configEnv.entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
  return {forge, runtime: join(folder, 'desktop', 'runtime')};
}

test('the lightweight package allows optional runtimes but the installer requires the full offline assets', async t => {
  const {forge, runtime} = await isolatedForge(t);
  assert.deepEqual(forge.packagerConfig.extraResource, []);
  await forge.hooks.prePackage();
  await assert.rejects(() => forge.hooks.preMake(), /offline runtime/i);

  await mkdir(join(runtime, 'standalone-runner'), {recursive: true});
  await writeFile(join(runtime, 'gm-model.gguf'), '');
  await writeFile(join(runtime, 'llama-completion.exe'), 'incomplete fixture');
  await forge.hooks.prePackage();
  await assert.rejects(() => forge.hooks.preMake(), /offline runtime/i);

  for (const name of ['gm-model.gguf', 'llama-completion-impl.dll', 'llama-common.dll', 'llama.dll', 'ggml.dll',
    'ggml-base.dll', 'ggml-cpu-x64.dll', 'libomp.dll', 'mtmd.dll', 'LICENSE-LLVM-OpenMP', 'LICENSE-llama.cpp.txt', 'LICENSE-Qwen3.txt']) {
    await writeFile(join(runtime, name), 'model fixture');
  }
  await assert.rejects(() => forge.hooks.preMake(), /complete Rust and Go assets/);
});

test('the runtime packaging check blocks keys under obsolete Go source paths', async t => {
  const {forge, runtime} = await isolatedForge(t);
  const source = join(runtime, 'standalone-runner', 'go', 'src');
  await mkdir(source, {recursive: true});
  await writeFile(join(source, 'fixture.key'), 'synthetic key placeholder');
  await assert.rejects(() => forge.hooks.prePackage(), /private or linked entry/);
});

test('the maker rejects a setup stub that lost its offline payload', async (t) => {
  const {forge} = await isolatedForge(t);
  const folder = await mkdtemp(join(tmpdir(), 'dungeons-installer-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const setup = join(folder, 'CodingDungeonsSetup-local.exe');
  const payload = join(folder, 'CodingDungeons-1.0.0-full.nupkg');
  const results = [{maker:'squirrel', artifacts:[setup, payload]}];
  await writeFile(payload, Buffer.alloc(4096));
  await writeFile(setup, Buffer.alloc(256));
  await assert.rejects(() => forge.hooks.postMake(forge, results), /offline payload/);
  await assert.rejects(() => forge.hooks.postMake(forge, [{maker:'squirrel', artifacts:[payload]}]), /offline payload/);

  await writeFile(setup, Buffer.alloc(4200));
  assert.equal(await forge.hooks.postMake(forge, results), results);
});

test('the release maker requires a signing identity by default', async t => {
  const {forge} = await isolatedForge(t, {local:false});
  assert.equal(forge.makers[0].config.setupExe, 'CodingDungeonsSetup.exe');
  await assert.rejects(() => forge.hooks.preMake(), /requires a Windows signing certificate/);
});

test('the maker rejects packages built with the test inspector enabled', async t => {
  const {forge} = await isolatedForge(t, {debug:true});
  await assert.rejects(() => forge.hooks.preMake(), /without FERRUM_DESKTOP_TEST_PACKAGE/);
});

test('the Windows release pins and verifies the patched Electron archive', () => {
  const {devDependencies} = forgeConfig.hooks.readPackageJson(forgeConfig, {devDependencies:{electron:'45.3.1'}});
  assert.equal(devDependencies.electron, '45.3.2');
  assert.match(forgeConfig.packagerConfig.download.checksums['electron-v45.3.2-win32-x64.zip'], /^[a-f0-9]{64}$/);
});
