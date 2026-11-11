const example = (id, code) => ({ id, code, visibility: 'public', group: 'Examples' });
const sealed = (id, group, code) => ({ id, code, visibility: 'sealed', group });

const legacyCode = `function routeRelayBatchLegacy(rows, ledger) {
  const decisions = [];
  for (const raw of rows) {
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      decisions.push({ kind: 'rejected', reason: 'malformed-json' });
      continue;
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)
        || !Object.hasOwn(record, 'id') || typeof record.id !== 'string'
        || !Object.hasOwn(record, 'crates') || !Number.isSafeInteger(record.crates)
        || record.crates <= 0
        || (Object.hasOwn(record, 'expedited') && typeof record.expedited !== 'boolean')) {
      decisions.push({ kind: 'rejected', reason: 'invalid-order' });
      continue;
    }
    const id = record.id.trim().toUpperCase();
    if (id === '') {
      decisions.push({ kind: 'rejected', reason: 'invalid-order' });
      continue;
    }
    if (ledger.acceptedIds.includes(id)) {
      decisions.push({ kind: 'rejected', reason: 'duplicate' });
      continue;
    }
    if (record.crates > ledger.remaining) {
      decisions.push({ kind: 'rejected', reason: 'capacity' });
      continue;
    }
    ledger.remaining -= record.crates;
    ledger.acceptedIds.push(id);
    decisions.push({
      kind: 'accepted', id, crates: record.crates,
      channel: record.expedited === true ? 'priority' : 'regular',
    });
  }
  return { decisions, ledger };
}`;

const expectRecord = `function expectRecord(actual, expected) {
  assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual),
    'Return a record with the documented fields.');
  const keys = Object.keys(expected);
  assert(Object.keys(actual).length === keys.length, 'Return exactly the documented fields.');
  for (const key of keys) {
    assert(Object.hasOwn(actual, key) && actual[key] === expected[key], 'Check the ' + key + ' field.');
  }
}`;

const expectParsed = `${expectRecord}
function expectOrder(raw, expected) {
  const actual = parseRelayOrder(raw);
  assert(actual && Object.hasOwn(actual, 'order'), 'A valid row returns an order.');
  expectRecord(actual, { ok: true, order: actual.order });
  expectRecord(actual.order, expected);
}
function expectRejection(raw, reason) {
  expectRecord(parseRelayOrder(raw), { ok: false, reason });
}`;

const expectBatch = `${expectRecord}
function expectBatch(actual, expected) {
  assert(actual && Object.hasOwn(actual, 'decisions') && Object.hasOwn(actual, 'ledger'));
  expectRecord(actual, { decisions: actual.decisions, ledger: actual.ledger });
  assert(Array.isArray(actual.decisions) && actual.decisions.length === expected.decisions.length,
    'Return a decision for every row, in input order.');
  for (let i = 0; i < expected.decisions.length; i++) {
    expectRecord(actual.decisions[i], expected.decisions[i]);
  }
  assert(actual.ledger && Object.hasOwn(actual.ledger, 'acceptedIds'));
  expectRecord(actual.ledger, {
    remaining: expected.ledger.remaining, acceptedIds: actual.ledger.acceptedIds,
  });
  const ids = actual.ledger.acceptedIds;
  assert(Array.isArray(ids) && ids.length === expected.ledger.acceptedIds.length);
  for (let i = 0; i < ids.length; i++) assert(ids[i] === expected.ledger.acceptedIds[i]);
}`;

const boundary = {
  id: 'refactor-parse-order',
  title: 'Extract the order boundary',
  description: 'Separate JSON decoding, validation, and normalization from routing. Parse one raw JSON string into a success or rejection record.',
  signature: 'function parseRelayOrder(raw)',
  starter: `function parseRelayOrder(raw) {
  // Decode and validate one row. This boundary does not know the ledger.
  return { ok: false, reason: 'invalid-order' };
}`,
  reference: `function parseRelayOrder(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
      || !Object.hasOwn(payload, 'id') || !Object.hasOwn(payload, 'crates')) {
    return { ok: false, reason: 'invalid-order' };
  }
  const { id, crates } = payload;
  const hasExpedited = Object.hasOwn(payload, 'expedited');
  if (typeof id !== 'string' || id.trim() === '' || !Number.isSafeInteger(crates) || crates <= 0
      || (hasExpedited && typeof payload.expedited !== 'boolean')) {
    return { ok: false, reason: 'invalid-order' };
  }
  return { ok: true, order: { id: id.trim().toUpperCase(), crates, expedited: hasExpedited ? payload.expedited : false } };
}`,
  tests: [
    example('normalized-order', `${expectParsed}
expectOrder('{"id":" a-17 ","crates":2,"dock":"east"}', { id: 'A-17', crates: 2, expedited: false });
expectOrder('{"id":"b-4","crates":1,"expedited":true}', { id: 'B-4', crates: 1, expedited: true });`),
    example('parse-versus-validation', `${expectParsed}
expectRejection('{"id":', 'malformed-json');
expectRejection('{"id":"X","crates":0}', 'invalid-order');`),
    sealed('record-validation', 'Input shape', `${expectParsed}
for (const raw of ['null', '[]', '"A"', 'true', '{}', '{"id":"A"}', '{"crates":1}',
  '{"id":18,"crates":1}', '{"id":"   ","crates":1}']) {
  expectRejection(raw, 'invalid-order');
}
expectOrder('{"id":"  ß-2  ","crates":1}', { id: 'SS-2', crates: 1, expedited: false });`),
    sealed('crate-count-validation', 'Numeric limits', `${expectParsed}
for (const value of ['-1', '1.5', '"2"', 'true', 'null', '1e400', '9007199254740992']) {
  expectRejection('{"id":"Q","crates":' + value + '}', 'invalid-order');
}
expectOrder('{"id":"Q","crates":9007199254740991}', { id: 'Q', crates: 9007199254740991, expedited: false });`),
    sealed('explicit-expedited', 'Optional fields', `${expectParsed}
for (const value of ['null', '0', '1', '"true"']) {
  expectRejection('{"id":"Q","crates":1,"expedited":' + value + '}', 'invalid-order');
}
expectOrder('{"id":"Q","crates":1,"expedited":false}', { id: 'Q', crates: 1, expedited: false });`),
  ],
};

const pipeline = {
  id: 'refactor-route-batch',
  title: 'Replace the mutating router',
  description: 'Reuse your order boundary to route a batch without mutating the supplied rows or ledger. Match the legacy decisions and return an independent ledger.',
  signature: 'function routeRelayBatch(rows, ledger)',
  starter: `function routeRelayBatch(rows, ledger) {
  // Use your parseRelayOrder(raw) from the previous stage.
  return { decisions: [], ledger };
}`,
  reference: `function routeRelayBatch(rows, ledger) {
  const decisions = [];
  const acceptedIds = [...ledger.acceptedIds];
  const accepted = new Set(acceptedIds);
  let remaining = ledger.remaining;

  for (const raw of rows) {
    const parsed = parseRelayOrder(raw);
    if (!parsed.ok) {
      decisions.push({ kind: 'rejected', reason: parsed.reason });
      continue;
    }
    const { id, crates, expedited } = parsed.order;
    if (accepted.has(id)) {
      decisions.push({ kind: 'rejected', reason: 'duplicate' });
      continue;
    }
    if (crates > remaining) {
      decisions.push({ kind: 'rejected', reason: 'capacity' });
      continue;
    }
    accepted.add(id);
    acceptedIds.push(id);
    remaining -= crates;
    decisions.push({ kind: 'accepted', id, crates, channel: expedited ? 'priority' : 'regular' });
  }
  return { decisions, ledger: { remaining, acceptedIds } };
}`,
  tests: [
    example('routes-in-input-order', `${expectBatch}
const rows = ['{"id":"a","crates":1}', '{"id":"B","crates":2,"expedited":true}', '{"id":"a","crates":1}'];
const originalRows = [...rows];
const ledger = { remaining: 5, acceptedIds: ['PREV'] };
expectBatch(routeRelayBatch(rows, ledger), {
  decisions: [
    { kind: 'accepted', id: 'A', crates: 1, channel: 'regular' },
    { kind: 'accepted', id: 'B', crates: 2, channel: 'priority' },
    { kind: 'rejected', reason: 'duplicate' },
  ],
  ledger: { remaining: 2, acceptedIds: ['PREV', 'A', 'B'] },
});
assert(rows.length === originalRows.length && originalRows.every((raw, i) => rows[i] === raw),
  'Leave the original input rows intact.');
assert(ledger.remaining === 5 && ledger.acceptedIds.length === 1 && ledger.acceptedIds[0] === 'PREV',
  'Leave the original ledger intact.');`),
    sealed('legacy-parity', 'Characterization', `${expectBatch}
${legacyCode}
const rows = Object.freeze([
  '{oops', 'null', '{"id":"CURRENT","crates":0}', '{"id":"mid","crates":1,"expedited":null}',
  '{"id":"x","crates":"2"}', '{"id":"big","crates":9007199254740992}',
  '{"id":"   ","crates":1}', '{"id":" ü-2 ","crates":3,"expedited":true}',
  '{"id":"MID","crates":4}', '{"id":"mid","crates":1}', '{"id":"Ü-2","crates":8}',
]);
const ledger = Object.freeze({ remaining: 4, acceptedIds: Object.freeze(['CURRENT']) });
const legacyLedger = { remaining: ledger.remaining, acceptedIds: [...ledger.acceptedIds] };
expectBatch(routeRelayBatch(rows, ledger), routeRelayBatchLegacy(rows, legacyLedger));`),
    sealed('duplicate-before-capacity', 'Decision precedence', `${expectBatch}
const rows = ['{"id":"a","crates":1}', '{"id":" A ","crates":4}', '{"id":"old","crates":2}', '{"id":"old","crates":0}'];
expectBatch(routeRelayBatch(rows, { remaining: 1, acceptedIds: ['OLD'] }), {
  decisions: [
    { kind: 'accepted', id: 'A', crates: 1, channel: 'regular' },
    { kind: 'rejected', reason: 'duplicate' },
    { kind: 'rejected', reason: 'duplicate' },
    { kind: 'rejected', reason: 'invalid-order' },
  ],
  ledger: { remaining: 0, acceptedIds: ['OLD', 'A'] },
});`),
    sealed('no-reservation-on-rejection', 'Ledger updates', `${expectBatch}
const rows = ['{"id":"big","crates":3}', '{"id":"big","crates":2}', '{"id":"new","crates":1}'];
expectBatch(routeRelayBatch(rows, { remaining: 2, acceptedIds: [] }), {
  decisions: [
    { kind: 'rejected', reason: 'capacity' },
    { kind: 'accepted', id: 'BIG', crates: 2, channel: 'regular' },
    { kind: 'rejected', reason: 'capacity' },
  ],
  ledger: { remaining: 0, acceptedIds: ['BIG'] },
});`),
    sealed('independent-ledgers', 'State ownership', `${expectBatch}
const ledger = { remaining: 0, acceptedIds: ['PREV'] };
const first = routeRelayBatch([], ledger);
const second = routeRelayBatch([], ledger);
expectBatch(first, { decisions: [], ledger });
expectBatch(second, { decisions: [], ledger });
assert(first.ledger !== ledger && second.ledger !== ledger && first.ledger !== second.ledger);
assert(first.ledger.acceptedIds !== ledger.acceptedIds && second.ledger.acceptedIds !== ledger.acceptedIds);
assert(first.ledger.acceptedIds !== second.ledger.acceptedIds && first.decisions !== second.decisions);`),
  ],
};

export default {
  id: 'refactoring-relay',
  title: 'Refactoring Quest · The Relay Ledger',
  description: 'Three crews patched the Relay Ledger in place. Now one loop decodes orders, applies routing rules, and mutates the live ledger. A new dispatch screen needs a preview. Capture the old rules, separate validation from routing, and roll out a router that can preview without changing live state.',
  legacyCode,
  stages: [
    {
      id: 'characterize',
      kind: 'choice',
      title: 'Trace the night shift',
      prompt: `Before changing the handler, pin down its existing behavior. The ledger starts with remaining = 2 and acceptedIds = ['EAST']. It receives these rows in order:

1. {"id":" east ","crates":5}
2. {"id":"WEST","crates":3}
3. {"id":" west ","crates":2,"expedited":true}
4. {oops

Which expectation should your characterization test capture?`,
      options: [
        { id: 'capacity-first', label: 'Capacity, capacity, accepted priority WEST, malformed JSON. Zero crates remain.' },
        { id: 'baseline', label: 'Duplicate, capacity, accepted priority WEST, malformed JSON. Zero crates remain.' },
        { id: 'reserve-rejected', label: 'Duplicate, capacity, duplicate, malformed JSON. Two crates remain.' },
        { id: 'one-error-kind', label: 'Duplicate, capacity, accepted regular WEST, invalid order. Zero crates remain.' },
      ],
      answer: 'baseline',
      success: 'The trace captures normalized identity, rejection precedence, and the ledger effect. Keep these expectations as you split the handler.',
      retry: 'Follow each row through the legacy handler in order. Check when it normalizes the ID and when it updates the ledger.',
    },
    {
      id: 'extract-boundary',
      kind: 'code',
      title: 'Open a seam at the gate',
      prompt: `Write parseRelayOrder(raw). The input is one raw JSON string.

Return { ok: false, reason: 'malformed-json' } if JSON parsing fails. Parsed data must be a non-null, non-array object with its own id and crates fields. The id must be a string that is nonempty after trim(), and crates must be a positive safe integer. If the record has its own expedited field, that field must be a boolean. Return { ok: false, reason: 'invalid-order' } for any failed validation.

For a valid row return { ok: true, order: { id, crates, expedited } }. Trim and uppercase id, default expedited to false when absent, and ignore other fields. Keep this function independent of the ledger and routing policy.`,
      exercise: boundary,
    },
    {
      id: 'refactor-policy',
      kind: 'code',
      title: 'Build a router that can preview',
      prompt: `Keep your parseRelayOrder(raw) in this file and use it from routeRelayBatch(rows, ledger). The rows argument is an array of JSON strings. The ledger contains a nonnegative safe integer remaining and an acceptedIds array of unique, already-normalized IDs.

Process rows in order and return { decisions, ledger: { remaining, acceptedIds } }. Each rejected decision is { kind: 'rejected', reason }. Check parsing first and use its reason if it fails. Then reject a normalized ID already accepted, including earlier in this batch, with 'duplicate'. Reject an order larger than remaining with 'capacity'. Rejected orders leave remaining and acceptedIds untouched.

On acceptance, subtract crates, append the normalized id, and emit { kind: 'accepted', id, crates, channel }, with 'priority' for expedited orders and 'regular' otherwise. Preserve the original accepted ID order. Leave rows and the input ledger intact. Return a fresh decisions array, ledger record, and acceptedIds array even for an empty batch.`,
      exercise: pipeline,
    },
    {
      id: 'rollout',
      kind: 'choice',
      title: 'Switch the live relay',
      prompt: `The workbench passes, and live callers still use the old handler. That handler mutates a ledger, and dispatch is a side effect of the caller. The new router returns a proposed ledger. Which rollout plan preserves one dispatch and one ledger update per batch while you check parity?`,
      options: [
        { id: 'two-dispatches', label: 'Run both full dispatch paths on each live batch and compare delivery logs.' },
        { id: 'shared-ledger', label: 'Run the old handler against the live ledger, then feed that updated ledger to the new router for comparison.' },
        { id: 'fresh-state', label: 'Cut over with a new empty ledger and rebuild accepted IDs from new traffic.' },
        { id: 'shadow-then-flag', label: 'Compare both computations from independent copies of the same pre-batch ledger. Keep one dispatch and commit path, then enable the new router behind a reversible flag.' },
      ],
      answer: 'shadow-then-flag',
      success: 'Both computations see the same starting state. Once their decisions and proposed ledgers agree, the flagged caller can commit the selected result through the same single dispatch path.',
      retry: 'Compare decisions from the same pre-batch state, and identify which path owns the live dispatch and ledger commit.',
    },
  ],
};
