import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as zlib from 'node:zlib';
import {rustArchives, rustToolchain} from '../../lib/mobile/rust-toolchain.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const maxTarBytes = 256 * 1024 * 1024;
const licenseNames = ['LICENSE-APACHE', 'LICENSE-MIT', 'COPYRIGHT', 'NOTICE.txt', 'LICENSE-Weblings'];
const hash = value => createHash('sha256').update(value).digest('hex');
const archiveError = message => new Error('Rust archive ' + message + '.');
const field = bytes => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)).toString('utf8');
function octal(bytes) {
  const value = field(bytes).trim();
  if (!/^[0-7]+$/.test(value)) throw archiveError('has an invalid numeric field');
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) throw archiveError('has an oversized numeric field');
  return number;
}
function safeArchivePath(path) {
  return path.length <= 4096 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/?$/.test(path)
    && !path.split('/').some(part => part === '.' || part === '..');
}

// Interpret only the pinned TAR format. No archive-controlled name is written to disk.
export function extractTarFile(bytes, wanted) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maxTarBytes || !safeArchivePath(wanted)) throw archiveError('is invalid');
  let selected;
  let longName;
  let ended = false;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (bytes.length - offset < 1024 || bytes.subarray(offset).some(byte => byte !== 0)) throw archiveError('has an invalid end marker');
      ended = true;
      break;
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== octal(header.subarray(148, 156))) throw archiveError('checksum failed');
    const magic = header.toString('ascii', 257, 263);
    if (magic !== 'ustar\0' && magic !== 'ustar ') throw archiveError('uses an unsupported format');
    const length = octal(header.subarray(124, 136));
    const bodyStart = offset + 512;
    const next = bodyStart + Math.ceil(length / 512) * 512;
    if (length > maxTarBytes || next > bytes.length) throw archiveError('is truncated');
    const body = bytes.subarray(bodyStart, bodyStart + length);
    const type = header[156];
    if (type === 76) {
      if (longName !== undefined || length > 4096 || !length || body.at(-1) !== 0) throw archiveError('has invalid long-name metadata');
      longName = field(body);
      if (!safeArchivePath(longName)) throw archiveError('contains an unsafe path');
    } else {
      const prefix = magic === 'ustar\0' ? field(header.subarray(345, 500)) : '';
      const name = longName ?? (prefix ? prefix + '/' : '') + field(header.subarray(0, 100));
      longName = undefined;
      if (!safeArchivePath(name) || ![0, 48, 53].includes(type)) throw archiveError('contains an unsafe entry');
      if (type === 53 && length) throw archiveError('contains an invalid directory');
      if (name === wanted) {
        if (type === 53 || selected !== undefined) throw archiveError('contains an invalid or duplicate target');
        selected = body;
      }
    }
    offset = next;
  }
  if (!ended || longName !== undefined || selected === undefined) throw archiveError('is incomplete or missing its target');
  return Buffer.from(selected);
}

export function extractPinnedAsset(input, specification, toolchain = rustToolchain) {
  if (input.length !== specification.size || hash(input) !== specification.sha256) throw archiveError('integrity check failed for ' + specification.name);
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('Use a Node.js release with built-in Zstandard support to stage Rust.');
  const tar = zlib.zstdDecompressSync(input, {maxOutputLength:maxTarBytes});
  const result = extractTarFile(tar, specification.entry);
  if (result.length !== toolchain.sizes[specification.output] || hash(result) !== toolchain.files[specification.output]) {
    throw new Error('Rust binary integrity check failed for ' + specification.output + '.');
  }
  return result;
}

async function download(specification, release, fetchImplementation) {
  let url = new URL(`https://github.com/AngelOnFira/wasm-rustc/releases/download/${release}/${specification.name}`);
  const signal = AbortSignal.timeout(180_000);
  for (let redirects = 0; redirects < 5; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
      || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
      throw archiveError('download used an unexpected host');
    }
    const response = await fetchImplementation(url, {redirect:'manual', signal});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw archiveError('download has no redirect location');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw archiveError('download failed for ' + specification.name);
    }
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > specification.size) throw archiveError('download exceeded its pinned size');
      parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  }
  throw archiveError('download had too many redirects');
}

function inside(root, target) {
  const path = relative(root, resolve(target));
  if (!path || path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) throw new Error('Rust staging path escaped its output directory.');
}

export async function stageRustPack({projectDirectory = project, archivesDirectory, toolchain = rustToolchain,
  archives = rustArchives, fetchImplementation = fetch} = {}) {
  const expectedOutputs = new Set([toolchain.compiler, toolchain.sysroot]);
  if (archives.length !== expectedOutputs.size || new Set(archives.map(item => item.output)).size !== archives.length
    || archives.some(item => !expectedOutputs.has(item.output) || !/^[A-Za-z0-9_.-]+$/.test(item.name))) {
    throw archiveError('specifications do not contain exactly the compiler and sysroot');
  }
  let out = resolve(projectDirectory, 'out');
  await mkdir(out, {recursive:true});
  if ((await lstat(out)).isSymbolicLink()) throw new Error('Rust staging output must be a real project directory.');
  out = await realpath(out);
  const output = join(out, 'mobile-rust-pack');
  const prior = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (prior && !prior.isDirectory()) throw new Error('The Rust pack destination must be a directory.');
  const scratch = await mkdtemp(join(out, '.mobile-rust-'));
  const staged = join(scratch, 'sdk');
  const backup = join(scratch, 'previous');
  for (const path of [scratch, staged, output, backup]) inside(out, path);
  let keepBackup = false;
  try {
    await mkdir(join(staged, 'licenses'), {recursive:true});
    const files = {...toolchain.files};
    for (const name of licenseNames) {
      const source = join(projectDirectory, 'resources/mobile-rust', name);
      const info = await lstat(source);
      if (!info.isFile() || !info.size || info.size > 2 * 1024 * 1024) throw new Error('Missing or invalid Rust runtime license: ' + name);
      const bytes = await readFile(source);
      const path = 'licenses/' + name;
      files[path] = hash(bytes);
      await writeFile(join(staged, path), bytes);
    }
    for (const specification of archives) {
      let input;
      if (archivesDirectory) {
        const path = join(resolve(archivesDirectory), specification.name);
        const info = await lstat(path);
        if (!info.isFile() || info.size !== specification.size) throw archiveError('integrity check failed for ' + specification.name);
        input = await readFile(path);
      } else input = await download(specification, toolchain.artifactRelease, fetchImplementation);
      const bytes = extractPinnedAsset(input, specification, toolchain);
      if (![toolchain.compiler, toolchain.sysroot].includes(specification.output)) throw archiveError('has an unknown output');
      await writeFile(join(staged, specification.output), bytes);
    }
    await writeFile(join(staged, 'manifest.json'), JSON.stringify({...toolchain, files}, null, 2) + '\n');
    if (prior) await rename(output, backup);
    try {
      await rename(staged, output);
    } catch (error) {
      if (prior) {
        try { await rename(backup, output); } catch (restoreError) {
          keepBackup = true;
          throw new AggregateError([error, restoreError], `Previous Rust pack remains at ${backup}.`);
        }
      }
      throw error;
    }
    return {directory:output, version:toolchain.rustVersion, bytes:Object.values(toolchain.sizes).reduce((sum, size) => sum + size, 0)};
  } finally {
    if (!keepBackup && dirname(scratch) === out) await rm(scratch, {recursive:true, force:true, maxRetries:3});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--archives')) throw new Error('Usage: node work/scripts/mobile-rust-pack.mjs [--archives directory]');
  const result = await stageRustPack({archivesDirectory:args[1]});
  console.log(`Staged experimental Rust ${result.version} (${(result.bytes / 1024 / 1024).toFixed(1)} MiB) in ${result.directory}.`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
