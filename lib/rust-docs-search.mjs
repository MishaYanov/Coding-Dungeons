import { rustDocsEntries } from '../data/rust-docs.mjs';

export const RUST_DOC_QUERY_LIMIT = 240;
const RESULT_LIMIT = 3;
const stopWords = new Set(
  ('a an and are as at be by call calling can could do does for from function help how i in into is it ' +
   'its me method my of on or please rust should that the their them there this to use using want what ' +
   'when where which with work works would you but onto about need').split(' '),
);
const equivalentWords = new Map(Object.entries({
  vectors: 'vec', vector: 'vec',
  indices: 'index', indexes: 'index', indexing: 'index', entries: 'entry',
  panicking: 'panic', panics: 'panic', mutable: 'mutate', mutating: 'mutate',
  removing: 'remove', discard: 'remove', blank: 'empty',
  filtering: 'filter', borrowed: 'borrow', borrowing: 'borrow',
}));
const methodNames = new Set(rustDocsEntries.map(card => card.title.split('::').at(-1).toLowerCase()));
const broadWords = new Set('add all change item lookup new one only place preserve put remove take try two value without'.split(' '));
const preserveInput = /\b(?:without|avoid|do not|don't|do not want to|don't want to)\s+(?:chang(?:e|ing)|modif(?:y|ying)|mutat(?:e|ing)|alter(?:ing)?|touch(?:ing)?|edit(?:ing)?)\b|\b(?:unchanged|unmodified|intact)\b/i;
const rankingWords = new Map(Object.entries({
  get: 'lookup', read: 'lookup', find: 'lookup', fetch: 'lookup', access: 'lookup',
  append: 'add', push: 'add', element: 'item',
}));
const preservationWords = new Set('without avoid don t not change changing modify modifying mutate mutating alter altering touch touching edit editing leave unchanged unmodified intact original'.split(' '));

function terms(text) {
  const words = text.toLowerCase().replace(/hash\s+map/g, 'hashmap').match(/[a-z0-9_]+/g) ?? [];
  return new Set(words.filter(word => !stopWords.has(word)).map(word => {
    if (methodNames.has(word)) return word;
    if (equivalentWords.has(word)) return equivalentWords.get(word);
    return word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
  }));
}

const receivers = new Set(rustDocsEntries.map(card => card.receiver.toLowerCase()));
// Rustdoc lists methods available through Deref/DerefMut on these two owners.
// Search those headings as well as the defining receiver, which stays on the card.
const derefOwners = new Map([
  ['slice', ['vec', 'std::vec::vec']],
  ['str', ['string', 'std::string::string']],
]);

// Type names can narrow a search, but alone they do not identify the player's task.
function stripReceivers(words) {
  return [...words].filter(word => !receivers.has(word));
}

function taskWords(text) {
  const preserve = preserveInput.test(text);
  const words = new Set();
  for (const word of stripReceivers(terms(text))) {
    if (preserve && preservationWords.has(word)) continue;
    if (preserve && ['keep', 'remove', 'retain', 'exclude'].includes(word)) words.add('filter');
    else words.add(rankingWords.get(word) ?? word);
  }
  if (preserve) words.add('preserve');
  return words;
}

const index = rustDocsEntries.map(card => {
  const receiver = card.receiver.toLowerCase();
  const owners = /\(\s*&(?:mut\s+)?self\b/.test(card.signature) ? derefOwners.get(receiver) ?? [] : [];
  const phrases = [card.title, card.summary, ...card.aliases];
  const context = new Set([receiver, ...owners]);
  for (const phrase of phrases) {
    for (const word of terms(phrase)) if (receivers.has(word)) context.add(word);
  }
  return {
    card, receiver, owners, context, method: card.title.split('::').at(-1).toLowerCase(),
    phrases: phrases.map(taskWords),
  };
});
const qualifiedNames = new Map();
for (const item of index) {
  for (const owner of item.owners) {
    const path = owner + '::' + item.method;
    if (!qualifiedNames.has(path)) qualifiedNames.set(path, item);
  }
  qualifiedNames.set(item.card.id.toLowerCase(), item);
  qualifiedNames.set(item.card.title.toLowerCase(), item);
}

function nearMethod(word, method) {
  if (word.length < 4 || Math.abs(word.length - method.length) > 1) return false;
  let i = 0;
  while (i < word.length && word[i] === method[i]) i++;
  if (word.length < method.length) return word.slice(i) === method.slice(i + 1);
  if (method.length < word.length) return method.slice(i) === word.slice(i + 1);
  if (word.slice(i + 1) === method.slice(i + 1)) return true;
  return word[i] === method[i + 1] && word[i + 1] === method[i] &&
    word.slice(i + 2) === method.slice(i + 2);
}

function answer(items) {
  if (!items.length) return { kind: 'none', items: [] };
  return { kind: 'results', items: items.slice(0, RESULT_LIMIT).map(item => item.card) };
}

function clarifyOrAnswer(items, namedTypes = []) {
  const choices = [...new Set(items.map(item => item.card.receiver))];
  if (choices.length > 1 && items.every(item => item.method === items[0].method)) {
    if (namedTypes.length === 1) {
      const actual = qualifiedNames.get(namedTypes[0] + '::' + items[0].method);
      if (items.includes(actual)) return answer([actual]);
    }
    return { kind: 'clarify', receivers: choices, items: [] };
  }
  return answer(items);
}

function phraseScore(item, namedTypes, intent) {
  if (namedTypes.length && !namedTypes.some(type => item.context.has(type))) return 0;
  let best = 0;
  for (const phrase of item.phrases) {
    const hits = intent.filter(word => phrase.has(word));
    // "Remove duplicates" and "remove by index" share a verb but ask about different operations.
    if (intent.length > 1 && hits.length === 1 && broadWords.has(hits[0])) continue;
    const coverage = hits.length / intent.length;
    if (coverage < 0.5) continue;
    const precision = hits.length / Math.max(1, phrase.size);
    best = Math.max(best, 0.7 * coverage + 0.3 * precision);
  }
  return best > 0 && namedTypes.includes(item.receiver) ? best + 0.15 : best;
}

/** Retrieve authored Rust reference cards from the bundled index. No user text enters a card. */
export function lookupRustDocs(query, receiver) {
  if (typeof query !== 'string' || query.length > RUST_DOC_QUERY_LIMIT) return answer([]);
  let candidates = receiver === undefined ? index : index.filter(item => item.card.receiver === receiver);
  if (!candidates.length) return answer([]);
  const text = query.toLowerCase().replace(/(?:::)?<[^<>]{1,80}>(?=::)/g, '').replace(/\s*::\s*/g, '::');
  const paths = text.match(/\b(?:[a-z_][a-z_0-9]*::)+[a-z_][a-z_0-9]*\b/g);
  if (paths) {
    // Unknown qualified names must never silently fall back to another type's method.
    const matches = new Set(paths.map(path => qualifiedNames.get(path)).filter(item => candidates.includes(item)));
    return answer([...matches]);
  }

  const words = terms(text);
  if (preserveInput.test(text)) candidates = candidates.filter(item => !item.card.signature.includes('&mut '));
  const typeNames = [...words].filter(word => receivers.has(word));
  if (words.size === 1) {
    const [name] = words;
    const exact = candidates.filter(item => item.method === name);
    if (exact.length) return clarifyOrAnswer(exact);
  }
  if (words.size === 2 && typeNames.length) {
    for (const type of typeNames) {
      const method = [...words].find(word => word !== type);
      const match = qualifiedNames.get(type + '::' + method);
      if (candidates.includes(match)) return answer([match]);
    }
  }
  const intent = stripReceivers(words);
  if (!intent.length) return answer([]);
  if (intent.length === 1) {
    const scope = typeNames.length ? candidates.filter(item => typeNames.includes(item.receiver) ||
      item.owners.some(owner => typeNames.includes(owner))) : candidates;
    const exact = scope.filter(item => item.method === intent[0]);
    if (exact.length) return clarifyOrAnswer(exact);
    const similar = scope.filter(item => nearMethod(intent[0], item.method));
    if (similar.length) return clarifyOrAnswer(similar, typeNames);
    if (typeNames.length && methodNames.has(intent[0])) return answer([]);
  }

  const task = [...taskWords(text)];
  const ranked = candidates.map(item => ({ item, score: phraseScore(item, typeNames, task) }))
    .filter(match => match.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return answer([]);
  const close = ranked.filter(match => match.score >= ranked[0].score * 0.9);
  return clarifyOrAnswer(close.map(match => match.item), typeNames);
}
