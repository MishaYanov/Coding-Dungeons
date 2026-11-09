const example = (id, code) => ({ id, code, visibility: 'public', group: 'Examples' });
const sealed = (id, group, code) => ({ id, code, visibility: 'sealed', group });

export default [
  {
    id: 'ts-pallet-label', level: 1,
    reference: `function palletLabel(crateCount: number): string {
  if (!Number.isSafeInteger(crateCount) || crateCount < 0) throw new RangeError('Invalid crate count');
  return 'Pallets: ' + Math.ceil(crateCount / 10);
}`,
    tests: [
      example('eleven-crates', `assert(palletLabel(11) === 'Pallets: 2', 'Eleven crates need two pallets.');`),
      sealed('capacity-boundaries', 'Edges', `assert(palletLabel(0) === 'Pallets: 0');
assert(palletLabel(1) === 'Pallets: 1');
assert(palletLabel(10) === 'Pallets: 1');
assert(palletLabel(20) === 'Pallets: 2');
assert(palletLabel(Number.MAX_SAFE_INTEGER) === 'Pallets: 900719925474100');`),
      sealed('invalid-counts', 'Errors', `for (const value of [-1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  let failure;
  try { palletLabel(value); } catch (error) { failure = error; }
  assert(failure instanceof RangeError);
}`),
    ],
    typeTests: [{ id: 'numeric-contract', code: `const checkedPalletLabel: string = palletLabel(1);
// @ts-expect-error Numeric inputs only.
palletLabel('11');` }],
  },
  {
    id: 'ts-heavy-ids', level: 2,
    reference: `type Cargo = { readonly id: string; readonly weightKg: number };

function heavyIds(items: readonly Cargo[]): string[] {
  return items.filter(item => item.weightKg >= 10).map(item => item.id);
}`,
    tests: [
      example('heavy-items-in-order', `const cargo = [{ id: 'N', weightKg: 12 }, { id: 'S', weightKg: 3 }, { id: 'E', weightKg: 18 }];
const ids = heavyIds(cargo);
assert(Array.isArray(ids) && ids.length === 2 && ids[0] === 'N' && ids[1] === 'E',
  'Keep heavy cargo IDs in an array in input order.');`),
      sealed('ten-kilo-threshold-and-fresh-output', 'Edges', `const items = Object.freeze([
  Object.freeze({ id: 'under', weightKg: 9.9 }), Object.freeze({ id: 'edge', weightKg: 10 }),
]);
const result = heavyIds(items);
assert(Array.isArray(result) && result.length === 1 && result[0] === 'edge');
assert(result !== heavyIds(items));
const first = heavyIds([]);
assert(Array.isArray(first) && first.length === 0 && first !== heavyIds([]));`),
    ],
    typeTests: [{ id: 'readonly-manifest', code: `const readonlyManifest: readonly Readonly<{id: string; weightKg: number}>[] = [{ id: 'N', weightKg: 10 }];
const selectedCargoIds = heavyIds(readonlyManifest);
selectedCargoIds.push('X');
// @ts-expect-error Cargo weight must be numeric.
heavyIds([{ id: 'X', weightKg: '10' }]);
// @ts-expect-error A cargo record requires an ID.
heavyIds([{ weightKg: 10 }]);
type HeavyIdsRequire<T extends true> = T;
type HeavyIdsIsAny<T> = 0 extends (1 & T) ? true : false;
type HeavyIdsResult = typeof selectedCargoIds;
type HeavyIdsCheckResult = HeavyIdsRequire<HeavyIdsIsAny<HeavyIdsResult> extends true ? false :
  HeavyIdsIsAny<HeavyIdsResult[number]> extends true ? false :
  [HeavyIdsResult] extends [string[]] ? [string[]] extends [HeavyIdsResult] ? true : false : false>;` }],
  },
  {
    id: 'ts-can-unload', level: 3,
    reference: `type Arrival =
  | { kind: 'assigned'; dock: number }
  | { kind: 'waiting'; reason: string };

function canUnload(arrival: Arrival, openDocks: readonly number[]): boolean {
  return arrival.kind === 'assigned' && openDocks.includes(arrival.dock);
}`,
    tests: [
      example('assigned-open-dock', `assert(canUnload({ kind: 'assigned', dock: 2 }, [0, 2]) === true,
  'An assigned arrival can unload at an open dock.');`),
      sealed('closed-waiting-and-dock-zero', 'States', `const openDocks = Object.freeze([0, 3]);
assert(canUnload({ kind: 'assigned', dock: 0 }, openDocks) === true);
assert(canUnload({ kind: 'assigned', dock: 1 }, openDocks) === false);
assert(canUnload({ kind: 'assigned', dock: 3 }, []) === false);
assert(canUnload({ kind: 'waiting', reason: 'queue' }, openDocks) === false);`),
    ],
    typeTests: [{ id: 'arrival-union', code: `const fixedDocks: readonly number[] = [0, 2];
const allowed: boolean = canUnload({ kind: 'assigned', dock: 0 }, fixedDocks);
// @ts-expect-error Waiting requires a reason.
canUnload({ kind: 'waiting' }, fixedDocks);
// @ts-expect-error Assigned requires a dock number.
canUnload({ kind: 'assigned', dock: 'N' }, fixedDocks);` }],
  },
  {
    id: 'ts-label-matching', level: 4,
    reference: `function labelMatching(weights: readonly number[], label: (weight: number) => string): string[] {
  const result: string[] = [];
  for (const weight of weights) {
    if (weight >= 0) result.push(label(weight));
  }
  return result;
}`,
    tests: [
      example('label-nonnegative-weights', `const result = labelMatching([3, -1, 0], weight => weight + ' kg');
assert(Array.isArray(result) && result.length === 2 && result[0] === '3 kg' && result[1] === '0 kg',
  'Return an array with labels for the retained weights in order.');`),
      sealed('callback-count-and-nan', 'Callbacks', `const calls = [];
const result = labelMatching(Object.freeze([NaN, -5, 0, 2, -1, 2]), weight => {
  calls.push(weight);
  return String(weight);
});
assert(calls.length === 3 && calls[0] === 0 && calls[1] === 2 && calls[2] === 2);
assert(Array.isArray(result) && result.length === 3 && result[0] === '0' && result[1] === '2' && result[2] === '2');
const empty = labelMatching([], () => { throw new Error('unexpected call'); });
assert(Array.isArray(empty) && empty.length === 0);`),
    ],
    typeTests: [{ id: 'label-callback-type', code: `const fixedWeights: readonly number[] = [1, 3];
const matchingLabels: string[] = labelMatching(fixedWeights, weight => weight.toFixed(1));
// @ts-expect-error The callback produces labels, not numbers.
labelMatching(fixedWeights, weight => weight);` }],
  },
  {
    id: 'ts-read-dock-status', level: 5,
    reference: `type DockStatus = { dock: number; open: boolean };

function readDockStatus(raw: string): DockStatus | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!('dock' in value) || !Object.hasOwn(value, 'dock') || typeof value.dock !== 'number'
      || !Number.isSafeInteger(value.dock) || value.dock < 0) return undefined;
  if (!('open' in value) || !Object.hasOwn(value, 'open') || typeof value.open !== 'boolean') return undefined;
  return { dock: value.dock, open: value.open };
}`,
    tests: [
      example('decode-closed-dock-zero', `const result = readDockStatus('{"dock":0,"open":false}');
assert(result !== null && typeof result === 'object' && !Array.isArray(result), 'Return a dock status record.');
assert(result?.dock === 0 && result.open === false, 'Dock zero and a closed status are valid values.');`),
      sealed('reject-malformed-manifests', 'Validation', `for (const raw of [
  '{', 'null', '[]', 'true', '1', '{}', '{"dock":0}', '{"open":false}', '{"dock":"0","open":false}',
  '{"dock":0,"open":"false"}', '{"dock":-1,"open":true}', '{"dock":1.5,"open":true}',
  '{"dock":9007199254740992,"open":true}',
]) assert(readDockStatus(raw) === undefined);`),
      sealed('accept-safe-positive-dock', 'Edges', `const result = readDockStatus('{"dock":9007199254740991,"open":true}');
assert(result?.dock === Number.MAX_SAFE_INTEGER && result.open === true);`),
    ],
    typeTests: [{ id: 'decoded-status-shape', code: `const decodedDockStatus: {dock: number; open: boolean} | undefined = readDockStatus('{}');
// @ts-expect-error JSON text must be supplied as a string.
readDockStatus({ dock: 0, open: false });` }],
  },
  {
    id: 'ts-read-gate', level: 6,
    reference: `type Gate = 'open' | 'closed' | 'offline';

async function readGate(readOpen: () => Promise<boolean>): Promise<Gate> {
  try {
    return await readOpen() ? 'open' : 'closed';
  } catch {
    return 'offline';
  }
}`,
    tests: [
      example('reachable-gate', `assert(await readGate(async () => true) === 'open', 'A reachable, open gate is open.');
assert(await readGate(async () => false) === 'closed', 'A reachable, closed gate is closed.');`),
      sealed('catches-throw-and-rejection', 'Errors', `assert(await readGate(() => { throw 'sync'; }) === 'offline');
assert(await readGate(() => Promise.reject(new Error('async'))) === 'offline');`),
      sealed('awaits-injected-callback', 'Concurrency', `let calls = 0;
let release;
const pending = readGate(() => {
  calls++;
  return new Promise(resolve => { release = resolve; });
});
for (let turn = 0; turn < 8; turn++) await Promise.resolve();
assert(calls === 1);
release(false);
assert(await pending === 'closed' && calls === 1);`),
    ],
    typeTests: [{ id: 'gate-status-contract', code: `const gateStatus: Promise<'open' | 'closed' | 'offline'> = readGate(async () => false);
// @ts-expect-error The injected callback must resolve to a Boolean.
readGate(async () => 'true');` }],
  },
  {
    id: 'ts-decide', level: 7,
    reference: `export type Decision =
  | { kind: 'route'; dock: number }
  | { kind: 'invalid'; reason: string };

export function decide(destination: string): Decision {
  switch (destination.trim().toUpperCase()) {
    case 'NORTH': return { kind: 'route', dock: 1 };
    case 'SOUTH': return { kind: 'route', dock: 2 };
    default: return { kind: 'invalid', reason: 'Unknown destination' };
  }
}`,
    tests: [
      example('route-north', `const result = submission.decide('north');
assert(result !== null && typeof result === 'object' && !Array.isArray(result));
assert(result.kind === 'route' && result.dock === 1, 'North uses dock one.');`),
      sealed('normalized-routes-and-invalid', 'Validation', String.raw`for (const [name, dock] of [[' SOUTH ', 2], ['\tNoRtH\n', 1]]) {
  const result = submission.decide(name);
  assert(result.kind === 'route' && result.dock === dock);
}
for (const name of ['east', 'nor th', '', 'southbound']) {
  const result = submission.decide(name);
  assert(result.kind === 'invalid' && typeof result.reason === 'string');
}`),
    ],
    typeTests: [{ id: 'exported-decision-contract', code: `import { decide, type Decision } from './submission';
const decision: Decision = decide('North');
if (decision.kind === 'route') {
  const selectedDock: number = decision.dock;
  // @ts-expect-error A route has a dock, not a failure reason.
  decision.reason;
} else {
  const failureReason: string = decision.reason;
}
// @ts-expect-error Every route must name a dock.
const invalidShape: Decision = { kind: 'route' };` }],
  },
  {
    id: 'ts-pluck', level: 8,
    reference: `function pluck<T, K extends keyof T>(rows: readonly T[], key: K): T[K][] {
  return rows.map(row => row[key]);
}`,
    tests: [
      example('pluck-capacity', `const docks = [{ id: 'N', capacity: 24 }, { id: 'S', capacity: 12 }];
const values = pluck(docks, 'capacity');
assert(Array.isArray(values) && values.length === 2 && values[0] === 24 && values[1] === 12,
  'Read each selected property into an array in input order.');`),
      sealed('supports-multiple-keys-and-empty', 'Edges', `const docks = Object.freeze([{ id: 'N', capacity: 0 }, { id: 'S', capacity: 3 }]);
const ids = pluck(docks, 'id');
assert(Array.isArray(ids) && ids.length === 2 && ids[0] === 'N' && ids[1] === 'S');
const values = pluck(docks, 'capacity');
assert(Array.isArray(values) && values.length === 2 && values[0] === 0 && values[1] === 3);
assert(values !== pluck(docks, 'capacity'));
const empty = pluck([], 'id');
assert(Array.isArray(empty) && empty.length === 0 && empty !== pluck([], 'id'));`),
    ],
    typeTests: [{ id: 'property-specific-result', code: `const pluckRows: readonly { id: string; capacity: number }[] = [{ id: 'N', capacity: 24 }];
const numbers = pluck(pluckRows, 'capacity');
const checkedNumbers: number[] = numbers;
const checkedStrings: string[] = pluck(pluckRows, 'id');
// @ts-expect-error A selected number property does not produce strings.
const wrongElement: string = numbers[0];
// @ts-expect-error The requested key must exist on the row type.
pluck(pluckRows, 'missing');` }],
  },
  {
    id: 'ts-apply-patch', level: 9,
    reference: `type Dock = { id: string; capacity: number; open: boolean };
type DockPatch = Partial<Omit<Dock, 'id'>>;

function applyPatch(dock: Dock, patch: DockPatch): Dock {
  return {
    id: dock.id,
    capacity: patch.capacity ?? dock.capacity,
    open: patch.open ?? dock.open,
  };
}`,
    tests: [
      example('patch-open-only', `const next = applyPatch({ id: 'N', capacity: 24, open: true }, { open: false });
assert(next !== null && typeof next === 'object' && !Array.isArray(next));
assert(next.id === 'N' && next.capacity === 24 && next.open === false, 'Keep omitted fields and preserve false.');`),
      sealed('preserve-zero-and-id', 'Validation', `const original = { id: 'E', capacity: 8, open: false };
const next = applyPatch(original, { id: 'replace', capacity: 0 });
assert(next.id === 'E' && next.capacity === 0 && next.open === false);`),
      sealed('empty-patch', 'Edges', `const result = applyPatch({ id: 'W', capacity: 1, open: true }, {});
assert(result.id === 'W' && result.capacity === 1 && result.open === true);`),
    ],
    typeTests: [{ id: 'editable-fields-only', code: `const checkedDock: Dock = { id: 'N', capacity: 24, open: true };
const capacityPatch: DockPatch = { capacity: 0 };
const emptyPatch: DockPatch = {};
const patched: Dock = applyPatch(checkedDock, { ...capacityPatch, open: false });
// @ts-expect-error The identifier is not patchable.
const wrongIdPatch: DockPatch = { id: 'changed' };
// @ts-expect-error The patch preserves the source field types.
applyPatch(checkedDock, { capacity: 'large' });` }],
  },
  {
    id: 'ts-advance', level: 10,
    reference: `type Job =
  | { state: 'queued'; id: string }
  | { state: 'running'; id: string }
  | { state: 'completed'; id: string }
  | { state: 'cancelled'; id: string; reason: string };

function unreachable(value: never): never {
  throw new Error('Unhandled state: ' + String(value));
}

function advance(job: Job): Job {
  switch (job.state) {
    case 'queued': return { state: 'running', id: job.id };
    case 'running': return { state: 'completed', id: job.id };
    case 'completed':
    case 'cancelled': return job;
    default: return unreachable(job);
  }
}`,
    tests: [
      example('start-queued-job', `const result = advance({ state: 'queued', id: 'J-2' });
assert(result !== null && typeof result === 'object' && !Array.isArray(result));
assert(result.state === 'running' && result.id === 'J-2', 'A queued job starts running.');`),
      sealed('terminal-states-keep-data', 'States', `const cancelled = advance({ state: 'cancelled', id: 'J-7', reason: 'Weather' });
assert(cancelled.state === 'cancelled' && cancelled.id === 'J-7' && cancelled.reason === 'Weather');
const completed = advance({ state: 'completed', id: 'J-8' });
assert(completed.state === 'completed' && completed.id === 'J-8');`),
      sealed('running-job-completes', 'States', `const next = advance({ state: 'running', id: 'J-1' });
assert(next.state === 'completed' && next.id === 'J-1');`),
    ],
    typeTests: [{ id: 'closed-job-union', code: `const advancedJob: Job = advance({ state: 'cancelled', id: 'J-7', reason: 'Weather' });
if (advancedJob.state === 'cancelled') { const cancellationReason: string = advancedJob.reason; }
// @ts-expect-error Cancelled jobs require a reason.
advance({ state: 'cancelled', id: 'J-3' });
// @ts-expect-error An undeclared job state is invalid.
advance({ state: 'paused', id: 'J-3' });` }],
  },
  {
    id: 'ts-announce', level: 11,
    reference: `type Payloads = {
  arrive: { dock: number };
  depart: { vessel: string };
  delay: { vessel: string; minutes: number };
};
type Notice = { [K in keyof Payloads]: { kind: K; payload: Payloads[K] } }[keyof Payloads];

function announce(notice: Notice): string {
  switch (notice.kind) {
    case 'arrive': return 'Dock ' + notice.payload.dock + ' occupied';
    case 'depart': return notice.payload.vessel + ' departed';
    case 'delay': return notice.payload.vessel + ' delayed ' + notice.payload.minutes + ' min';
    default: {
      const missed: never = notice;
      throw new Error('Unhandled notice: ' + String(missed));
    }
  }
}`,
    tests: [
      example('delay-notice', `const result = announce({ kind: 'delay', payload: { vessel: 'Gull', minutes: 5 } });
assert(result === 'Gull delayed 5 min', 'Include both delay payload fields.');`),
      sealed('original-notices', 'Compatibility', `assert(announce({ kind: 'arrive', payload: { dock: 0 } }) === 'Dock 0 occupied');
assert(announce({ kind: 'depart', payload: { vessel: 'Swift' } }) === 'Swift departed');`),
      sealed('reads-payload-values', 'Edges', `assert(announce({ kind: 'delay', payload: { vessel: 'Heron', minutes: 12 } }) === 'Heron delayed 12 min');`),
    ],
    typeTests: [{ id: 'correlated-notice-payload', code: `const wait: Notice = { kind: 'delay', payload: { vessel: 'Gull', minutes: 5 } };
const waitText: string = announce(wait);
// @ts-expect-error Delay notices require a number of minutes.
announce({ kind: 'delay', payload: { vessel: 'Gull' } });
// @ts-expect-error An arrive payload cannot be used in a depart notice.
announce({ kind: 'depart', payload: { dock: 1 } });` }],
  },
  {
    id: 'ts-probe-all', level: 12,
    reference: `type Probe =
  | { dock: string; ok: true; open: boolean }
  | { dock: string; ok: false; reason: string };

async function probeAll(docks: readonly string[], query: (dock: string) => Promise<boolean>): Promise<Probe[]> {
  return Promise.all(docks.map(async (dock): Promise<Probe> => {
    try {
      return { dock, ok: true, open: await query(dock) };
    } catch {
      return { dock, ok: false, reason: 'Unavailable' };
    }
  }));
}`,
    tests: [
      example('open-and-closed-docks', `const pending = probeAll(['N', 'S'], async dock => dock === 'N');
assert(pending instanceof Promise, 'Return a promise for the probe results.');
const result = await pending;
assert(Array.isArray(result) && result.length === 2, 'Return an array with one result per dock.');
assert(result[0].dock === 'N' && result[0].ok === true && result[0].open === true);
assert(result[1].dock === 'S' && result[1].ok === true && result[1].open === false,
  'A closed dock is still a successful probe.');`),
      sealed('mixed-errors-preserve-order', 'Errors', `const called = [];
const result = await probeAll(Object.freeze(['slow', 'sync', 'reject', 'last']), dock => {
  called.push(dock);
  if (dock === 'sync') throw 'signal';
  if (dock === 'reject') return Promise.reject(new Error('probe failed'));
  if (dock === 'slow') return Promise.resolve().then(() => false);
  return Promise.resolve(true);
});
assert(called.length === 4 && new Set(called).size === 4);
assert(Array.isArray(result) && result.length === 4);
assert(result[0].dock === 'slow' && result[1].dock === 'sync' && result[2].dock === 'reject' && result[3].dock === 'last');
assert(result[0].ok === true && result[0].open === false && result[3].ok === true && result[3].open === true);
assert(result[1].ok === false && typeof result[1].reason === 'string');
assert(result[2].ok === false && typeof result[2].reason === 'string');`),
      sealed('no-docks', 'Edges', `const result = await probeAll([], () => { throw new Error('unexpected query'); });
assert(Array.isArray(result) && result.length === 0);`),
    ],
    typeTests: [{ id: 'typed-probe-results', code: `const fixedDockNames: readonly string[] = ['N'];
const probeResults: Promise<Probe[]> = probeAll(fixedDockNames, async dock => dock.startsWith('N'));
// @ts-expect-error A probe callback resolves to a Boolean.
probeAll(fixedDockNames, async () => 'open');
async function checkProbes() {
  const [result] = await probeResults;
  if (result.ok) { const open: boolean = result.open; }
  else { const reason: string = result.reason; }
}` }],
  },
  {
    id: 'ts-parse-dock-id', level: 13,
    reference: `declare const dockMark: unique symbol;
type DockId = string & { readonly [dockMark]: true };

function parseDockId(value: unknown): DockId | undefined {
  return typeof value === 'string' && /^D-[0-9]{2}$/.test(value) ? value as DockId : undefined;
}`,
    tests: [
      example('valid-id', `assert(parseDockId('D-00') === 'D-00', 'D-00 has exactly two digits.');`),
      sealed('invalid-ids', 'Edges', String.raw`for (const value of ['S-00', 'd-00', 'D-1', 'D-123', 'D-９９', 'D-01\n', 42, null, {}]) {
  assert(parseDockId(value) === undefined);
}
assert(parseDockId('D-97') === 'D-97');`),
    ],
    typeTests: [{ id: 'dock-id-brand', code: `const verifiedDockId = parseDockId('D-00');
if (verifiedDockId !== undefined) {
  const brand: DockId = verifiedDockId;
  const ordinary: string = brand;
}
// @ts-expect-error An unchecked string cannot satisfy the brand.
const uncheckedDockId: DockId = 'D-00';
const acceptsUnknownDockId = (value: unknown) => parseDockId(value);` }],
  },
  {
    id: 'ts-handle', level: 14,
    reference: `type Destination = 'north' | 'south';
type Decision =
  | { kind: 'route'; dock: number }
  | { kind: 'duplicate' }
  | { kind: 'conflict' }
  | { kind: 'invalid' };

function handle(value: unknown, seen: Map<string, Destination>): Decision {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  if (!('id' in value) || !Object.hasOwn(value, 'id') || typeof value.id !== 'string') return { kind: 'invalid' };
  if (!('to' in value) || !Object.hasOwn(value, 'to') || (value.to !== 'north' && value.to !== 'south')) {
    return { kind: 'invalid' };
  }
  const id = value.id.trim();
  if (!id) return { kind: 'invalid' };
  const previous = seen.get(id);
  if (previous === value.to) return { kind: 'duplicate' };
  if (previous !== undefined) return { kind: 'conflict' };
  seen.set(id, value.to);
  return { kind: 'route', dock: value.to === 'north' ? 1 : 2 };
}`,
    tests: [
      example('route-first-command', `const seen = new Map();
const result = handle({ id: ' A ', to: 'north' }, seen);
assert(result !== null && typeof result === 'object' && !Array.isArray(result));
assert(result.kind === 'route' && result.dock === 1, 'Route the first north command to dock one.');
assert(seen.size === 1 && seen.get('A') === 'north', 'Store the normalized ID in the supplied map.');`),
      sealed('deduplicate-and-conflict', 'State', `const seen = new Map([['A', 'north']]);
assert(handle({ id: ' A ', to: 'north' }, seen).kind === 'duplicate');
assert(handle({ id: 'A', to: 'south' }, seen).kind === 'conflict');
assert(seen.size === 1 && seen.get('A') === 'north');
const fresh = handle({ id: 'B', to: 'south' }, seen);
assert(fresh.kind === 'route' && fresh.dock === 2 && seen.get('B') === 'south');`),
      sealed('invalid-commands-do-not-write', 'Validation', `const seen = new Map([['keep', 'north']]);
const inherited = Object.create({ id: 'ghost', to: 'north' });
const array = Object.assign([], { id: 'array', to: 'north' });
for (const value of [null, 2, 'text', {}, { id: ' ', to: 'north' }, { id: 8, to: 'south' },
  { id: 'missing' }, { to: 'north' }, { id: 'case', to: 'North' }, inherited, array]) {
  assert(handle(value, seen).kind === 'invalid');
}
assert(seen.size === 1 && seen.get('keep') === 'north');`),
    ],
    typeTests: [{ id: 'dispatch-decision-contract', code: `const localDispatch = new Map<string, Destination>();
const unknownCommand: unknown = { id: 'A', to: 'north' };
const dispatchDecision: Decision = handle(unknownCommand, localDispatch);
if (dispatchDecision.kind === 'route') { const dockNumber: number = dispatchDecision.dock; }
// @ts-expect-error A route decision must name its dock.
const routeWithoutDock: Decision = { kind: 'route' };
// @ts-expect-error East is not a supported destination.
localDispatch.set('A', 'east');` }],
  },
];
