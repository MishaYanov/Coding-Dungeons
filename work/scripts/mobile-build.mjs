import {createHash} from 'node:crypto';
import {copyFile, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';

const project = new URL('../../', import.meta.url);

export function mobileBuild() {
  let output;
  return {
    name: 'coding-dungeons-mobile',
    apply: 'build',
    configResolved(config) {
      output = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml() {
      return [
        {tag:'link', attrs:{rel:'manifest', href:'/manifest.webmanifest'}, injectTo:'head'},
        {tag:'link', attrs:{rel:'apple-touch-icon', href:'/icons/coding-dungeons-192.png'}, injectTo:'head'},
        {tag:'meta', attrs:{'http-equiv':'Content-Security-Policy', content:
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'"}, injectTo:'head-prepend'},
      ];
    },
    async closeBundle() {
      const icons = ['192', '512'].map(size => `icons/coding-dungeons-${size}.png`);
      const pages = JSON.parse(await readFile(new URL('data/worlds/javascript/pages.json', project), 'utf8'));
      const book = 'book/javascript/';
      const worldFiles = [book + 'book.pdf', book + 'field-kit.zip',
        ...pages.map(({page}) => book + `pages/${page}.webp`)];
      const mobileFiles = ['manifest.webmanifest', ...icons];
      for (const path of ['styles.css', ...worldFiles, ...mobileFiles]) {
        const file = join(output, path);
        const source = mobileFiles.includes(path) ? 'src/mobile/' : 'public/';
        await mkdir(dirname(file), {recursive:true});
        await copyFile(new URL(source + path, project), file);
      }

      const assets = (await readdir(join(output, 'assets'), {recursive:true, withFileTypes:true}))
        .filter(entry => entry.isFile())
        .map(entry => relative(output, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
      const shellFiles = ['index.html', 'styles.css', ...mobileFiles, ...assets];
      const worker = await readFile(new URL('src/mobile/service-worker.js', project), 'utf8');
      const shellHash = createHash('sha256').update(worker);
      const worldHash = createHash('sha256');
      for (const path of shellFiles) shellHash.update(path + '\0').update(await readFile(join(output, path)));
      for (const path of worldFiles) worldHash.update(path + '\0').update(await readFile(join(output, path)));
      const manifest = {
        shellVersion:shellHash.digest('hex').slice(0, 16),
        worldVersion:worldHash.digest('hex').slice(0, 16),
        shellFiles:shellFiles.map(path => '/' + path),
        worldFiles:worldFiles.map(path => '/' + path),
      };
      await writeFile(join(output, 'sw.js'), 'const offline = ' + JSON.stringify(manifest) + ';\n' + worker);
    },
  };
}
