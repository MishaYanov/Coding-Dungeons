import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zstdCompressSync} from 'node:zlib';
import test from 'node:test';
import {rustToolchain} from '../lib/mobile/rust-toolchain.mjs';
import {extractTarFile, extractPinnedAsset, stageRustPack} from '../work/scripts/mobile-rust-pack.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function tar(...entries) {
  const chunks = [];
  for (const {name, text = '', type = '0'} of entries) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.fill(32, 148, 156);
    header.write(type, 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

test('the Rust archive reader extracts only an exact regular file and handles GNU long names', () => {
  const archive = tar({name:'rustc/', type:'5'}, {name:'ignored.txt', text:'ignore'},
    {name:'././@LongLink', type:'L', text:'rustc/compiler.wasm\0'}, {name:'truncated-name', text:'compiler'});
  assert.equal(extractTarFile(archive, 'rustc/compiler.wasm').toString(), 'compiler');
  for (const archive of [
    tar({name:'rustc/compiler.wasm', type:'2'}),
    tar({name:'rustc/compiler.wasm', text:'one'}, {name:'rustc/compiler.wasm', text:'two'}),
    tar({name:'../outside', text:'bad'}, {name:'rustc/compiler.wasm', text:'compiler'}),
    tar({name:'another', text:'missing'}),
    tar({name:'rustc/compiler.wasm', text:'compiler'}).subarray(0, 514),
  ]) assert.throws(() => extractTarFile(archive, 'rustc/compiler.wasm'), /archive/i);
  const corrupt = tar({name:'rustc/compiler.wasm', text:'compiler'});
  corrupt[0] ^= 1;
  assert.throws(() => extractTarFile(corrupt, 'rustc/compiler.wasm'), /checksum/i);
});

async function fixture(t) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'dungeons-rust-stage-test-'));
  t.after(() => rm(projectDirectory, {recursive:true, force:true}));
  const archivesDirectory = join(projectDirectory, 'archives');
  const licenses = join(projectDirectory, 'resources/mobile-rust');
  await mkdir(archivesDirectory);
  await mkdir(licenses, {recursive:true});
  for (const name of ['LICENSE-APACHE', 'LICENSE-MIT', 'COPYRIGHT', 'NOTICE.txt', 'LICENSE-Weblings']) await writeFile(join(licenses, name), 'license ' + name);
  const contents = {'rustc.wasm':'compiler', 'sysroot.bundle':'sysroot'};
  const toolchain = {...rustToolchain, files:Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, hash(bytes)])),
    sizes:Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, Buffer.byteLength(bytes)]))};
  const archives = [];
  for (const [output, text] of Object.entries(contents)) {
    const entry = 'rustc/' + output;
    const input = zstdCompressSync(tar({name:entry, text}));
    const specification = {name:output + '.tar.zst', output, entry, size:input.length, sha256:hash(input)};
    archives.push(specification);
    await writeFile(join(archivesDirectory, specification.name), input);
  }
  return {projectDirectory, archivesDirectory, toolchain, archives, fetchImplementation:() => assert.fail('An offline stage must not use the network.')};
}

test('offline Rust staging verifies archives and binaries then installs a complete licensed pack', async t => {
  const settings = await fixture(t);
  const result = await stageRustPack(settings);
  const manifest = JSON.parse(await readFile(join(result.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rustVersion, rustToolchain.rustVersion);
  assert.equal(await readFile(join(result.directory, 'rustc.wasm'), 'utf8'), 'compiler');
  assert.equal(manifest.files['licenses/NOTICE.txt'], hash('license NOTICE.txt'));
  assert.equal(Object.keys(manifest.files).length, 7);
  assert.deepEqual(await readdir(join(settings.projectDirectory, 'out')), ['mobile-rust-pack']);
});

test('a mismatched archive or replaced compiler cannot overwrite a prior Rust pack', async t => {
  const settings = await fixture(t);
  const prior = join(settings.projectDirectory, 'out/mobile-rust-pack');
  await mkdir(prior, {recursive:true});
  await writeFile(join(prior, 'sentinel'), 'prior pack');
  const name = settings.archives[0].name;
  await writeFile(join(settings.archivesDirectory, name), 'altered archive');
  await assert.rejects(stageRustPack(settings), /archive.*integrity/i);
  assert.equal(await readFile(join(prior, 'sentinel'), 'utf8'), 'prior pack');
  assert.deepEqual(await readdir(join(settings.projectDirectory, 'out')), ['mobile-rust-pack']);
  const forged = zstdCompressSync(tar({name:settings.archives[0].entry, text:'other code'}));
  const specification = {...settings.archives[0], size:forged.length, sha256:hash(forged)};
  assert.throws(() => extractPinnedAsset(forged, specification, settings.toolchain), /binary.*integrity/i);
});

test('online staging accepts pinned asset bytes through GitHub redirects and refuses other hosts', async t => {
  const settings = await fixture(t);
  const calls = [];
  const fetchImplementation = async (url, options) => {
    calls.push(url.hostname);
    assert.equal(options.redirect, 'manual');
    const name = url.pathname.split('/').at(-1);
    if (url.hostname === 'github.com') return new Response(null, {status:302,
      headers:{location:'https://release-assets.githubusercontent.com/' + name}});
    return new Response(await readFile(join(settings.archivesDirectory, name)));
  };
  await stageRustPack({...settings, archivesDirectory:undefined, fetchImplementation});
  assert.deepEqual(calls, ['github.com', 'release-assets.githubusercontent.com', 'github.com', 'release-assets.githubusercontent.com']);
  let rejectedCalls = 0;
  await assert.rejects(stageRustPack({...settings, archivesDirectory:undefined, fetchImplementation:async () => {
    rejectedCalls++;
    return new Response(null, {status:302, headers:{location:'https://untrusted.invalid/compiler'}});
  }}), /unexpected host/);
  assert.equal(rejectedCalls, 1);
  assert.equal(await readFile(join(settings.projectDirectory, 'out/mobile-rust-pack/rustc.wasm'), 'utf8'), 'compiler');
});
