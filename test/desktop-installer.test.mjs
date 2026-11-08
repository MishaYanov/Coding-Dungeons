import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
