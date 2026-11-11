const example = (id, code) => ({ id, code, visibility: 'public', group: 'Examples' });
const sealed = (id, group, code) => ({ id, code, visibility: 'sealed', group });

const expectDecision = `function expectDecision(bucket, nowMs, expected) {
  const before = { ...bucket };
  const actual = consumeToken(bucket, nowMs);
  assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual));
  assert(Object.keys(actual).sort().join(',') === 'allowed,bucket,retryAfterMs');
  assert(actual.allowed === expected.allowed, 'Check whether the refilled bucket can pay one token.');
  assert(actual.retryAfterMs === expected.retryAfterMs, 'Check the retry delay in whole milliseconds.');
  const next = actual.bucket;
  assert(next !== null && typeof next === 'object' && !Array.isArray(next) && next !== bucket);
  assert(Object.keys(next).sort().join(',') === 'capacityTokens,credits,creditsPerMs,updatedAtMs');
  assert(next.credits === expected.credits && next.updatedAtMs === expected.updatedAtMs);
  assert(next.capacityTokens === before.capacityTokens && next.creditsPerMs === before.creditsPerMs);
  assert(Object.keys(bucket).length === Object.keys(before).length);
  for (const key of Object.keys(before)) assert(bucket[key] === before[key], 'Leave the input bucket intact.');
  return next;
}`;

const consumption = {
  id: 'design-rate-limiter-consume',
  title: 'Implement one token bucket update',
  description: 'Refill a token bucket at a supplied time, decide whether to spend one token, and return the next state with an exact retry delay.',
  signature: 'function consumeToken(bucket, nowMs)',
  starter: `function consumeToken(bucket, nowMs) {
  // Refill credits, then decide whether to consume one token.
  return { allowed: false, retryAfterMs: 0, bucket };
}`,
  reference: `function consumeToken(bucket, nowMs) {
  const effectiveNow = Math.max(nowMs, bucket.updatedAtMs);
  const elapsedMs = effectiveNow - bucket.updatedAtMs;
  const capacityCredits = bucket.capacityTokens * 1_000;
  const available = Math.min(capacityCredits, bucket.credits + elapsedMs * bucket.creditsPerMs);
  const allowed = available >= 1_000;
  const credits = allowed ? available - 1_000 : available;
  const retryAfterMs = allowed
    ? 0
    : effectiveNow - nowMs + Math.ceil((1_000 - available) / bucket.creditsPerMs);

  return {
    allowed,
    retryAfterMs,
    bucket: { ...bucket, credits, updatedAtMs: effectiveNow },
  };
}`,
  tests: [
    example('exact-token', `${expectDecision}
const bucket = { capacityTokens: 20, creditsPerMs: 5, credits: 995, updatedAtMs: 199 };
expectDecision(bucket, 200, { allowed: true, retryAfterMs: 0, credits: 0, updatedAtMs: 200 });`),
    example('denial-keeps-credits', `${expectDecision}
const bucket = { capacityTokens: 20, creditsPerMs: 5, credits: 0, updatedAtMs: 0 };
expectDecision(bucket, 199, { allowed: false, retryAfterMs: 1, credits: 995, updatedAtMs: 199 });`),
    sealed('ceil-wait', 'Retry delay', `${expectDecision}
const bucket = { capacityTokens: 2, creditsPerMs: 6, credits: 0, updatedAtMs: 100 };
expectDecision(bucket, 137, { allowed: false, retryAfterMs: 130, credits: 222, updatedAtMs: 137 });`),
    sealed('capacity-clamp', 'Burst and arithmetic limits', `${expectDecision}
const bucket = Object.freeze({ capacityTokens: 1_000, creditsPerMs: 1_000, credits: 999_999, updatedAtMs: 0 });
expectDecision(bucket, 1_000_000_000_000, {
  allowed: true, retryAfterMs: 0, credits: 999_000, updatedAtMs: 1_000_000_000_000,
});`),
    sealed('incremental-refill', 'Repeated requests', `${expectDecision}
const bucket = { capacityTokens: 2, creditsPerMs: 3, credits: 0, updatedAtMs: 100 };
const first = expectDecision(bucket, 250, { allowed: false, retryAfterMs: 184, credits: 450, updatedAtMs: 250 });
const second = expectDecision(first, 430, { allowed: false, retryAfterMs: 4, credits: 990, updatedAtMs: 430 });
const third = expectDecision(second, 434, { allowed: true, retryAfterMs: 0, credits: 2, updatedAtMs: 434 });
expectDecision(third, 434, { allowed: false, retryAfterMs: 333, credits: 2, updatedAtMs: 434 });`),
    sealed('clock-regression', 'Clock behavior', `${expectDecision}
const bucket = { capacityTokens: 2, creditsPerMs: 5, credits: 999, updatedAtMs: 100 };
const next = expectDecision(bucket, 96, { allowed: false, retryAfterMs: 5, credits: 999, updatedAtMs: 100 });
expectDecision(next, 101, { allowed: true, retryAfterMs: 0, credits: 4, updatedAtMs: 101 });
expectDecision({ ...bucket, credits: 1_500 }, 96, { allowed: true, retryAfterMs: 0, credits: 500, updatedAtMs: 100 });`),
    sealed('fresh-state', 'State ownership', `${expectDecision}
const bucket = { capacityTokens: 2, creditsPerMs: 3, credits: 1_500, updatedAtMs: 5 };
const first = expectDecision(bucket, 5, { allowed: true, retryAfterMs: 0, credits: 500, updatedAtMs: 5 });
const second = expectDecision(bucket, 5, { allowed: true, retryAfterMs: 0, credits: 500, updatedAtMs: 5 });
assert(first !== second, 'Each call returns its own bucket state.');`),
  ],
};

export default {
  id: 'system-design-rate-limiter',
  title: 'System Design Quest · Design a Rate Limiter',
  description: 'Protect an export API across four gateway instances. Identify callers reliably, implement a token bucket, and decide what to do when the quota store is unavailable.',
  brief: `A reporting service exposes an expensive export API behind four gateway instances in one region. A client may send requests to any instance. Clients authenticate and have a stable application ID within their tenant, even when they rotate credentials. Several clients can share one public IP address.

Each authenticated client gets one shared export quota. An idle client can burst up to 20 requests. Refill at five tokens per second, with one token spent per request. This quota is independent of quotas for other API policies.

If the quota denies a request, return HTTP 429 with a retry delay. If the service cannot establish a quota decision, protect the export backend by rejecting the request temporarily.`,
  debrief: `Authenticate the request before selecting a bucket. Use the tenant ID, stable application ID, and quota policy ID as the key. Requests for the same policy share one state across gateway instances. Credential rotation keeps the same key.

Start a new bucket with 20 tokens. Store credits as integers at 1,000 credits per token. Five tokens per second adds five credits per millisecond. At each request, refill up to capacity and spend 1,000 credits only when at least that many are available. Preserve the partial balance and the latest recorded time, including after a denial.

For each key, run the read, refill, spend decision, and write as one atomic operation in the shared store. Use a trusted clock for that operation. Route requests for a key to the same authoritative state, and choose failover behavior that preserves accepted spends. Only remove an idle bucket when it would already be full. Losing a partly spent bucket early can grant an extra burst.

For a known denial, return HTTP 429 and send Retry-After as the retry delay rounded up to whole seconds. A storage timeout leaves the decision unknown. This export endpoint returns HTTP 503 and skips starting the export. An update may have committed before timing out. To retry that update without charging twice, deduplicate by a stable request ID within the atomic operation. Track quota denials, limiter errors, and storage latency to distinguish expected throttling from an outage.`,
  stages: [
    {
      id: 'identify-client',
      kind: 'choice',
      title: 'Choose the quota key',
      prompt: 'Clients share IP addresses, rotate credentials, and use multiple gateway instances. Which key enforces the shared export quota for each authenticated application within its tenant?',
      options: [
        { id: 'public-ip-and-route', label: 'The source IP address and request path.' },
        { id: 'authenticated-client-and-policy', label: 'The authenticated tenant ID, stable application ID, and export policy ID.' },
        { id: 'credential-and-instance', label: 'The presented credential and the gateway instance ID.' },
        { id: 'tenant-and-policy', label: 'The tenant ID and export policy ID, shared by all applications in the tenant.' },
      ],
      answer: 'authenticated-client-and-policy',
      success: 'All gateways can derive the same key from verified identity. Different applications have independent quotas, and rotating credentials preserves the bucket.',
      retry: 'Trace two applications behind the same IP, then trace one application after a credential rotation.',
    },
    {
      id: 'choose-token-bucket',
      kind: 'choice',
      title: 'Size the burst and refill',
      prompt: 'A full bucket has 20 tokens and refills continuously at five tokens per second. At one instant, 24 export requests arrive for the same client. Each costs one token. When can the first follow-up request succeed if the client sends no other requests?',
      options: [
        { id: 'fixed-window', label: 'Accept 20 and deny four. The client must wait until the next clock second.' },
        { id: 'instant-overdraft', label: 'Accept all 24 and delay refill until the bucket repays four tokens.' },
        { id: 'bounded-burst', label: 'Accept 20 and deny four. One token is available 200 ms after the burst.' },
        { id: 'rate-as-capacity', label: 'Accept five and deny 19. One token is available 200 ms after the burst.' },
      ],
      answer: 'bounded-burst',
      success: 'The capacity sets the immediate burst. Once empty, the bucket earns a new token in 1/5 of a second, or 200 ms.',
      retry: 'Use the starting token balance for simultaneous requests. Use the refill rate to calculate when the next whole token is available.',
    },
    {
      id: 'consume-token',
      kind: 'code',
      title: 'Write the token bucket decision',
      prompt: `Implement consumeToken(bucket, nowMs). One token costs 1,000 credits. The bucket has capacityTokens (1–1,000), credits (0 through capacityTokens × 1,000), creditsPerMs (1–1,000), and updatedAtMs. All inputs are integers within the stated bounds. Both timestamps are milliseconds from the same epoch, from 0 through 1,000,000,000,000. The bounds keep intermediate integer totals within JavaScript’s safe-integer range.

Take the greater of nowMs and updatedAtMs as the effective time. Add creditsPerMs for each elapsed millisecond and cap the balance at capacityTokens × 1,000. Allow the request if the balance reaches at least 1,000 credits and subtract 1,000 only on success. Record the effective time on both outcomes and preserve any partial balance.

Return { allowed, retryAfterMs, bucket } with a new bucket record containing the same configuration fields and the updated credits and updatedAtMs. Keep the supplied bucket intact. A successful request returns retryAfterMs = 0. On denial, report the smallest whole delay from nowMs until one token would be available if nothing else spends credits. If nowMs is behind the stored timestamp, include the time to catch up before refill resumes. Use the supplied time as the sole clock input.`,
      exercise: consumption,
    },
    {
      id: 'update-atomically',
      kind: 'choice',
      title: 'Handle simultaneous requests',
      prompt: 'Two gateway instances receive requests for the same quota key at the same time. One token remains. Both gateways can reach the shared store. Which update design lets only one request spend that token?',
      options: [
        { id: 'local-mutex', label: 'Use a separate in-process mutex on each gateway while reading and writing shared state.' },
        { id: 'split-shared-write', label: 'Read the shared state, compute the new state in the gateway, and write it back without checking for concurrent changes.' },
        { id: 'serial-queue-per-instance', label: 'Queue each instance’s requests in order and periodically combine their counters.' },
        { id: 'serialize-bucket-update', label: 'Run the read, refill, conditional spend, and write as one atomic operation for the shared bucket key.' },
      ],
      answer: 'serialize-bucket-update',
      success: 'The operation serializes decisions for one bucket. The second request sees the balance after the first spend.',
      retry: 'Find the design that makes it impossible for both gateways to use the same starting balance before either spend is visible.',
    },
    {
      id: 'handle-limiter-outage',
      kind: 'choice',
      title: 'Distinguish quota denials from outages',
      prompt: 'The export backend is healthy. One quota update confirms a denial and calculates a retry delay of 125 ms. Another update times out before the gateway receives a decision. Which responses protect the export backend and communicate both outcomes?',
      options: [
        { id: 'both-denied', label: 'Return HTTP 429 with Retry-After: 1 for both requests.' },
        { id: 'allow-on-timeout', label: 'Return HTTP 429 with Retry-After: 1 for the known denial. Start the export after a quota timeout.' },
        { id: 'distinguish-denial-from-outage', label: 'Return HTTP 429 with Retry-After: 1 for the known denial and HTTP 503 for the timeout. Skip both exports.' },
        { id: 'retry-round-down', label: 'Return HTTP 429 with Retry-After: 0 for the known denial and HTTP 503 for the timeout. Skip both exports.' },
      ],
      answer: 'distinguish-denial-from-outage',
      success: 'Round 125 ms up to one second for Retry-After. A confirmed quota denial gets HTTP 429, and an unavailable quota decision gets HTTP 503 under this endpoint’s policy.',
      retry: 'Convert the known delay to whole seconds without advising the caller to retry too early. A timeout leaves the quota decision unknown.',
    },
  ],
};
