const example = (id, code, imports) => ({id, code, imports, visibility:'public', group:'Examples'});
const sealed = (id, group, code, imports) => ({id, code, imports, visibility:'sealed', group});

const ledgerTypes = `package main

import "sync"

type Claim struct { Kind, Receipt string }
type entry struct { payload, receipt string; done bool }
type Ledger struct { mu sync.Mutex; entries map[string]entry }

func NewLedger() *Ledger { return &Ledger{entries:make(map[string]entry)} }
`;

const ledger = {
  id:'go-rogue-idempotency',
  signature:'func (l *Ledger) Begin(key, payload string) Claim; func (l *Ledger) Finish(key, payload, receipt string) bool',
  starter:ledgerTypes + `
func (l *Ledger) Begin(key, payload string) Claim {
	l.mu.Lock()
	defer l.mu.Unlock()
	// Night-shift patch overwrites the old request before checking it.
	l.entries[key] = entry{payload:payload}
	return Claim{Kind:"accepted"}
}

func (l *Ledger) Finish(key, payload, receipt string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries[key] = entry{payload:payload, receipt:receipt, done:true}
	return true
}

func main() {}`,
  reference:ledgerTypes + `
func (l *Ledger) Begin(key, payload string) Claim {
	if key == "" || payload == "" { return Claim{Kind:"invalid"} }
	l.mu.Lock()
	defer l.mu.Unlock()
	if old, exists := l.entries[key]; exists {
		if old.payload != payload { return Claim{Kind:"conflict"} }
		if old.done { return Claim{Kind:"replay", Receipt:old.receipt} }
		return Claim{Kind:"busy"}
	}
	l.entries[key] = entry{payload:payload}
	return Claim{Kind:"accepted"}
}

func (l *Ledger) Finish(key, payload, receipt string) bool {
	if receipt == "" { return false }
	l.mu.Lock()
	defer l.mu.Unlock()
	old, exists := l.entries[key]
	if !exists || old.payload != payload { return false }
	if old.done { return old.receipt == receipt }
	l.entries[key] = entry{payload:payload, receipt:receipt, done:true}
	return true
}

func main() {}`,
  tests:[
    example('claim-and-replay', `ledger := NewLedger()
if got := ledger.Begin("parcel-7", "west:2"); got != (Claim{Kind:"accepted"}) { t.Fatal("Claim a new delivery.") }
if got := ledger.Begin("parcel-7", "west:2"); got != (Claim{Kind:"busy"}) { t.Fatal("The first caller is still in flight.") }
if !ledger.Finish("parcel-7", "west:2", "receipt-19") { t.Fatal("Finish the claimed delivery.") }
if got := ledger.Begin("parcel-7", "west:2"); got != (Claim{Kind:"replay", Receipt:"receipt-19"}) { t.Fatal("Replay the committed receipt.") }`),
    sealed('payload-conflict-keeps-original', 'Request identity', `ledger := NewLedger()
ledger.Begin("same-key", "west:2")
if got := ledger.Begin("same-key", "east:9"); got != (Claim{Kind:"conflict"}) { t.Fatal("A key cannot change meaning.") }
if ledger.Finish("same-key", "east:9", "wrong") { t.Fatal("A conflicting payload cannot finish the original claim.") }
if ledger.Finish("missing", "west:2", "wrong") { t.Fatal("Do not manufacture a claim during completion.") }
if !ledger.Finish("same-key", "west:2", "original") { t.Fatal("Keep the initial payload.") }
if got := ledger.Begin("same-key", "east:9"); got != (Claim{Kind:"conflict"}) { t.Fatal("Even a completed key rejects different input.") }`),
    sealed('stable-terminal-receipt', 'Completion', `ledger := NewLedger()
ledger.Begin("one", "body")
if ledger.Finish("one", "body", "") { t.Fatal("An empty receipt cannot resolve a pending operation.") }
if got := ledger.Begin("one", "body"); got.Kind != "busy" { t.Fatal("A rejected completion keeps pending state.") }
if !ledger.Finish("one", "body", "stable") || !ledger.Finish("one", "body", "stable") { t.Fatal("Repeating the same completion is safe.") }
if ledger.Finish("one", "body", "replacement") { t.Fatal("A completed receipt is immutable.") }
if got := ledger.Begin("one", "body"); got != (Claim{Kind:"replay", Receipt:"stable"}) { t.Fatal("Keep the original receipt.") }`),
    sealed('invalid-requests-and-independent-keys', 'Validation', `ledger := NewLedger()
for _, pair := range [][2]string{{"", "body"}, {"key", ""}} {
	if got := ledger.Begin(pair[0], pair[1]); got != (Claim{Kind:"invalid"}) { t.Fatal("Reject empty identities without recording them.") }
}
if got := ledger.Begin("key", "body"); got.Kind != "accepted" { t.Fatal("Invalid input must not reserve the key.") }
if got := ledger.Begin("other", "body"); got.Kind != "accepted" { t.Fatal("Distinct keys have independent lifecycles.") }`),
    sealed('simultaneous-duplicate-callers', 'Concurrency', `ledger := NewLedger()
start := make(chan struct{})
replies := make(chan Claim, 24)
var joined sync.WaitGroup
for i := 0; i < 24; i++ {
	joined.Add(1)
	go func() { defer joined.Done(); <-start; replies <- ledger.Begin("one", "body") }()
}
close(start)
joined.Wait()
close(replies)
accepted, busy := 0, 0
for claim := range replies {
	switch claim.Kind { case "accepted": accepted++; case "busy": busy++; default: t.Fatal("Unexpected duplicate decision.") }
}
if accepted != 1 || busy != 23 { t.Fatal("Only one concurrent caller may acquire the operation.") }`, ['sync']),
  ],
};

const retrySignature = 'func RetryDelay(attempt, maxAttempts int, baseMs, capMs, remainingMs int64, sample uint64, failure string) (int64, bool)';
const retry = {
  id:'go-rogue-retry-budget',
  signature:retrySignature,
  starter:`package main

${retrySignature} {
	// The old proxy retries every response forever, at the same interval.
	return baseMs, true
}

func main() {}`,
  reference:`package main

${retrySignature} {
	if failure != "transient" || attempt < 1 || maxAttempts < 1 ||
		attempt >= maxAttempts || baseMs < 1 || capMs < 1 || remainingMs < 1 {
		return 0, false
	}
	window := baseMs
	if window > capMs { window = capMs }
	for step := 1; step < attempt && window < capMs; step++ {
		if window > capMs / 2 { window = capMs } else { window *= 2 }
	}
	delay := int64(sample % (uint64(window) + 1))
	if delay >= remainingMs { return 0, false }
	return delay, true
}

func main() {}`,
  tests:[
    example('retry-window-and-attempt-budget', `delay, ok := RetryDelay(1, 4, 10, 100, 1000, 7, "transient")
if !ok || delay != 7 { t.Fatal("The first retry draws from [0,10].") }
delay, ok = RetryDelay(3, 4, 10, 100, 1000, 39, "transient")
if !ok || delay != 39 { t.Fatal("After attempt three the backoff window reaches 40.") }
if delay, ok := RetryDelay(4, 4, 10, 100, 1000, 7, "transient"); ok || delay != 0 { t.Fatal("Four attempts include the original call.") }`),
    sealed('classify-before-retry', 'Failure semantics', `for _, failure := range []string{"permanent", "unknown", "success", "", "TRANSIENT"} {
	if delay, ok := RetryDelay(1, 4, 10, 100, 1000, 5, failure); ok || delay != 0 { t.Fatal("Retry only explicitly transient failures.") }
}`),
    sealed('cap-and-full-jitter', 'Backoff', `for attempt := 1; attempt <= 6; attempt++ {
	window := []int64{5, 10, 20, 23, 23, 23}[attempt-1]
	for sample := uint64(0); sample <= 80; sample++ {
		delay, ok := RetryDelay(attempt, 7, 5, 23, 1000, sample, "transient")
		if !ok || delay != int64(sample % uint64(window+1)) { t.Fatal("Use the capped inclusive jitter window.") }
	}
}
if delay, ok := RetryDelay(1, 2, 50, 3, 1000, 7, "transient"); !ok || delay != 3 { t.Fatal("Cap even the first window.") }`),
    sealed('deadline-and-invalid-config', 'Retry budget', `for _, input := range [][5]int64{{0,4,10,100,50}, {1,0,10,100,50}, {1,4,0,100,50},
	{1,4,10,0,50}, {1,4,10,100,0}, {1,4,-1,100,50}, {-1,4,10,100,50}} {
	if delay, ok := RetryDelay(int(input[0]), int(input[1]), input[2], input[3], input[4], 0, "transient"); ok || delay != 0 { t.Fatal("Invalid configuration cannot schedule a call.") }
}
if delay, ok := RetryDelay(1, 3, 10, 100, 5, 5, "transient"); ok || delay != 0 { t.Fatal("Starting exactly at the deadline is too late.") }
if delay, ok := RetryDelay(1, 3, 10, 100, 5, 4, "transient"); !ok || delay != 4 { t.Fatal("A delay strictly within budget is allowed.") }`),
    sealed('saturate-before-overflow', 'Overflow', `const maximum int64 = 1<<63 - 1
if delay, ok := RetryDelay(70, 100, maximum/2+1, maximum, maximum, uint64(maximum)-1, "transient"); !ok || delay != maximum-1 {
	t.Fatal("Saturate before doubling or computing the unsigned modulus.")
}
if delay, ok := RetryDelay(70, 100, maximum/2+1, maximum, maximum, uint64(maximum), "transient"); ok || delay != 0 {
	t.Fatal("A maximum delay consumes the whole remaining budget.")
}`),
  ],
};

const drainTypes = `package main

import (
	"context"
	"errors"
	"sync"
)

var ErrWorkerCount = errors.New("workers must be between 1 and 32")
`;
const drainSignature = 'func DrainBatch(ctx context.Context, ids []string, workers int, send func(context.Context, string) error) (int, error)';
const drain = {
  id:'go-rogue-drain-workers',
  signature:drainSignature,
  starter:drainTypes + `
${drainSignature} {
	// The hotfix starts unowned goroutines and reports success immediately.
	_ = sync.WaitGroup{}
	for _, id := range ids { go send(ctx, id) }
	return len(ids), nil
}

func main() {}`,
  reference:drainTypes + `
${drainSignature} {
	if workers < 1 || workers > 32 { return 0, ErrWorkerCount }
	confirmed := 0
	for offset := 0; offset < len(ids); {
		if err := ctx.Err(); err != nil { return confirmed, err }
		end := offset + workers
		if end > len(ids) { end = len(ids) }
		errs := make([]error, end-offset)
		var joined sync.WaitGroup
		for index := offset; index < end; index++ {
			joined.Add(1)
			go func(index int) {
				defer joined.Done()
				if err := ctx.Err(); err != nil { errs[index-offset] = err; return }
				errs[index-offset] = send(ctx, ids[index])
			}(index)
		}
		joined.Wait()
		var first error
		for _, err := range errs {
			if err == nil { confirmed++ } else if first == nil { first = err }
		}
		if first != nil { return confirmed, first }
		offset = end
	}
	return confirmed, nil
}

func main() {}`,
  tests:[
    example('deliver-batches-with-a-confirmed-count', `ids := []string{"east", "north", "west", "south", "east"}
var mu sync.Mutex
counts := map[string]int{}
confirmed, err := DrainBatch(context.Background(), ids, 2, func(_ context.Context, id string) error {
	mu.Lock(); defer mu.Unlock(); counts[id]++; return nil
})
if err != nil || confirmed != len(ids) || counts["east"] != 2 || counts["north"] != 1 || counts["west"] != 1 || counts["south"] != 1 { t.Fatal("Every successful callback confirms one input position.") }
if !slices.Equal(ids, []string{"east", "north", "west", "south", "east"}) { t.Fatal("Keep the input unchanged.") }`, ['context', 'sync', 'slices']),
    sealed('reject-worker-count-before-starting', 'Admission', `for _, workers := range []int{-1, 0, 33, 1000000} {
	confirmed, err := DrainBatch(context.Background(), []string{"east"}, workers, func(context.Context, string) error { t.Fatal("Do not start with invalid capacity."); return nil })
	if confirmed != 0 || !errors.Is(err, ErrWorkerCount) { t.Fatal("Validate workers before dispatch.") }
}
ctx, cancel := context.WithCancel(context.Background()); cancel()
confirmed, err := DrainBatch(ctx, nil, 1, func(context.Context, string) error { t.Fatal("Empty input does not dispatch."); return nil })
if confirmed != 0 || err != nil { t.Fatal("An empty valid batch is already complete.") }`, ['context', 'errors']),
    sealed('recall-stops-next-batch', 'Cancellation', `ctx, cancel := context.WithCancel(context.Background()); defer cancel()
called := 0
confirmed, err := DrainBatch(ctx, []string{"east", "north"}, 1, func(got context.Context, id string) error {
	called++
	if got != ctx || id != "east" { t.Fatal("Stop before north, preserving the caller's context.") }
	cancel(); return nil
})
if confirmed != 1 || err != ctx.Err() || called != 1 { t.Fatal("Keep confirmed progress when stopping.") }
called = 0
confirmed, err = DrainBatch(ctx, []string{"west"}, 2, func(context.Context, string) error { called++; return nil })
if confirmed != 0 || err != ctx.Err() || called != 0 { t.Fatal("Never dispatch with an already canceled context.") }`, ['context']),
    sealed('join-peers-and-stop-after-failure', 'Drain and partial failures', `ctx := context.Background()
problem := errors.New("receiver explicitly rejected north")
started := make(chan string, 2)
release := make(chan struct{})
type outcome struct { count int; err error }
finished := make(chan outcome, 1)
go func() {
	count, err := DrainBatch(ctx, []string{"east", "north", "never"}, 2, func(_ context.Context, id string) error {
		started <- id; <-release
		if id == "north" { return problem }; return nil
	})
	finished <- outcome{count, err}
}()
first, second := <-started, <-started
if first == second || first == "never" || second == "never" { t.Fatal("Start exactly the first batch concurrently.") }
select { case <-finished: t.Fatal("Do not return while callbacks are in flight."); default: }
close(release)
result := <-finished
if result.count != 1 || !errors.Is(result.err, problem) { t.Fatal("Join peers, count only confirmations, and return the rejection.") }
select { case <-started: t.Fatal("No next batch after an error."); default: }`, ['context', 'errors']),
    sealed('wait-for-entire-batch-before-admission', 'Backpressure', `ctx := context.Background()
started := make(chan string, 3)
releaseFirst := make(chan struct{})
releaseSecond := make(chan struct{})
done := make(chan int, 1)
go func() {
	count, _ := DrainBatch(ctx, []string{"east", "north", "west"}, 2, func(_ context.Context, id string) error {
		started <- id
		if id == "east" { <-releaseFirst }
		if id == "north" { <-releaseSecond }
		return nil
	})
	done <- count
}()
first, second := <-started, <-started
if first == second || first == "west" || second == "west" { t.Fatal("Bound concurrent work by the first batch.") }
close(releaseFirst)
select { case id := <-started: t.Fatal("A new batch must wait for north too.", id); default: }
close(releaseSecond)
if <-done != 3 { t.Fatal("Drain all successful batches before returning.") }
if <-started != "west" { t.Fatal("Resume admission only after the barrier.") }`, ['context']),
    sealed('final-success-and-error-selection', 'Result contract', `ctx, cancel := context.WithCancel(context.Background()); defer cancel()
confirmed, err := DrainBatch(ctx, []string{"last"}, 1, func(context.Context, string) error { cancel(); return nil })
if confirmed != 1 || err != nil { t.Fatal("All requested work was confirmed even if the last callback canceled.") }
first := errors.New("first input failed")
second := errors.New("second input failed")
confirmed, err = DrainBatch(context.Background(), []string{"east", "north"}, 2, func(_ context.Context, id string) error {
	if id == "east" { return first }; return second
})
if confirmed != 0 || !errors.Is(err, first) { t.Fatal("Choose the first failing input position in the failed batch.") }`, ['context', 'errors']),
  ],
};

export default {
  id:'rogue-go-dispatch',
  title:'The Runaway Dispatch · Go',
  description:'Five developers patched a parcel microservice during different emergencies. Tonight its retries duplicate deliveries, its goroutines outlive their callers, and its health check still says green. Take the incident shift, preserve the useful behavior, and repair the contracts one boundary at a time.',
  brief:'02:11 receiver applied parcel-7; acknowledgment lost. 02:12 proxy retried with a new ID. 02:13 two workers claimed the same key. 02:14 deployment returned while old goroutines were still delivering. Repair this one service’s request ledger, retry planner, and worker supervisor as three isolated modules, then integrate their operational contracts in the rollout plan. The lab uses an in-process receiver model and injected outcomes. No live network or sleeps are needed. The worker stage runs real goroutines, synchronized by channels and WaitGroup.',
  legacyCode:`// Incident extract from one DispatchService, not code to deploy.
// receiver sends a parcel using the supplied operation key and payload.
type Parcel struct { Key, Payload string }
type DispatchService struct {
    seen map[string]string
    serial int
    receiver func(context.Context, string, string) (string, error)
}

func (s *DispatchService) Submit(ctx context.Context, parcel Parcel) {
    if s.seen[parcel.Key] != "" { return }
    go func() {
        for {
            s.serial++
            freshKey := fmt.Sprintf("%s-retry-%d", parcel.Key, s.serial)
            receipt, err := s.receiver(ctx, freshKey, parcel.Payload)
            if err == nil { s.seen[parcel.Key] = receipt; return }
        }
    }()
}
// No atomic claim, stable retry key, budget, admission limit, or join.
// Even context cancellation can feed this endless retry loop.`,
  debrief:'Keep request identity, retry policy, and worker ownership separate. The mutex makes each claim transition atomic within this process; every access to the same ledger must use it. Release the lock before receiver I/O. Keep a pending record when the receiver outcome is unknown, and reconcile using the same stable operation ID. A permanent rejection becomes a cached terminal response in a real API, while a retryable rejection is explicitly classified before retry. This exercise caches successful receipts and deliberately leaves ambiguous requests pending. Full jitter spreads attempts, but a retry budget and per-attempt deadline still bound the work. The batch worker sacrifices streaming throughput for a simple join boundary: every callback in a batch finishes before the next batch begins, so no callback survives a return. Callbacks must honor context for prompt cancellation; a context does not forcibly stop arbitrary code. Before production, move idempotency state into a durable shared transaction with a unique key and canonical payload fingerprint. A process-local mutex does not coordinate replicas or survive restart. Put local state change and an outbox row in the same database transaction, then let a publisher retry with an idempotent receiver. The outbox can publish more than once; receiver deduplication makes those repeats safe. Reconcile effects already sent before replaying old logs. Roll out behind a canary and compare duplicate, conflict, queue, attempt, latency, and unknown-outcome metrics against a known baseline. References: https://go.dev/ref/mem , https://pkg.go.dev/sync#Mutex , https://pkg.go.dev/context , https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/',
  standardReward:'The dispatch service has a bounded repair plan, characterized behavior, and a staged rollout record.',
  stages:[
    {
      id:'trace-incident', kind:'choice', title:'Freeze the incident timeline',
      prompt:'The receiver applied parcel-7, but the response was lost. The proxy says timeout and generated a new request ID. What should the incident test capture before you refactor?',
      options:[
        {id:'unknown-outcome', label:'Timeout leaves the remote outcome unknown. A retry must preserve the original operation identity and reconcile or use receiver deduplication.'},
        {id:'timeout-rollback', label:'A timeout proves the receiver rolled back, so changing the ID is safe.'},
        {id:'always-success', label:'Treat every timeout as success because the receiver might have applied the parcel.'},
      ],
      answer:'unknown-outcome', success:'The timeline separates an observed response failure from the remote side effect. Keep that distinction in your tests.',
      retry:'The proxy knows it missed a response. Neither a rollback nor a successful effect follows from that observation alone.',
    },
    {
      id:'reserve-idempotency', kind:'code', title:'Replace check-then-act with one claim',
      prompt:'Repair the two Ledger methods without changing their public API. Use a Ledger created by NewLedger and share its pointer between goroutines. Begin returns Claim{Kind:"invalid"} for an empty key or payload, with no write. For a new pair it atomically records a pending entry and returns "accepted". The same key and payload returns "busy" while pending, or "replay" with the original Receipt after completion. A reused key with different payload returns "conflict" and never changes the original entry. Non-replay claims have an empty Receipt. Finish only completes an existing matching pair with a nonempty receipt. Repeating that exact completion returns true; missing keys, mismatched payloads, empty receipts, or a different terminal receipt return false without changing state. Lock each complete state transition. There is no receiver call inside these methods: the successful claimant performs I/O after Begin returns, then invokes Finish only when it has a confirmed receipt. Preserve a pending claim for an unknown outcome.',
      exercise:ledger,
    },
    {
      id:'classify-unknown', kind:'choice', title:'Handle the claim that never completed',
      prompt:'A worker got accepted, then its receiver call timed out. There is no confirmed receipt. Another caller now gets busy. What is the repair policy?',
      options:[
        {id:'erase-pending', label:'Delete the pending claim so the next caller can send with a fresh ID.'},
        {id:'reconcile-stable', label:'Retain pending, query/reconcile with the same operation ID, and complete with the confirmed original result.'},
        {id:'hold-lock', label:'Keep the mutex locked while waiting for the receiver to recover.'},
      ],
      answer:'reconcile-stable', success:'Pending records express incomplete knowledge. A recovery worker needs a receiver contract and a durable record to resolve them.',
      retry:'Deleting the evidence or blocking every claim cannot determine whether the receiver already applied this operation.',
    },
    {
      id:'budget-retries', kind:'code', title:'Replace the endless retry loop',
      prompt:'Implement RetryDelay as a pure scheduling decision. attempt is the 1-based number of the call that just failed; maxAttempts includes the first call. Return (0,false) unless failure equals "transient", attempt >= 1, maxAttempts >= 1, attempt < maxAttempts, and baseMs, capMs, remainingMs are positive. The retry window is min(capMs, baseMs * 2^(attempt-1)); saturate before overflow and clamp even the first window. Use the supplied sample as deterministic full jitter: delay = sample % (window + 1), including both zero and the upper endpoint. Return (delay,true) only if delay < remainingMs, otherwise (0,false). Use unsigned arithmetic for window+1 when capMs is the largest int64. Do not sleep or send. In production, sample comes from a random source, every retry keeps its operation key and payload, and the caller separately enforces the remaining execution deadline.',
      exercise:retry,
    },
    {
      id:'isolate-workers', kind:'choice', title:'Own the workers before reopening traffic',
      prompt:'The deployment currently starts a goroutine for every parcel and immediately returns. What property should the replacement make testable?',
      options:[
        {id:'sleep-at-exit', label:'Wait a fixed ten seconds at shutdown and assume all sends finished.'},
        {id:'unbounded-channel', label:'Buffer every pending parcel so the producer never needs to wait.'},
        {id:'bounded-owned', label:'Bound active work, pass cancellation into callbacks, stop new admission at a defined boundary, and join accepted work before return.'},
      ],
      answer:'bounded-owned', success:'Capacity and worker lifetime are observable contracts. The next repair chooses a batch barrier so a deterministic test can check both.',
      retry:'A fixed delay or unbounded buffer gives no bound on accepted work or evidence that callbacks are finished.',
    },
    {
      id:'drain-workers', kind:'code', title:'Add a bounded batch and drain barrier',
      prompt:'Repair DrainBatch. workers outside 1..32 returns (0,ErrWorkerCount) before any callback. With valid capacity, empty input returns (0,nil), even if ctx is canceled. Otherwise process consecutive batches of at most workers entries. Before a batch starts, stop on ctx.Err() and preserve the number confirmed so far. Start one goroutine for each entry in that batch; each checks ctx.Err() before calling send(ctx,id). A skipped entry records that context error. Pass the original context, preserve duplicate IDs and leave ids unchanged. Wait for every goroutine in the batch to finish, count only nil results, then return the first non-nil error in that batch’s input order. Do not start a later batch after any error. If all requested callbacks succeed, return (len(ids),nil), including cancellation during the final successful call. No callback may still be running when DrainBatch returns. Callbacks in this lab cooperate with cancellation. Batches intentionally trade streaming throughput for simple worker ownership and deterministic drain boundaries.',
      exercise:drain,
    },
    {
      id:'commit-outbox', kind:'choice', title:'Cross the database and broker boundary',
      prompt:'Your in-process tests pass. Production has three replicas, and each delivery also emits an audit event. A crash can happen after the database commits but before the broker receives the event. Which design addresses that gap?',
      options:[
        {id:'transactional-outbox', label:'Commit business state, the idempotency result, and an outbox row together. Retry publishing the outbox, and deduplicate at consumers.'},
        {id:'mutex-across-replicas', label:'Share the same Go source code so each replica’s local mutex protects all replicas.'},
        {id:'publish-first', label:'Publish first, then update the database; publishing first makes the two effects atomic.'},
      ],
      answer:'transactional-outbox', success:'One local transaction closes the write gap. The outbox publisher can repeat, so consumers still need stable identities and deduplication.',
      retry:'The database and broker do not become one transaction because the code runs in a particular order.',
    },
    {
      id:'canary-rollout', kind:'choice', title:'Restore the service one lane at a time',
      prompt:'The service is paused with old pending claims and a repaired implementation. What makes the rollout evidence meaningful?',
      options:[
        {id:'delete-history', label:'Delete prior pending requests and all metrics, then reopen every lane.'},
        {id:'observe-and-reconcile', label:'Reconcile unresolved operation IDs, run a small canary, compare duplicate/conflict/unknown rates and queue/latency budgets, then widen with rollback criteria.'},
        {id:'green-health', label:'Restart every replica and stop once the health endpoint returns 200.'},
      ],
      answer:'observe-and-reconcile', success:'The rollout tests the operational contract as well as the code. Uncertain historical effects need reconciliation before replay.',
      retry:'A running process or clean metrics history does not show that old effects and new retries agree.',
    },
  ],
};
