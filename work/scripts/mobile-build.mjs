import {createHash} from 'node:crypto';
import {copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rustToolchain} from '../../lib/mobile/rust-toolchain.mjs';

const project = new URL('../../', import.meta.url);
const worldIds = ['javascript', 'typescript', 'rust', 'go'];
const goPack = new URL('out/mobile-go-pack/', project);
const rustPack = new URL('out/mobile-rust-pack/', project);
const require = createRequire(import.meta.url);
const notices = {
  'react.txt':['react/package.json', 'LICENSE'],
  'react-dom.txt':['react-dom/package.json', 'LICENSE'],
  'scheduler.txt':['scheduler/package.json', 'LICENSE'],
  'typescript.txt':['typescript/package.json', 'LICENSE.txt'],
  'quickjs.txt':['@jitl/quickjs-wasmfile-release-sync/package.json', 'LICENSE'],
  'quickjs-emscripten-core.txt':['quickjs-emscripten-core', '../LICENSE'],
};

async function goFiles() {
  const manifest = await readFile(new URL('manifest.json', goPack), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!manifest) return [];
  const {version, compiler, linker, packages} = JSON.parse(manifest);
  const archives = Object.values(packages);
  if (version !== '1.27.4' || compiler !== 'compile.wasm' || linker !== 'link.wasm' || !archives.length
    || archives.some(name => !/^\d{4}\.a$/.test(name)) || new Set(archives).size !== archives.length) {
    throw new Error('Restage the Go compiler pack with npm run mobile:stage-go.');
  }
  return ['manifest.json', compiler, linker, ...archives, 'LICENSE', 'PATENTS'].map(file => 'runtime/go/' + file);
}

export async function rustFiles(directory = rustPack, trusted = rustToolchain) {
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory);
  const manifestPath = join(root, 'manifest.json');
  const entry = await lstat(manifestPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!entry) return {files:[], integrity:{}};
  const invalid = () => new Error('Restage the Rust compiler pack with npm run mobile:stage-rust.');
  if (!entry.isFile() || entry.size > 64 * 1024) throw invalid();
  const bytes = await readFile(manifestPath);
  let manifest;
  try { manifest = JSON.parse(bytes); } catch { throw invalid(); }
  if (!manifest || ['version', 'compiler', 'sysroot', 'rustVersion', 'artifactRelease', 'compilerRevision']
    .some(key => manifest[key] !== trusted[key])
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw invalid();
  const files = Object.entries(manifest.files);
  if (files.length < 2 || files.length > 256 || !Object.hasOwn(manifest.files, manifest.compiler)
    || !Object.hasOwn(manifest.files, manifest.sysroot) || files.some(([path, hash]) => path.length > 240
      || path === 'manifest.json' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(path)
      || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw invalid();
  if (Object.entries(trusted.files).some(([path, hash]) => manifest.files[path] !== hash)) throw invalid();
  const canonicalRoot = await realpath(root);
  if (await realpath(manifestPath) !== join(canonicalRoot, 'manifest.json')) throw invalid();
  const integrity = {'/runtime/rust/manifest.json':createHash('sha256').update(bytes).digest('hex')};
  for (const [path, expected] of files) {
    const file = join(root, path);
    const entry = await lstat(file);
    if (!entry.isFile() || await realpath(file) !== join(canonicalRoot, path)) throw invalid();
    if (Object.hasOwn(trusted.sizes, path) && entry.size !== trusted.sizes[path]) {
      throw new Error(`Rust compiler pack integrity check failed for ${path}.`);
    }
    const actual = createHash('sha256').update(await readFile(file)).digest('hex');
    if (actual !== expected) throw new Error(`Rust compiler pack integrity check failed for ${path}.`);
    integrity['/runtime/rust/' + path] = expected;
  }
  return {files:['manifest.json', ...files.map(([path]) => path)].map(path => 'runtime/rust/' + path),
    integrity, info:{version:manifest.rustVersion, experimental:true}};
}

async function bookFiles(id) {
  const rust = id === 'rust';
  const pageIndex = rust ? 'data/pages.json' : `data/worlds/${id}/pages.json`;
  const pages = JSON.parse((await readFile(new URL(pageIndex, project), 'utf8')).replace(/^\uFEFF/, ''));
  const book = rust ? 'book/' : `book/${id}/`;
  return [
    book + (rust ? 'ferrum-expedition.pdf' : 'book.pdf'),
    book + (rust ? 'ferrum-field-kit.zip' : 'field-kit.zip'),
    ...pages.map(({page}) => book + `pages/${page}.webp`),
  ];
}

async function contentVersion(output, files, seed = '') {
  const hash = createHash('sha256').update(seed);
  for (const path of files) hash.update(path + '\0').update(await readFile(join(output, path)));
  return hash.digest('hex').slice(0, 16);
}

export function mobileBuild() {
  let output;
  let runtime;
  let rustRuntime;
  return {
    name: 'coding-dungeons-mobile',
    apply: 'build',
    async configResolved(config) {
      output = resolve(config.root, config.build.outDir);
      runtime = await goFiles();
      rustRuntime = await rustFiles();
    },
    resolveId(id) {
      if (['virtual:mobile-go-enabled', 'virtual:mobile-rust-enabled', 'virtual:mobile-rust-info'].includes(id)) return '\0' + id;
    },
    load(id) {
      if (id === '\0virtual:mobile-go-enabled') return 'export default ' + Boolean(runtime.length);
      if (id === '\0virtual:mobile-rust-enabled') return 'export default ' + Boolean(rustRuntime.files.length);
      if (id === '\0virtual:mobile-rust-info') return 'export default ' + JSON.stringify(rustRuntime.info ?? null);
    },
    transformIndexHtml() {
      return [
        {tag:'link', attrs:{rel:'manifest', href:'/manifest.webmanifest'}, injectTo:'head'},
        {tag:'link', attrs:{rel:'apple-touch-icon', href:'/icons/coding-dungeons-192.png'}, injectTo:'head'},
        {tag:'meta', attrs:{'http-equiv':'Content-Security-Policy', content:
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'"}, injectTo:'head-prepend'},
      ];
    },
    async writeBundle() {
      const icons = ['192', '512'].map(size => `icons/coding-dungeons-${size}.png`);
      const books = await Promise.all(worldIds.map(bookFiles));
      books[worldIds.indexOf('go')].push(...runtime);
      books[worldIds.indexOf('rust')].push(...rustRuntime.files);
      const mobileFiles = ['manifest.webmanifest', ...icons];
      for (const path of ['styles.css', ...books.flat(), ...mobileFiles]) {
        const file = join(output, path);
        const source = path.startsWith('runtime/rust/') ? new URL(path.slice('runtime/rust/'.length), rustPack)
          : path.startsWith('runtime/go/') ? new URL(path.slice('runtime/go/'.length), goPack)
          : new URL((mobileFiles.includes(path) ? 'src/mobile/' : 'public/') + path, project);
        await mkdir(dirname(file), {recursive:true});
        await copyFile(source, file);
      }
      const dependencyNotices = {...notices};
      if (runtime.length || rustRuntime.files.length) dependencyNotices['browser-wasi-shim.txt'] = ['@bjorn3/browser_wasi_shim', '../LICENSE-MIT'];
      const licenseDirectory = join(output, 'licenses');
      await mkdir(licenseDirectory, {recursive:true});
      await copyFile(new URL('LICENSE', project), join(licenseDirectory, 'coding-dungeons.txt'));
      for (const [name, [dependency, license]] of Object.entries(dependencyNotices)) {
        const source = dirname(require.resolve(dependency));
        await copyFile(join(source, license), join(licenseDirectory, name));
      }

      const assets = (await readdir(join(output, 'assets'), {recursive:true, withFileTypes:true}))
        .filter(entry => entry.isFile())
        .map(entry => relative(output, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
      const shellFiles = ['index.html', 'styles.css', ...mobileFiles, ...assets,
        'licenses/coding-dungeons.txt', ...Object.keys(dependencyNotices).map(name => 'licenses/' + name)];
      const worker = await readFile(new URL('src/mobile/service-worker.js', project), 'utf8');
      const worlds = await Promise.all(books.map(async (files, index) => [worldIds[index], {
        number:index + 1, version:await contentVersion(output, files), files:files.map(path => '/' + path),
      }]));
      const manifest = {
        shellVersion:await contentVersion(output, shellFiles, worker),
        shellFiles:shellFiles.map(path => '/' + path),
        worlds:Object.fromEntries(worlds),
        integrity:rustRuntime.integrity,
      };
      await writeFile(join(output, 'sw.js'), 'const offline = ' + JSON.stringify(manifest) + ';\n' + worker);
    },
  };
}
