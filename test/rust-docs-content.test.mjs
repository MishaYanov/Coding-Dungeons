import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rustDocsEntries, rustDocsIndexUrl, rustDocsLicense, rustDocsVersion,
} from '../data/rust-docs.mjs';

test('every offline card has unique identity, local reading notes and a pinned official topic', () => {
  const urls = new Set();
  const titles = new Set();
  const ids = new Set();
  for (const item of rustDocsEntries) {
    assert.ok(item.id.startsWith('std::'), item.id);
    assert.equal(item.title.split('::')[0], item.receiver);
    for (const field of ['signature', 'summary', 'detail', 'excerpt']) {
      assert.equal(typeof item[field], 'string', item.id + '.' + field);
      assert.ok(item[field].trim(), item.id + '.' + field);
    }
    assert.ok(item.aliases.some(alias => alias.includes(' ')), item.id);
    assert.match(item.since, /^\d+\.\d+\.\d+$/);
    const url = new URL(item.url);
    assert.equal(url.origin, 'https://doc.rust-lang.org');
    assert.equal(url.search + url.username + url.password, '');
    assert.ok(url.href.startsWith(rustDocsIndexUrl));
    assert.ok(url.pathname.endsWith('.html'));
    if (url.hash) {
      assert.equal(url.hash, '#method.' + item.title.split('::')[1]);
    } else {
      assert.ok(url.pathname.endsWith('/fn.' + item.title.split('::')[1] + '.html'));
    }
    urls.add(item.url);
    titles.add(item.title);
    ids.add(item.id);
  }
  for (const unique of [urls, titles, ids]) assert.equal(unique.size, rustDocsEntries.length);
});

test('offline reference retains Rust release attribution, method bounds and distinct borrowed receivers', () => {
  assert.equal(rustDocsIndexUrl, `https://doc.rust-lang.org/${rustDocsVersion}/std/`);
  assert.match(rustDocsLicense, /Copyright \(c\) The Rust Project Contributors/);
  assert.match(rustDocsLicense, /Permission is hereby granted/);
  assert.match(rustDocsLicense, /THE SOFTWARE IS PROVIDED "AS IS"/);
  const byTitle = new Map(rustDocsEntries.map(item => [item.title, item]));
  assert.match(byTitle.get('Vec::retain').signature, /&mut self.*FnMut\(&T\) -> bool/);
  assert.match(byTitle.get('String::retain').signature, /&mut self.*FnMut\(char\) -> bool/);
  assert.match(byTitle.get('Iterator::filter').signature, /FnMut\(&Self::Item\) -> bool/);
  assert.match(byTitle.get('thread::spawn').signature, /Send \+ 'static/);
  assert.match(byTitle.get('mem::take').signature, /T: Default/);
});
