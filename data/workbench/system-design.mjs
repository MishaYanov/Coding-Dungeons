const example = (id, code) => ({ id, code, visibility: 'public', group: 'Examples' });
const sealed = (id, group, code) => ({ id, code, visibility: 'sealed', group });

const allocation = {
  id: 'design-url-shortener-allocate',
  title: 'Allocate a code with a retry limit',
  description: 'Reserve a generated code through an injected atomic insert. Retry collisions and leave storage errors visible to the caller.',
  signature: 'function allocateShortCode(url, nextCode, insertIfAbsent)',
  starter: `function allocateShortCode(url, nextCode, insertIfAbsent) {
  // Generate a candidate and ask storage to reserve it.
  return null;
}`,
  reference: `function allocateShortCode(url, nextCode, insertIfAbsent) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nextCode();
    if (insertIfAbsent(code, url)) return code;
  }
  return null;
}`,
  tests: [
    example('first-try', `const url = 'https://example.test/Event?source=QR';
let generated = 0;
const writes = [];
const result = allocateShortCode(url, () => {
  generated++;
  return 'R1a9XzQ8';
}, (code, target) => {
  writes.push([code, target]);
  return true;
});
assert(result === 'R1a9XzQ8', 'Return the code accepted by storage.');
assert(generated === 1 && writes.length === 1, 'Stop after a successful insert.');
assert(writes[0][0] === result && writes[0][1] === url, 'Pass the candidate and original URL to storage.');`),
    example('retries-conflict', `const url = 'https://example.test/events';
const original = 'https://example.test/earlier';
const codes = ['DuP123aB', 'N3w1CodE'];
const stored = new Map([[codes[0], original]]);
let generated = 0;
const attempted = [];
const result = allocateShortCode(url, () => codes[generated++], (code, target) => {
  attempted.push(code);
  if (stored.has(code)) return false;
  stored.set(code, target);
  return true;
});
assert(result === codes[1] && generated === 2 && attempted.length === 2,
  'Generate a new candidate after a collision.');
assert(attempted[0] === codes[0] && attempted[1] === codes[1]);
assert(stored.get(codes[0]) === original && stored.get(codes[1]) === url);`),
    sealed('last-attempt-success', 'Retry bounds', `const candidates = ['AbCd0001', 'AbCd0001', 'AbCd0002', 'AbCd0003', 'AbCd0004'];
let generated = 0;
let inserted = 0;
const url = 'https://example.test/last';
const result = allocateShortCode(url, () => {
  assert(generated === inserted, 'Generate one candidate per attempt.');
  return candidates[generated++];
}, (code, target) => {
  assert(code === candidates[inserted] && target === url);
  inserted++;
  return inserted === 5;
});
assert(result === candidates[4] && generated === 5 && inserted === 5);`),
    sealed('retry-exhaustion', 'Retry bounds', `let generated = 0;
let inserted = 0;
const result = allocateShortCode('https://example.test/full', () => {
  generated++;
  return 'AbCd0000';
}, code => {
  assert(code === 'AbCd0000');
  inserted++;
  return false;
});
assert(result === null && generated === 5 && inserted === 5);`),
    sealed('storage-failure', 'Failure propagation', `const failure = new Error('database unavailable');
let generated = 0;
let inserted = 0;
let caught;
try {
  allocateShortCode('https://example.test/error', () => {
    generated++;
    return 'Err00000';
  }, () => {
    inserted++;
    if (inserted === 1) return false;
    throw failure;
  });
} catch (error) {
  caught = error;
}
assert(caught === failure && generated === 2 && inserted === 2);`),
    sealed('generator-failure', 'Failure propagation', `const failure = new Error('generator unavailable');
let inserted = 0;
let caught;
try {
  allocateShortCode('https://example.test/error', () => {
    throw failure;
  }, () => {
    inserted++;
    return true;
  });
} catch (error) {
  caught = error;
}
assert(caught === failure && inserted === 0);`),
  ],
};

export default {
  id: 'system-design-url-shortener',
  title: 'System Design Quest · Design a URL Shortener',
  description: 'Design a public short-link service for event announcements. Estimate traffic, reserve codes safely, and decide how redirects should behave under load.',
  brief: `The service creates a short code for a submitted HTTP or HTTPS URL. A code is eight case-sensitive Base62 characters (digits and upper- and lowercase letters). Links are public and immutable, and two requests for the same destination may create separate links.

A link expires 30 days after creation. Expired and unknown codes both return HTTP 404. The service never reassigns an issued code, including after expiry. A link must be readable as soon as its creation succeeds.

Expect 864,000 create requests and 86,400,000 redirect requests per day. Use a 5× peak factor for each operation. Assume one region and multiple app instances sharing storage.`,
  debrief: `Divide by 86,400 seconds per day to get 10 creates and 1,000 redirects per second on average. Plan for 50 creates and 5,000 redirects per second at the stated peaks. If all create requests succeed, 30 days of steady traffic produces about 25.9 million live links. Keeping previously issued codes adds storage beyond that live set.

Use POST /links to create a link and return HTTP 201 after committing its code, destination, and expiration time. GET /{code} returns HTTP 302 with a Location header for a live link. Put a case-sensitive unique key on code and use a single insert that reports a key conflict. Generate candidates with a cryptographically secure random source and retry collisions up to the limit. Keep an issued code reserved after clearing its expired destination.

On redirect, look up a live positive cache entry, then fall back to a database read that can see committed writes. Set the cache TTL to the smaller of 60 seconds and the time remaining until expiry. Check the stored expiry time on each hit and at the database. Avoid negative caching so a previously unknown code can resolve immediately after creation. Send Cache-Control: no-store on redirect and 404 responses so HTTP caches do not retain stale results.

During a cache miss spike, combine concurrent misses for the same code on each app instance and cap concurrent database reads from misses. Valid cached redirects can continue. Return HTTP 503 when overload prevents a lookup, and reserve HTTP 404 for confirmed unknown or expired codes. Track cache hit rate, database read load, and redirect latency to verify recovery.`,
  stages: [
    {
      id: 'estimate-load',
      kind: 'choice',
      title: 'Estimate create and redirect traffic',
      prompt: 'Which average and peak request rates follow from the daily totals and peak factor in the brief?',
      options: [
        { id: 'hour-is-second', label: 'Average 36,000 creates/s and 3.6 million redirects/s. Peak 180,000 creates/s and 18 million redirects/s.' },
        { id: 'daily-to-peak', label: 'Average 10 creates/s and 1,000 redirects/s. Peak 50 creates/s and 5,000 redirects/s.' },
        { id: 'peak-only-reads', label: 'Average 10 creates/s and 1,000 redirects/s. Peak 10 creates/s and 5,000 redirects/s.' },
        { id: 'requests-equal', label: 'Average 1,010 creates/s and 1,010 redirects/s. Peak 5,050 creates/s and 5,050 redirects/s.' },
      ],
      answer: 'daily-to-peak',
      success: 'A day has 86,400 seconds. Dividing each daily total and applying the peak factor gives 50 creates/s and 5,000 redirects/s at peak.',
      retry: 'Convert one day to seconds, then apply the peak factor to each rate.',
    },
    {
      id: 'choose-storage',
      kind: 'choice',
      title: 'Make code reservation atomic',
      prompt: `POST /links accepts a destination and GET /{code} resolves it. Two app instances generate the same candidate at the same time. Which storage design prevents both instances from claiming the code and preserves the no-reassignment rule after expiry?`,
      options: [
        { id: 'check-before-write', label: 'Check whether a code exists, then insert without a database constraint. Retain expired rows for future checks.' },
        { id: 'unique-destination', label: 'Use the destination URL as the unique key and let each app instance check candidate codes in its own memory.' },
        { id: 'atomic-code-key', label: 'Use a case-sensitive unique key on code. Insert atomically, retry on a key conflict, and retain the code reservation after expiry.' },
        { id: 'recycle-expired', label: 'Use a case-sensitive unique key on code and delete expired rows so their codes become available again.' },
      ],
      answer: 'atomic-code-key',
      success: 'The shared storage constraint resolves simultaneous claims. Keeping the reservation after expiry prevents an old link from pointing somewhere new.',
      retry: 'Trace the case where both instances finish a read before either writes. Then consider what happens if the original reservation disappears.',
    },
    {
      id: 'allocate-code',
      kind: 'code',
      title: 'Implement collision-safe allocation',
      prompt: `Write allocateShortCode(url, nextCode, insertIfAbsent). The URL is already validated. The supplied callbacks are synchronous. nextCode() returns an eight-character code. insertIfAbsent(code, url) atomically stores a new mapping and returns true, or returns false when the code is already reserved.

On each attempt, call nextCode() once, then pass that code and the original URL to insertIfAbsent. Return the code immediately when storage returns true. Retry after false, counting a repeated candidate as an attempt. Return null after five collisions. If either callback throws, let that error reach the caller immediately.

The workbench supplies both callbacks. This function makes no network requests and has no external dependencies.`,
      exercise: allocation,
    },
    {
      id: 'cache-expiry',
      kind: 'choice',
      title: 'Cache redirects within the link lifetime',
      prompt: 'Most traffic is redirects. You can add a shared cache ahead of the database. Which policy keeps newly created links visible immediately and prevents an expired link from redirecting?',
      options: [
        { id: 'bounded-positive-cache', label: 'Cache live results for up to 60 seconds, capped by remaining link lifetime. Check expiry on hits and read the database on a miss without caching 404s.' },
        { id: 'fixed-positive-cache', label: 'Cache each positive result for 24 hours and serve cached redirects until eviction.' },
        { id: 'negative-cache', label: 'Use the remaining lifetime for live results and cache unknown codes for one minute.' },
        { id: 'client-cache', label: 'Check expiry at the service and let browsers cache every successful redirect for seven days.' },
      ],
      answer: 'bounded-positive-cache',
      success: 'A cached result carries its expiry time, and a miss checks committed data. A new link can resolve even if the code was requested before creation.',
      retry: 'Consider a link cached one second before expiry and a code that receives a lookup just before it is created.',
    },
    {
      id: 'handle-incident',
      kind: 'choice',
      title: 'Protect storage during a cache miss spike',
      prompt: 'During a ticket launch, cache evictions send many concurrent redirect misses to storage. Hot codes account for most misses, with a long tail of one-off codes. Valid cache hits still work. Which response helps both traffic patterns while preserving redirect and expiry behavior?',
      options: [
        { id: 'skip-expiry', label: 'Temporarily serve expired cached destinations to reduce database reads.' },
        { id: 'fail-as-missing', label: 'Return and cache HTTP 404 for every lookup the database cannot complete.' },
        { id: 'coalesce-and-shed', label: 'Share one database lookup among concurrent misses for the same code. Cap concurrent database reads from misses and return HTTP 503 when overloaded.' },
        { id: 'retry-misses', label: 'Retry every failed read immediately to refill cache entries as fast as possible.' },
      ],
      answer: 'coalesce-and-shed',
      success: 'Sharing same-code reads cuts duplicate work on hot keys. The total read limit protects storage from one-off misses, and HTTP 503 preserves the distinction between an unavailable lookup and a confirmed miss.',
      retry: 'Account for both repeated misses on hot codes and misses on distinct codes. A failed read gives you no evidence that a link is missing.',
    },
  ],
};
