import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const virtualLibrary = 'virtual:workbench-typescript-libraries';
const rootLibrary = 'lib.es2022.d.ts';

export function mobileTypeScript() {
  return {
    name: 'coding-dungeons-typescript-libraries',
    resolveId(id) {
      if (id === virtualLibrary) return '\0' + id;
    },
    async load(id) {
      if (id !== '\0' + virtualLibrary) return;
      const directory = dirname(createRequire(import.meta.url).resolve('typescript'));
      const libraries = new Map();
      const pending = new Set([rootLibrary]);
      // Include only the standard libraries referenced by the grading target.
      for (const name of pending) {
        const path = join(directory, name);
        this.addWatchFile(path);
        const text = await readFile(path, 'utf8');
        libraries.set(name, text);
        for (const match of text.matchAll(/^\s*\/\/\/\s*<reference\s+lib="([a-z0-9.]+)"/gm)) {
          pending.add(`lib.${match[1]}.d.ts`);
        }
      }
      return `export default new Map(${JSON.stringify([...libraries])});`;
    },
  };
}
