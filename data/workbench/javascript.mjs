const example = (id, code) => ({ id, code, visibility: 'public', group: 'Examples' });
const sealed = (id, group, code) => ({ id, code, visibility: 'sealed', group });

export default [
  {
    id: 'js-make-badge', level: 1,
    reference: `function makeBadge(rawName) {
  const name = rawName.trim().toUpperCase();
  return { name, visits: 0 };
}`,
    tests: [
      example('normalize-name', `const badge = makeBadge('  Jo ');
assert(badge.name === 'JO' && badge.visits === 0, 'Expected a badge named JO with zero visits.');`),
      sealed('fresh-badges', 'Identity', `const first = makeBadge('Jo');
const second = makeBadge('Jo');
first.visits++;
assert(first !== second && first.visits === 1 && second.visits === 0);`),
      sealed('blank-name', 'Edges', `const badge = makeBadge('  ');
assert(badge.name === '' && badge.visits === 0 && Object.keys(badge).sort().join(',') === 'name,visits');`),
    ],
  },
  {
    id: 'js-read-limit', level: 2,
    reference: `function readLimit(raw, fallback) {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}`,
    tests: [
      example('number-and-default', `assert(readLimit('0', 7) === 0 && readLimit(' 12 ', 7) === 12,
  'Zero is a valid limit, and the number may have surrounding spaces.');
assert(readLimit('  ', 7) === 7, 'Blank input uses the fallback.');`),
      sealed('nullish-fallback', 'Edges', `assert(readLimit(null, 0) === 0 && readLimit(undefined, 4) === 4);`),
      sealed('invalid-and-number-syntax', 'Validation', `for (const raw of ['3.5', 'oops', '-1', 'Infinity', 'NaN']) {
  assert(readLimit(raw, 9) === null);
}
assert(readLimit('0x10', 1) === 16 && readLimit('1e2', 1) === 100);`),
    ],
  },
  {
    id: 'js-quantities-for', level: 3,
    reference: `function quantitiesFor(shipments, id) {
  const quantities = [];
  for (const shipment of shipments) {
    if (shipment.id === id) quantities.push(shipment.quantity);
  }
  return quantities;
}`,
    tests: [
      example('matching-order', `const input = [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 8 }, { id: 'a', quantity: 4 }];
assert(JSON.stringify(quantitiesFor(input, 'a')) === '[2,4]', 'Collect matching quantities in input order.');`),
      sealed('keeps-zero', 'Edges', `const input = Object.freeze([
  Object.freeze({ id: 'a', quantity: 0 }), Object.freeze({ id: 'a', quantity: 5 }),
]);
assert(JSON.stringify(quantitiesFor(input, 'a')) === '[0,5]');`),
      sealed('fresh-no-match', 'Identity', `const input = [{ id: 'not-matched', quantity: 6 }];
const first = quantitiesFor(input, 'other');
const second = quantitiesFor(input, 'other');
assert(Array.isArray(first) && first.length === 0 && first !== second && first !== input);
assert(Array.isArray(quantitiesFor([], 'other')) && quantitiesFor([], 'other').length === 0);`),
    ],
  },
  {
    id: 'js-shipping-cents', level: 4,
    reference: `function shippingCents(subtotalCents, delivery = 'standard') {
  if (delivery === 'express') return 1200;
  return subtotalCents >= 5000 ? 0 : 500;
}`,
    tests: [
      example('standard-fee', `assert(shippingCents(2500, 'standard') === 500, 'Standard shipping below 5000 costs 500.');`),
      sealed('threshold-and-default', 'Edges', `assert(shippingCents(4999) === 500 && shippingCents(5000) === 0);
assert(shippingCents(5001, 'standard') === 0 && shippingCents(0) === 500);`),
      sealed('express-ignores-threshold', 'Delivery Modes', `for (const subtotal of [0, 4999, 5000, 12_000]) {
  assert(shippingCents(subtotal, 'express') === 1200);
}`),
    ],
  },
  {
    id: 'js-pending-summary', level: 5,
    reference: `function pendingSummary(tasks) {
  let count = 0;
  let minutes = 0;
  for (const task of tasks) {
    if (task.done) continue;
    count++;
    minutes += task.minutes;
  }
  return { count, minutes };
}`,
    tests: [
      example('unfinished-only', `const summary = pendingSummary([{ done: true, minutes: 100 }, { done: false, minutes: 7 }]);
assert(summary.count === 1 && summary.minutes === 7, 'Only unfinished tasks contribute to the totals.');`),
      sealed('counts-zero-minutes', 'Edges', `const summary = pendingSummary([
  { done: false, minutes: 0 }, { done: false, minutes: 13 }, { done: true, minutes: 2 },
]);
assert(summary.count === 2 && summary.minutes === 13);`),
      sealed('empty-and-complete', 'Edges', `for (const tasks of [[], [{ done: true, minutes: 10 }]]) {
  const summary = pendingSummary(tasks);
  assert(summary.count === 0 && summary.minutes === 0);
}`),
    ],
  },
  {
    id: 'js-decode-item', level: 6,
    reference: `function decodeItem(text) {
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Object.hasOwn(value, 'id') || typeof value.id !== 'string'
      || !Object.hasOwn(value, 'count') || !Number.isInteger(value.count) || value.count < 0) return null;
  const id = value.id.trim();
  return id ? { id, count: value.count } : null;
}`,
    tests: [
      example('decode-valid-item', `const item = decodeItem('{"id":"  crates  ","count":0}');
assert(item?.id === 'crates' && item.count === 0, 'Trim the ID and accept zero.');`),
      sealed('reject-invalid-shapes', 'Validation', `for (const raw of [
  'null', '[]', '[{"id":"dock","count":1}]', '42', '"x"', '{}', '{"id":"x"}', '{"count":2}',
  '{"id":5,"count":2}', '{"id":" ","count":0}', '{"id":"x","count":"2"}',
  '{"id":"x","count":2.5}', '{"id":"x","count":-1}', '{"id":"x","count":true}',
]) assert(decodeItem(raw) === null);`),
      sealed('project-exact-fields', 'Shape', `const raw = '{"count":1,"id":"Cargo","extra":true}';
const first = decodeItem(raw);
const second = decodeItem(raw);
assert(first !== second && first.id === 'Cargo' && first.count === 1);
assert(Object.keys(first).sort().join(',') === 'count,id');`),
    ],
  },
  {
    id: 'js-parse-count', level: 7,
    reference: `function parseCount(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, reason: 'syntax' };
  }
  if (!Number.isInteger(value) || value < 0) return { ok: false, reason: 'count' };
  return { ok: true, value };
}`,
    tests: [
      example('zero-and-syntax-error', `const zero = parseCount('0');
const broken = parseCount('{');
assert(zero.ok === true && zero.value === 0, 'Valid JSON zero is a valid count.');
assert(broken.ok === false && broken.reason === 'syntax', 'Malformed JSON is a syntax error.');`),
      sealed('rejects-count-shapes', 'Validation', `for (const raw of ['-1', '1.5', '"2"', 'null', 'true', '[2]', '{}']) {
  const parsed = parseCount(raw);
  assert(parsed.ok === false && parsed.reason === 'count');
}`),
      sealed('json-grammar-and-conversion', 'Edges', `for (const raw of ['', '02', '+2', '2,3']) {
  const parsed = parseCount(raw);
  assert(parsed.ok === false && parsed.reason === 'syntax');
}
assert(parseCount('2.0').value === 2 && parseCount('1e2').value === 100);`),
    ],
  },
  {
    id: 'js-ticket-dispenser', level: 8,
    reference: `function makeTicketDispenser(prefix) {
  let count = 0;
  return {
    next() {
      count++;
      return prefix + '-' + count;
    },
    issued() { return count; },
  };
}`,
    tests: [
      example('issues-in-order', `const dispenser = makeTicketDispenser('LAB');
assert(dispenser.issued() === 0 && dispenser.next() === 'LAB-1' && dispenser.next() === 'LAB-2',
  'A new dispenser starts at zero and numbers tickets from one.');
assert(dispenser.issued() === 2);`),
      sealed('independent-counters', 'State', `const first = makeTicketDispenser('LAB');
const second = makeTicketDispenser('LAB');
const third = makeTicketDispenser('P');
assert(first.next() === 'LAB-1' && first.next() === 'LAB-2');
assert(second.issued() === 0 && second.next() === 'LAB-1' && first.issued() === 2);
assert(third.next() === 'P-1' && third.issued() === 1 && third.issued() === 1);`),
    ],
  },
  {
    id: 'js-set-theme', level: 9,
    reference: `function setTheme(profile, theme) {
  return { ...profile, settings: { ...profile.settings, theme } };
}`,
    tests: [
      example('copy-theme-path', `const profile = { name: 'Jo', settings: { theme: 'light', zoom: 2 }, tags: ['captain'] };
const result = setTheme(profile, 'dark');
assert(result.settings.theme === 'dark' && profile.settings.theme === 'light', 'Change the returned theme only.');
assert(result.settings.zoom === 2 && result.name === 'Jo');`),
      sealed('shares-only-untouched-data', 'Identity', `const tags = Object.freeze(['a']);
const settings = Object.freeze({ theme: 'dark', locale: 'en' });
const profile = Object.freeze({ settings, tags, active: false });
const result = setTheme(profile, 'dark');
assert(result !== profile && result.settings !== settings && result.tags === tags);
assert(result.active === false && result.settings.locale === 'en' && profile.settings.theme === 'dark');`),
    ],
  },
  {
    id: 'js-leaderboard', level: 10,
    reference: `function leaderboard(players) {
  return players.filter(player => player.active === true)
    .sort((left, right) => right.score - left.score)
    .map(player => player.name);
}`,
    tests: [
      example('numeric-order', `const input = [
  { name: 'Nia', score: 2, active: true }, { name: 'Jo', score: 10, active: true },
];
assert(JSON.stringify(leaderboard(input)) === '["Jo","Nia"]', 'Sort active players by numeric score, highest first.');`),
      sealed('stable-ties-and-active-flag', 'Ordering', `const players = Object.freeze([
  Object.freeze({ name: 'Zed', score: 9, active: true }), Object.freeze({ name: 'Out', score: 90, active: false }),
  Object.freeze({ name: 'Ari', score: 9, active: true }), Object.freeze({ name: 'Truthy', score: 90, active: 1 }),
  Object.freeze({ name: 'Neg', score: -4, active: true }),
]);
assert(JSON.stringify(leaderboard(players)) === '["Zed","Ari","Neg"]');
assert(players[0].name === 'Zed' && players[1].name === 'Out');`),
      sealed('empty-rankings', 'Edges', `const empty = leaderboard([]);
assert(Array.isArray(empty) && empty.length === 0 && empty !== leaderboard([]));
assert(leaderboard([{ name: 'Out', score: 9, active: false }]).length === 0);`),
    ],
  },
  {
    id: 'js-load-in-order', level: 11,
    reference: `async function loadInOrder(ids, load) {
  return Promise.all(ids.map(id => load(id)));
}`,
    tests: [
      example('collect-values', `const values = await loadInOrder([2, 1], async id => id * 10);
assert(JSON.stringify(values) === '[20,10]', 'Return values in input order.');`),
      sealed('starts-before-await-and-stable-results', 'Concurrency', `const jobs = [];
const outcome = loadInOrder([2, 1, 2], id => new Promise(resolve => jobs.push({ id, resolve })));
for (let turn = 0; turn < 8; turn++) await Promise.resolve();
assert(JSON.stringify(jobs.map(job => job.id)) === '[2,1,2]');
jobs[2].resolve('third');
jobs[1].resolve('second');
jobs[0].resolve('first');
assert(JSON.stringify(await outcome) === '["first","second","third"]');`),
      sealed('propagates-rejection', 'Errors', `const error = new Error('load failed');
let rejection;
try { await loadInOrder([0, 1], id => id ? Promise.reject(error) : Promise.resolve(7)); }
catch (reason) { rejection = reason; }
assert(rejection === error);
assert(JSON.stringify(await loadInOrder([], () => { throw error; })) === '[]');`),
    ],
  },
  {
    id: 'js-make-latest', level: 12,
    reference: `function makeLatest(load, publish) {
  let current;
  return async function run(query) {
    const token = Symbol();
    current = token;
    let outcome;
    try {
      outcome = { ok: true, value: await load(query) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (token === current) publish(outcome);
  };
}`,
    tests: [
      example('publish-success', `const messages = [];
const run = makeLatest(async query => query.toUpperCase(), result => messages.push(result));
await run('gull');
assert(messages.length === 1 && messages[0].ok === true && messages[0].value === 'GULL',
  'The current successful run should publish its value.');`),
      sealed('same-query-race', 'Race Conditions', `const pending = [], messages = [];
const run = makeLatest(query => new Promise(resolve => pending.push({ query, resolve })), result => messages.push(result));
const older = run('same');
const newer = run('same');
for (let turn = 0; turn < 8; turn++) await Promise.resolve();
assert(pending.length === 2 && pending.every(job => job.query === 'same'));
pending[1].resolve('new');
await newer;
pending[0].resolve('old');
await older;
assert(messages.length === 1 && messages[0].ok === true && messages[0].value === 'new');`),
      sealed('ignore-stale-rejection', 'Race Conditions', `const pending = [], messages = [];
const run = makeLatest(() => new Promise((resolve, reject) => pending.push({ resolve, reject })), result => messages.push(result));
const older = run('old');
const newer = run('new');
for (let turn = 0; turn < 8; turn++) await Promise.resolve();
assert(pending.length === 2);
pending[0].reject(new Error('older failure'));
await older;
assert(messages.length === 0);
pending[1].resolve(23);
await newer;
assert(messages.length === 1 && messages[0].ok === true && messages[0].value === 23);`),
      sealed('publish-current-errors', 'Errors', `const failure = new Error('current failure');
const messages = [];
const run = makeLatest(query => {
  if (query === 'sync') throw failure;
  return Promise.reject(failure);
}, result => messages.push(result));
await run('sync');
await run('async');
assert(messages.length === 2 && messages.every(result => result.ok === false && result.error === failure));`),
    ],
  },
  {
    id: 'js-make-recorder', level: 13,
    reference: `function makeRecorder(ledger) {
  return amount => ledger.add(amount);
}`,
    tests: [
      example('standalone-callback', `const ledger = { total: 10, add(amount) { this.total += amount; return this.total; } };
const record = makeRecorder(ledger);
assert(ledger.total === 10, 'Creating a callback must not call add.');
assert(record(4) === 14 && ledger.total === 14, 'Return the result of the ledger method.');`),
      sealed('receiver-and-calls', 'Identity', `const amounts = [];
const ledger = { total: 5, add(amount) {
  assert(this === ledger);
  amounts.push(amount);
  this.total += amount;
  return this.total;
} };
const record = makeRecorder(ledger);
assert(amounts.length === 0);
assert(record.call({ total: 90 }, 0) === 5 && record(-2) === 3);
assert(JSON.stringify(amounts) === '[0,-2]');`),
    ],
  },
  {
    id: 'js-run-queue', level: 14,
    reference: `async function runQueue(tasks, limit) {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('Invalid worker limit');
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      try {
        results[index] = { ok: true, value: await task() };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}`,
    tests: [
      example('success-and-failure-results', `const failure = new Error('broken');
const result = await runQueue([async () => 'first', () => { throw failure; }, async () => 'last'], 1);
assert(result.length === 3 && result[0].ok === true && result[0].value === 'first');
assert(result[1].ok === false && result[1].error === failure, 'Keep the failed task in its original slot.');
assert(result[2].ok === true && result[2].value === 'last', 'A failure must not stop later tasks.');`),
      sealed('bounded-concurrency-and-input-order', 'Concurrency', `const starts = [];
const active = new Map();
let peak = 0;
const failure = new Error('async failure');
const tasks = Array.from({ length: 4 }, (_, index) => () => new Promise((resolve, reject) => {
  starts.push(index);
  active.set(index, () => {
    active.delete(index);
    if (index === 2) reject(failure);
    else resolve('value-' + index);
  });
  peak = Math.max(peak, active.size);
}));
const work = runQueue(tasks, 2);
for (let completed = 0; completed < tasks.length; completed++) {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  assert(active.size > 0 && peak <= 2);
  const newest = Array.from(active.values()).at(-1);
  newest();
}
const result = await work;
assert(starts.length === 4 && new Set(starts).size === 4);
assert(result.length === 4 && result[2].ok === false && result[2].error === failure);
for (const index of [0, 1, 3]) assert(result[index].ok === true && result[index].value === 'value-' + index);`),
      sealed('invalid-limits-and-empty-queue', 'Errors', `for (const limit of [0, -1, 1.5, NaN, Infinity]) {
  let error;
  try { await runQueue([], limit); } catch (failure) { error = failure; }
  assert(error instanceof RangeError);
}
assert(JSON.stringify(await runQueue([], 3)) === '[]');`),
    ],
  },
];
