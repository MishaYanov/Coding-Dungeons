import {createHash} from 'node:crypto';
import {copyFile, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve, sep} from 'node:path';

const project = new URL('../../', import.meta.url);
const worldIds = ['javascript', 'typescript', 'rust', 'go'];
const goPack = new URL('out/mobile-go-pack/', project);
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
  return {
    name: 'coding-dungeons-mobile',
    apply: 'build',
    async configResolved(config) {
      output = resolve(config.root, config.build.outDir);
      runtime = await goFiles();
    },
    resolveId(id) {
      if (id === 'virtual:mobile-go-enabled') return '\0' + id;
    },
    load(id) {
      if (id === '\0virtual:mobile-go-enabled') return 'export default ' + Boolean(runtime.length);
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
      const mobileFiles = ['manifest.webmanifest', ...icons];
      for (const path of ['styles.css', ...books.flat(), ...mobileFiles]) {
        const file = join(output, path);
        const source = path.startsWith('runtime/go/') ? new URL(path.slice('runtime/go/'.length), goPack)
          : new URL((mobileFiles.includes(path) ? 'src/mobile/' : 'public/') + path, project);
        await mkdir(dirname(file), {recursive:true});
        await copyFile(source, file);
      }
      const dependencyNotices = {...notices};
      if (runtime.length) dependencyNotices['browser-wasi-shim.txt'] = ['@bjorn3/browser_wasi_shim', '../LICENSE-MIT'];
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
      };
      await writeFile(join(output, 'sw.js'), 'const offline = ' + JSON.stringify(manifest) + ';\n' + worker);
    },
  };
}
