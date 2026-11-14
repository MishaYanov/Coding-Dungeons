import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {rustFiles} from '../work/scripts/mobile-build.mjs';
import {rustToolchain} from '../lib/mobile/rust-toolchain.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
async function pack(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dungeons-rust-pack-test-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const data = {'rustc.wasm':'compiler', 'sysroot.bundle':'sysroot', 'licenses/rust.txt':'license'};
  const files = Object.fromEntries(Object.entries(data).map(([path, content]) => [path, digest(content)]));
  const trusted = {...rustToolchain, files:{'rustc.wasm':files['rustc.wasm'], 'sysroot.bundle':files['sysroot.bundle']},
    sizes:{'rustc.wasm':Buffer.byteLength(data['rustc.wasm']), 'sysroot.bundle':Buffer.byteLength(data['sysroot.bundle'])}};
  const manifest = {...rustToolchain, files};
  for (const [path, content] of Object.entries(data)) {
    if (path.includes('/')) await mkdir(join(directory, 'licenses'));
    await writeFile(join(directory, path), content);
  }
  const save = () => writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await save();
  return {directory, manifest, save, read:() => rustFiles(directory, trusted)};
}

test('mobile Rust remains disabled without a pack and a verified pack supplies pinned offline assets', async t => {
  const {directory, read} = await pack(t);
  assert.deepEqual(await rustFiles(join(directory, 'absent')), {files:[], integrity:{}});
  const assets = await read();
  assert.deepEqual(assets.files, ['runtime/rust/manifest.json', 'runtime/rust/rustc.wasm',
    'runtime/rust/sysroot.bundle', 'runtime/rust/licenses/rust.txt']);
  assert.equal(assets.integrity['/runtime/rust/rustc.wasm'], digest('compiler'));
  assert.match(assets.integrity['/runtime/rust/manifest.json'], /^[a-f0-9]{64}$/);
  assert.deepEqual(assets.info, {version:'1.96.0-dev', experimental:true});
});

test('a changed Rust compiler, incomplete pack or unsafe manifest cannot enable the mobile runner', async t => {
  const changed = await pack(t);
  await writeFile(join(changed.directory, 'rustc.wasm'), 'different compiler');
  await assert.rejects(changed.read(), /integrity/i);
  const replaced = await pack(t);
  await writeFile(join(replaced.directory, 'rustc.wasm'), 'different compiler');
  replaced.manifest.files['rustc.wasm'] = digest('different compiler');
  await replaced.save();
  await assert.rejects(replaced.read(), /Rust compiler pack/);
  for (const mutate of [
    manifest => { delete manifest.files['rustc.wasm']; },
    manifest => { manifest.files['../outside.wasm'] = digest('outside'); },
    manifest => { manifest.files['sub\\outside.wasm'] = digest('outside'); },
    manifest => { manifest.files['manifest.json'] = digest('recursive'); },
    manifest => { manifest.files['rustc.wasm'] = 'not-a-digest'; },
    manifest => { manifest.compilerRevision = 'untracked'; },
    manifest => { delete manifest.artifactRelease; },
    manifest => { manifest.version = 2; },
    manifest => { manifest.files['rustc.wasm'] = digest('different compiler'); },
  ]) {
    const invalid = await pack(t);
    mutate(invalid.manifest);
    await invalid.save();
    await assert.rejects(invalid.read(), /Rust compiler pack/);
  }
});
