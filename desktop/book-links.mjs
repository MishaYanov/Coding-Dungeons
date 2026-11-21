import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import rustReference from '../data/rust-docs-reference.json' with { type: 'json' };

const books = [
  'data/pages.json',
  'data/worlds/javascript/pages.json',
  'data/worlds/typescript/pages.json',
  'data/worlds/csharp/pages.json',
  'data/worlds/go/pages.json',
];

export async function trustedBookLinks(appPath) {
  const urls = new Set(rustReference.items.map(entry => entry.url));
  urls.add(rustReference.indexUrl);
  for (const file of books) {
    const data = await readFile(join(appPath, file), 'utf8');
    const pages = JSON.parse(data.replace(/^\uFEFF/, ''));
    for (const page of pages) {
      for (const link of page.links ?? []) {
        if (!link.url) continue;
        try {
          const url = new URL(link.url);
          if (url.protocol === 'https:' && !url.username && !url.password) urls.add(url.href);
        } catch {
          // Invalid catalog links do not become native actions.
        }
      }
    }
  }
  return urls;
}
