import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import forgeConfig from '../desktop/forge.config.cjs';

test('the desktop package copies only the application and excludes local credentials', () => {
  const ignore = forgeConfig.packagerConfig.ignore;
  for (const path of ['', '/server.mjs', '/desktop/preload.cjs', '/infra/run-suite.sh', '/lib/grader.mjs',
    '/data/worlds/go/pages.json', '/dist/renderer/book/javascript/pages/1.webp', '/dist/renderer/book/ferrum-expedition.pdf',
    '/dist/renderer/assets/index-Ab23.js', '/node_modules/quickjs-emscripten/dist/index.js']) {
    assert.equal(ignore(path), false, path);
  }
  for (const path of ['/local-backup.txt', '/.env', '/state/ferrum.sqlite', '/dist/renderer/assets/private.key',
    '/desktop/runtime/credentials.pfx', '/node_modules/package/.env.local', '/data/worlds/go/source.json']) {
    assert.equal(ignore(path), true, path);
  }
});

async function isolatedForge(t) {
  const folder = await mkdtemp(join(tmpdir(), 'dungeons-installer-config-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const config = join(folder, 'desktop', 'forge.config.cjs');
  await Promise.all(['desktop', 'lib'].map(name => mkdir(join(folder, name))));
  for (const path of ['desktop/forge.config.cjs', 'lib/standalone-runner.mjs', 'lib/standalone-runner-harness.mjs']) {
    await copyFile(new URL(`../${path}`, import.meta.url), join(folder, path));
  }
  const {default: forge} = await import(pathToFileURL(config));
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
  const folder = await mkdtemp(join(tmpdir(), 'dungeons-installer-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const setup = join(folder, 'CodingDungeonsSetup.exe');
  const payload = join(folder, 'CodingDungeons-1.0.0-full.nupkg');
  const results = [{artifacts: [setup, payload]}];
  await writeFile(payload, Buffer.alloc(4096));
  await writeFile(setup, Buffer.alloc(256));
  await assert.rejects(() => forgeConfig.hooks.postMake(forgeConfig, results), /offline payload/);

  await writeFile(setup, Buffer.alloc(4200));
  assert.equal(await forgeConfig.hooks.postMake(forgeConfig, results), results);
});
