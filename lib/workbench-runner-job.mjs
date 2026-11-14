const encoder = new TextEncoder();
const sourceLimit = 48 * 1024;
const fixtureLimit = 16 * 1024;
const suiteLimit = 128 * 1024;
const fixtureCount = 32;
const fixtureId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function result(status, message) {
  return { status, tests: [], compileMs: 0, runtimeMs: 0, diagnostics: message ? [{ message }] : [] };
}

function limit(value, defaultValue, minimum, maximum) {
  if (!Number.isFinite(value)) return defaultValue;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function byteLength(value) {
  // The caller checks the character limit before allocating encoded bytes.
  return encoder.encode(value).length;
}

export function normalizeWorkbenchJob(request) {
  const { language, source, tests, typeTests = [], limits = {} } = request ?? {};
  if (!['javascript', 'typescript'].includes(language)) return null;
  if (typeof source !== 'string' || source.length > sourceLimit || !source.trim() || byteLength(source) > sourceLimit) return null;
  if (!Array.isArray(tests) || !Array.isArray(typeTests)) return null;
  if (typeTests.length && language !== 'typescript') return null;
  const count = tests.length + typeTests.length;
  if (!count || count > fixtureCount) return null;

  const ids = new Set();
  let total = 0;
  for (const fixture of [...tests, ...typeTests]) {
    if (typeof fixture?.id !== 'string' || !fixtureId.test(fixture.id) || ids.has(fixture.id)) return null;
    if (typeof fixture.code !== 'string' || fixture.code.length > fixtureLimit || !fixture.code.trim()) return null;
    const bytes = byteLength(fixture.code);
    if (bytes > fixtureLimit || (total += bytes) > suiteLimit) return null;
    ids.add(fixture.id);
  }

  const copy = ({ id, code }) => ({ id, code });
  return {
    language, source, tests: tests.map(copy), typeTests: typeTests.map(copy),
    limits: {
      timeoutMs: limit(limits?.timeoutMs, 500, 25, 2_000),
      totalMs: limit(limits?.totalMs, 8_000, 100, 15_000),
      memoryBytes: limit(limits?.memoryBytes, 32 * 1024 * 1024, 1024 * 1024, 48 * 1024 * 1024),
    },
  };
}
