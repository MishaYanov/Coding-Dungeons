import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import catalog from '../../data/workbench/go.mjs';
import { definitions } from '../../lib/diamond-content.mjs';

const version = '1.27.4';
const project = fileURLToPath(new URL('../../', import.meta.url));
const out = join(project, 'out');
const output = join(out, 'mobile-go-pack');
const go = process.env.GO || 'go';
const exec = promisify(execFile);
const packageName = /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/;
// Include course reference imports and broadly useful alternatives used in lessons.
// Add to this list when extending the course to new standard library packages.
const libraries = new Set([
  'bytes', 'cmp', 'context', 'encoding/json', 'errors', 'fmt', 'io', 'maps', 'math', 'reflect', 'runtime',
  'slices', 'sort', 'strconv', 'strings', 'sync', 'sync/atomic', 'time', 'unicode', 'unicode/utf8',
  ...[...catalog, definitions.go].flatMap(exercise => exercise.tests.flatMap(fixture => fixture.imports ?? [])),
]);

async function run(args, cwd, env) {
  try {
    return (await exec(go, args, { cwd, env, windowsHide:true, timeout:600_000, maxBuffer:2 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message, {cause:error});
  }
}

async function install(staged, backup) {
  let hasBackup = false;
  try {
    await rename(output, backup);
    hasBackup = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(staged, output);
  } catch (error) {
    if (hasBackup) await rename(backup, output).catch(restoreError => {
      throw new AggregateError([error, restoreError], `Previous Go pack remains at ${backup}.`);
    });
    throw error;
  }
}

async function main() {
  if (![...libraries].every(name => packageName.test(name))) throw new Error('Invalid Go package in the mobile course.');
  if (go !== 'go' && !isAbsolute(go)) throw new Error('Set GO to the absolute path to the trusted Go executable.');
  const hostEnv = { ...process.env, GOROOT:'', GOENV:'off', GOTOOLCHAIN:'local' };
  const reported = await run(['version'], project, hostEnv);
  if (!reported.startsWith(`go version go${version} `)) throw new Error(`Mobile Go needs Go ${version}. Found ${reported}.`);
  const goroot = await run(['env', 'GOROOT'], project, hostEnv);

  await mkdir(out, {recursive:true});
  const scratch = await mkdtemp(join(out, '.mobile-go-'));
  const staged = join(scratch, 'sdk');
  const backup = join(scratch, 'previous');
  const cache = join(scratch, 'cache');
  let recoverNeeded = false;
  try {
    await mkdir(staged);
    const env = {
      ...hostEnv, GOROOT:goroot, GOOS:'wasip1', GOARCH:'wasm', CGO_ENABLED:'0', GOCACHE:cache,
      GOFLAGS:'', GOEXPERIMENT:'', GOWASM:'', GO111MODULE:'off', GOWORK:'off', GOPROXY:'off', GOSUMDB:'off',
    };
    for (const tool of ['compile', 'link']) {
      await run(['build', '-p=2', '-trimpath', '-ldflags=-buildid=', '-o', join(staged, `${tool}.wasm`), `cmd/${tool}`], scratch, env);
    }
    const listing = await run(['list', '-p=2', '-trimpath', '-deps', '-export', '-f',
      '{{if .Export}}{{.ImportPath}}|{{.Export}}{{end}}', ...libraries], scratch, env);
    const archives = new Map();
    for (const row of listing.split(/\r?\n/).filter(Boolean)) {
      const [name, path] = row.split('|');
      const location = path && relative(cache, path);
      if (!packageName.test(name) || !location || location.startsWith('..') || isAbsolute(location) || archives.has(name)) {
        throw new Error('Unexpected archive in the Go toolchain output.');
      }
      archives.set(name, path);
    }
    if (![...libraries].every(name => archives.has(name))) throw new Error('A required Go archive is missing.');

    const packages = Object.create(null);
    for (const [index, name] of [...archives.keys()].sort().entries()) {
      const file = `${String(index + 1).padStart(4, '0')}.a`;
      await copyFile(archives.get(name), join(staged, file));
      packages[name] = file;
    }
    for (const name of ['LICENSE', 'PATENTS']) await copyFile(join(goroot, name), join(staged, name));
    const manifest = {version, compiler:'compile.wasm', linker:'link.wasm', packages};
    await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    try {
      await install(staged, backup);
    } catch (error) {
      recoverNeeded = error instanceof AggregateError;
      throw error;
    }
    console.log(`Staged Go ${version} and ${archives.size} standard library archives in ${output}.`);
  } finally {
    if (!recoverNeeded && dirname(scratch) === out) await rm(scratch, {recursive:true, force:true, maxRetries:3});
  }
}

await main();
