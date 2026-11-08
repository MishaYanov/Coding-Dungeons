import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { discoverRuntime } from '../desktop/runtime-config.mjs';

async function makeRuntime(t) {
  const dir = await mkdtemp(join(tmpdir(), 'coding-dungeons-runtime-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

test('desktop runtime discovery accepts only the fixed model pair of packaged regular files', async (t) => {
  const directory = await makeRuntime(t);
  const cli = join(directory, 'llama-completion.exe');
  const weights = join(directory, 'gm-model.gguf');
  await writeFile(cli, 'fixture executable');
  await writeFile(join(directory, 'alternative.gguf'), 'outside the runtime contract');
  assert.equal(discoverRuntime(directory).model, undefined);
  await mkdir(weights);
  assert.equal(discoverRuntime(directory).model, undefined);
  await rm(weights, {recursive: true});
  await writeFile(weights, 'fixture weights');
  const {model} = discoverRuntime(directory);
  assert.ok(isAbsolute(model.cli));
  assert.deepEqual(model, {cli, weights});
});

test('the preview capability inventory distinguishes packages from optional files', async (t) => {
  const directory = await makeRuntime(t);
  const inventory = discoverRuntime(directory, name => name === 'quickjs-emscripten');
  assert.deepEqual(inventory.available, {javascript: true, typescript: false, model: false, native: false});
  const missing = discoverRuntime(join(directory, 'not-installed'), () => false);
  assert.deepEqual(missing.available, {javascript: false, typescript: false, model: false, native: false});
});

test('desktop exposes the bundled native directory only with its fixed manifest and executables', async (t) => {
  const directory = await makeRuntime(t);
  const native = join(directory, 'standalone-runner');
  const names = ['broker.exe', 'sandbox-probe.exe', 'wasm-worker/wasm-worker.exe', 'rust/bin/rustc.exe',
    'rust/wasm-linker.exe', 'go/pkg/tool/windows_amd64/compile.exe', 'go/pkg/tool/windows_amd64/link.exe', 'go/stdlib/packages.txt'];
  const manifest = {
    version: 1,
    languages: ['rust', 'go'],
    executables: Object.fromEntries(names.map(name => [name, 'a'.repeat(64)])),
  };
  for (const name of names) {
    const file = join(native, name);
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, 'fixture');
  }
  assert.equal(discoverRuntime(directory).nativeRunner, undefined);
  const manifestFile = join(native, 'native-runner.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  assert.equal(discoverRuntime(directory).nativeRunner, native);
  assert.equal(discoverRuntime(directory).available.native, true);
  const rustOnly = {...manifest, languages: ['rust'], executables: {...manifest.executables}};
  for (const name of names.filter(name => name.startsWith('go/'))) delete rustOnly.executables[name];
  await writeFile(manifestFile, JSON.stringify(rustOnly));
  assert.deepEqual(discoverRuntime(directory).nativeLanguages, ['rust']);
  await writeFile(manifestFile, JSON.stringify({...manifest, executables: {...manifest.executables, '../unexpected.exe': 'a'.repeat(64)}}));
  assert.equal(discoverRuntime(directory).nativeRunner, undefined);
  await writeFile(manifestFile, JSON.stringify(manifest));
  await rm(join(native, names[0]));
  assert.equal(discoverRuntime(directory).nativeRunner, undefined);
});
