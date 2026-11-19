// Source contracts: https://doc.rust-lang.org/std/sync/struct.Mutex.html
// https://doc.rust-lang.org/std/sync/struct.Arc.html
// https://doc.rust-lang.org/std/ops/trait.Drop.html
// https://doc.rust-lang.org/std/process/fn.exit.html
// https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
// https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
function exercise({cases, ...value}) {
  return {...value, language:'rust', testNames:cases.map(([name]) => name),
    tests:cases.map(([name, body]) => `#[test]\nfn ${name}() {\n${body}\n}`).join('\n\n')};
}

const ledgerTypes = `use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, PartialEq, Eq)]
pub enum Claim { Started, Busy, Replayed(u64), Conflict, Unavailable }
#[derive(Clone)]
pub struct Ledger { entries: Arc<Mutex<BTreeMap<String, (String, Option<u64>)>>> }
impl Default for Ledger {
    fn default() -> Self { Self { entries: Arc::new(Mutex::new(BTreeMap::new())) } }
}`;
const ledger = exercise({
  id:'rust-rogue-idempotency', title:'One operation, one owner',
  signature:'Ledger::claim(&self, key: &str, payload: &str) -> Claim; Ledger::complete(&self, key: &str, payload: &str, receipt: u64) -> bool',
  starter:`${ledgerTypes}
impl Ledger {
    pub fn claim(&self, key: &str, payload: &str) -> Claim {
        self.entries.lock().unwrap().insert(key.to_owned(), (payload.to_owned(), None));
        Claim::Started
    }
    pub fn complete(&self, key: &str, payload: &str, receipt: u64) -> bool {
        self.entries.lock().unwrap().insert(key.to_owned(), (payload.to_owned(), Some(receipt)));
        true
    }
}`,
  reference:`${ledgerTypes}
impl Ledger {
    pub fn claim(&self, key: &str, payload: &str) -> Claim {
        let Ok(mut entries) = self.entries.lock() else { return Claim::Unavailable; };
        match entries.get(key) {
            Some((original, _)) if original != payload => Claim::Conflict,
            Some((_, Some(receipt))) => Claim::Replayed(*receipt),
            Some((_, None)) => Claim::Busy,
            None => {
                entries.insert(key.to_owned(), (payload.to_owned(), None));
                Claim::Started
            }
        }
    }
    pub fn complete(&self, key: &str, payload: &str, receipt: u64) -> bool {
        let Ok(mut entries) = self.entries.lock() else { return false; };
        match entries.get_mut(key) {
            Some((original, saved)) if original == payload && saved.is_none() => {
                *saved = Some(receipt);
                true
            }
            _ => false,
        }
    }
}`,
  cases:[
    ['lost_ack_replays_receipt', `let ledger = Ledger::default();
assert_eq!(ledger.claim("req-7", "A:2"), Claim::Started);
assert!(ledger.complete("req-7", "A:2", 41));
assert_eq!(ledger.claim("req-7", "A:2"), Claim::Replayed(41));`],
    ['overlapping_claims_have_one_owner', `fn shared<T: Send + Sync>() {}
shared::<Ledger>();
let ledger = Ledger::default();
let workers = [ledger.clone(), ledger.clone(), ledger.clone()];
assert_eq!(workers[0].claim("same", "body"), Claim::Started);
for worker in &workers[1..] { assert_eq!(worker.claim("same", "body"), Claim::Busy); }
assert_eq!(ledger.claim("different", "body"), Claim::Started);`],
    ['payload_conflicts_do_not_replace_original', `let ledger = Ledger::default();
assert_eq!(ledger.claim("K", "original"), Claim::Started);
assert_eq!(ledger.claim("K", "changed"), Claim::Conflict);
assert!(!ledger.complete("K", "changed", 99));
assert!(ledger.complete("K", "original", 0));
assert_eq!(ledger.claim("K", "changed"), Claim::Conflict);
assert_eq!(ledger.claim("K", "original"), Claim::Replayed(0));`],
    ['completion_requires_pending_owner', `let ledger = Ledger::default();
assert!(!ledger.complete("unknown", "body", 3));
assert_eq!(ledger.claim("unknown", "body"), Claim::Started);
assert!(ledger.complete("unknown", "body", 3));
assert!(!ledger.complete("unknown", "body", 4));
assert_eq!(ledger.claim("unknown", "body"), Claim::Replayed(3));`],
    ['keys_and_payloads_are_exact', `let ledger = Ledger::default();
assert_eq!(ledger.claim("Key", "x"), Claim::Started);
assert_eq!(ledger.claim("key", "x"), Claim::Started);
assert_eq!(ledger.claim("Key", "x "), Claim::Conflict);
assert_eq!(ledger.clone().claim("Key", "x"), Claim::Busy);`],
  ],
});

const retryTypes = `#[derive(Clone, Copy)]
pub enum Failure { Transient, Permanent, UnknownOutcome }
pub fn retry_delay(
    attempt: u32, max_attempts: u32, base_ms: u64, cap_ms: u64,
    remaining_ms: u64, jitter: u64, failure: Failure, idempotent: bool,
) -> Option<u64>`;
const retry = exercise({
  id:'rust-rogue-retry-budget', title:'Stop the retry storm', signature:retryTypes,
  starter:`${retryTypes} {
    let _ = (attempt, max_attempts, cap_ms, remaining_ms, jitter, failure, idempotent);
    Some(base_ms)
}`,
  reference:`${retryTypes} {
    if attempt == 0 || attempt >= max_attempts || base_ms == 0 || cap_ms == 0 {
        return None;
    }
    match failure {
        Failure::Permanent => return None,
        Failure::UnknownOutcome if !idempotent => return None,
        _ => {}
    }
    let mut exponent = attempt - 1;
    let mut window = base_ms.min(cap_ms);
    // Positive doubling reaches any u64 cap in at most 64 steps.
    while exponent > 0 && window < cap_ms {
        window = if window > cap_ms - window { cap_ms } else { window + window };
        exponent -= 1;
    }
    let delay = jitter % window + 1;
    if delay < remaining_ms { Some(delay) } else { None }
}`,
  cases:[
    ['retry_after_transient_failure', `assert_eq!(retry_delay(1, 4, 100, 800, 1000, 42, Failure::Transient, false), Some(43));
assert_eq!(retry_delay(2, 4, 100, 800, 1000, 142, Failure::Transient, false), Some(143));`],
    ['terminal_and_unknown_outcomes', `assert_eq!(retry_delay(1, 3, 10, 50, 100, 0, Failure::Permanent, true), None);
assert_eq!(retry_delay(1, 3, 10, 50, 100, 0, Failure::UnknownOutcome, false), None);
assert_eq!(retry_delay(1, 3, 10, 50, 100, 0, Failure::UnknownOutcome, true), Some(1));`],
    ['attempt_budget_counts_original_attempt', `for attempt in [0, 3, 4, u32::MAX] {
 assert_eq!(retry_delay(attempt, 3, 10, 50, 100, 0, Failure::Transient, true), None);
}
assert_eq!(retry_delay(1, 1, 10, 50, 100, 0, Failure::Transient, true), None);
assert_eq!(retry_delay(1, 0, 10, 50, 100, 0, Failure::Transient, true), None);`],
    ['delay_leaves_time_inside_deadline', `assert_eq!(retry_delay(1, 3, 10, 50, 5, 4, Failure::Transient, true), None);
assert_eq!(retry_delay(1, 3, 10, 50, 6, 4, Failure::Transient, true), Some(5));
assert_eq!(retry_delay(1, 3, 10, 50, 0, 0, Failure::Transient, true), None);`],
    ['backoff_saturates_without_wrapping', `assert_eq!(retry_delay(31, 100, u64::MAX, 17, 20, 16, Failure::Transient, true), Some(17));
assert_eq!(retry_delay(u32::MAX - 1, u32::MAX, 1, 17, 20, 18, Failure::Transient, true), Some(2));
assert_eq!(retry_delay(2, 3, 1_u64 << 63, u64::MAX, u64::MAX, u64::MAX, Failure::Transient, true), Some(1));
assert_eq!(retry_delay(2, 3, u64::MAX, u64::MAX, u64::MAX, u64::MAX, Failure::Transient, true), Some(1));`],
    ['invalid_windows_and_positive_jitter', `assert_eq!(retry_delay(1, 3, 0, 17, 100, 0, Failure::Transient, true), None);
assert_eq!(retry_delay(1, 3, 10, 0, 100, 0, Failure::Transient, true), None);
assert_eq!(retry_delay(1, 3, 100, 17, 100, 18, Failure::Transient, true), Some(2));
for sample in [0, 1, 18, 19, u64::MAX] {
 assert_eq!(retry_delay(3, 8, 8, 19, 100, sample, Failure::Transient, true), Some(sample % 19 + 1));
}`],
  ],
});

const gateTypes = `use std::sync::{Arc, Mutex};
struct State { accepting: bool, active: usize, capacity: usize }
#[derive(Clone)]
pub struct Gate { state: Arc<Mutex<State>> }
pub struct Permit { state: Arc<Mutex<State>> }
impl Gate {
    pub fn new(capacity: usize) -> Self {
        Self { state: Arc::new(Mutex::new(State { accepting: true, active: 0, capacity })) }
    }
    pub fn active(&self) -> usize { self.state.lock().unwrap().active }
    pub fn is_drained(&self) -> bool {
        let state = self.state.lock().unwrap();
        !state.accepting && state.active == 0
    }
`;
const gate = exercise({
  id:'rust-rogue-drain-gate', title:'Close intake, drain the workers',
  signature:'Gate::new(capacity: usize); Gate::try_acquire(&self) -> Option<Permit>; Gate::drain(&self); Gate::active(&self) -> usize; Gate::is_drained(&self) -> bool',
  starter:`${gateTypes}
    pub fn try_acquire(&self) -> Option<Permit> {
        self.state.lock().unwrap().active += 1;
        Some(Permit { state: self.state.clone() })
    }
    pub fn drain(&self) {}
}
impl Drop for Permit {
    fn drop(&mut self) { let _ = &self.state; }
}`,
  reference:`${gateTypes}
    pub fn try_acquire(&self) -> Option<Permit> {
        let mut state = self.state.lock().unwrap();
        if !state.accepting || state.active >= state.capacity { return None; }
        state.active += 1;
        Some(Permit { state: self.state.clone() })
    }
    pub fn drain(&self) { self.state.lock().unwrap().accepting = false; }
}
impl Drop for Permit {
    fn drop(&mut self) { self.state.lock().unwrap().active -= 1; }
}`,
  cases:[
    ['capacity_is_released_by_drop', `let gate = Gate::new(1);
let work = gate.try_acquire().expect("The first worker fits.");
assert!(gate.try_acquire().is_none());
drop(work);
assert_eq!(gate.active(), 0);
assert!(gate.try_acquire().is_some());`],
    ['cloned_gates_share_one_limit', `fn shared<T: Send + Sync>() {}
shared::<Gate>(); shared::<Permit>();
let gate = Gate::new(2);
let other = gate.clone();
let a = gate.try_acquire().unwrap();
let b = other.try_acquire().unwrap();
assert!(other.try_acquire().is_none());
assert_eq!(gate.active(), 2);
drop(a); assert_eq!(other.active(), 1);
drop(b); assert_eq!(gate.active(), 0);`],
    ['drain_rejects_new_work_and_waits_for_old', `let gate = Gate::new(2);
let other = gate.clone();
let work = gate.try_acquire().unwrap();
assert!(!gate.is_drained());
other.drain();
assert!(gate.try_acquire().is_none());
assert!(!other.is_drained());
drop(work);
assert!(gate.is_drained());
assert!(other.try_acquire().is_none());`],
    ['empty_and_zero_capacity_are_distinct', `let gate = Gate::new(0);
assert!(gate.try_acquire().is_none());
assert!(!gate.is_drained());
gate.drain();
gate.drain();
assert!(gate.is_drained());
assert_eq!(gate.active(), 0);`],
    ['early_return_releases_work', `fn handler(gate: &Gate) -> Result<(), &'static str> {
 let _permit = gate.try_acquire().ok_or("full")?;
 Err("downstream rejected")
}
let gate = Gate::new(1);
assert_eq!(handler(&gate), Err("downstream rejected"));
assert_eq!(gate.active(), 0);
gate.drain(); assert!(gate.is_drained());`],
  ],
});

export default {
  id:'rust-runaway-dispatch', title:'The Runaway Dispatch · Rust',
  description:'Seven maintainers patched one dispatch microservice. Its workers duplicate shipments, retry rejected orders forever, and vanish during deploys. Take the midnight incident shift and repair the service one invariant at a time.',
  brief:'INCIDENT 02:17 — carrier applied order K7 but its response vanished. 02:18 two handlers both checked K7 before either recorded it. 02:19 the timeout loop multiplied carrier calls, including permanently rejected orders. 02:20 a deploy exited while accepted workers still owned requests. Seven emergency patches now share this handler. Keep the existing request key and payload, characterize the lost-ack behavior, and replace its ledger, retry policy, and worker admission. The game uses deterministic interleavings. The host author suite also checks real Rust threads; the WASI game runner supplies no OS thread creation.',
  legacyCode:`// Incident sketch: one handler assembled by seven maintainers.
// Request, carrier, and response transport are supplied by the service.
fn on_request(request: Request, seen: Arc<Mutex<BTreeMap<String, u64>>>) {
    std::thread::spawn(move || { // no capacity bound or join handle
        let receipt = seen.lock().unwrap().get(&request.key).copied();
        if let Some(receipt) = receipt { respond(receipt); return; }
        // The lock is gone: another handler can also observe "absent".
        loop {
            match carrier.send(&request.key, &request.payload) {
                Ok(receipt) => {
                    seen.lock().unwrap().insert(request.key.clone(), receipt);
                    respond(receipt); // this acknowledgment may be lost
                    return;
                }
                Err(_) => continue, // timeout or rejection: retry forever
            }
        }
    });
}
// Deploy hook: std::process::exit(0), even with accepted work outstanding.`,
  standardReward:'The dispatch service has bounded work, stable replay decisions, and a documented recovery path.',
  debrief:'Reserve each idempotency key and its exact canonical payload under one short lock. Release the lock before external work. A duplicate sees Busy until a completed response can be replayed, and a payload conflict never replaces the first request. This in-memory ledger coordinates threads in one process only. A production replica fleet needs a transactional shared store and a unique key scoped to tenant and operation, with a retention policy covering its supported retry window. The ledger does not atomically commit a remote carrier effect: keep that receiver idempotent or reconcile unknown outcomes. Unknown outcomes remain pending; a production API also needs a defined durable terminal response for permanent rejection. A durable outbox can atomically save local state and a pending event, but its relay still needs receiver deduplication. Bound retries by attempt count and remaining deadline, distinguish transient failures from permanent rejection, and use independent jitter samples in production. The lab deliberately uses positive jitter in 1..=window rather than the common 0..=window full-jitter variant. The caller must enforce a per-attempt deadline as well as the scheduling budget. Close intake before waiting for in-flight workers, and persist or reconcile work left when the shutdown deadline expires. Gate tracks admission; it does not spawn or join workers. A permit must live until its work actually finishes. RAII covers ordinary scope exit and unwinding, not process exit, abort, or deliberately leaked permits; poisoning is advisory, not a safety proof. A failed or expired local attempt does not prove a remote operation did nothing. Roll out a canary with duplicate-effect, busy/conflict, queue-depth, retry-attempt, latency, and unfinished-drain metrics, using low-cardinality labels instead of request IDs.',
  stages:[
    {
      id:'reconstruct-incident', kind:'choice', title:'Reconstruct the missing acknowledgment',
      prompt:'The carrier applied K7, but the acknowledgment was lost. Handler A and handler B both observe the key as absent before either writes seen. What must the replacement contract establish?',
      options:[
        {id:'atomic-owner', label:'Atomically reserve the key and bind its payload; return Busy for overlapping work and replay a saved receipt after completion.'},
        {id:'mark-late', label:'Write seen only after sending so failed requests are always safe to replay.'},
        {id:'new-key', label:'Generate a fresh key on every retry so the receiver accepts it.'},
      ], answer:'atomic-owner',
      success:'The reservation gives exactly one local handler authority to begin. A stable key also lets a receiver recognize the original operation after a lost acknowledgment.',
      retry:'There is a gap between checking and recording. An absent response does not prove that the carrier rejected the request.',
    },
    {id:'reserve-once', kind:'code', title:'Refactor the idempotency ledger',
      prompt:'Repair Ledger. A key and payload are exact strings. claim must atomically insert a new pending entry and return Started, return Busy for the same pending request, Replayed(receipt) for the same completed request, and Conflict for a changed payload. complete returns true only for a matching pending entry, then saves its receipt permanently; unknown keys, wrong payloads, and repeated completions return false. Ledger clones share entries. Poisoned claim returns Unavailable and poisoned complete returns false. Never hold this lock while calling an external service. Receipt zero is valid. The broken methods compile but violate these contracts.', exercise:ledger},
    {
      id:'separate-failure-kinds', kind:'choice', title:'Label the retry queue',
      prompt:'An invalid destination was permanently rejected. Another request timed out after bytes reached the carrier. Which retry decision preserves the meaning of these two failures?',
      options:[
        {id:'all-transient', label:'Retry both forever because every failure might disappear.'},
        {id:'classify', label:'Stop permanent rejection. Treat the timeout as an unknown outcome and retry only with an idempotent receiver and the original key.'},
        {id:'timeout-rollback', label:'Retry the timeout with a fresh key because a timeout rolls back the carrier.'},
      ], answer:'classify', success:'Retry policy needs failure semantics and receiver guarantees, not just an error Boolean.',
      retry:'A local timeout describes how long the caller waited. It does not describe what the receiver committed.',
    },
    {id:'bound-retries', kind:'code', title:'Replace the infinite retry loop',
      prompt:'Implement retry_delay as a pure policy. attempt is the number of attempts already made, starting at one; max_attempts includes the original. Return None for attempt zero, an exhausted budget, zero base or cap, Permanent, or UnknownOutcome without idempotent=true. Otherwise window = min(cap_ms, base_ms * 2^(attempt - 1)), using saturating arithmetic. The supplied jitter is a deterministic random sample; delay = 1 + jitter % window. Return Some(delay) only if delay < remaining_ms, leaving positive time for the next attempt. All u32/u64 inputs are supported. Do not sleep or perform I/O.', exercise:retry},
    {
      id:'bound-worker-ownership', kind:'choice', title:'Stop the thread explosion',
      prompt:'The service starts a thread for every queued request. A repair adds a capacity counter but decrements it only after successful sends. What should own each admission slot?',
      options:[
        {id:'success-only', label:'The happy-path response serializer; failures can wait for restart.'},
        {id:'detached-thread', label:'A detached thread without a handle or bound.'},
        {id:'scoped-permit', label:'A permit acquired under the shared capacity check and released on every ordinary return or unwinding path.'},
      ], answer:'scoped-permit', success:'An RAII permit ties the slot to a lifetime. Capacity checks and reservation must be one atomic decision.',
      retry:'Look for an owner that is cleaned up when a handler exits with an error as well as when it succeeds.',
    },
    {id:'drain-workers', kind:'code', title:'Refactor shutdown into a drain',
      prompt:'Repair Gate and Permit. Clones share one gate. try_acquire returns a permit only while accepting and active < capacity, reserving exactly one slot under the same mutex. Dropping a permit returns its slot once. drain permanently closes admission without releasing accepted work. is_drained is true only after drain and active==0. Zero capacity accepts no work. Keep the provided API and private state, and let RAII release permits on error paths. Hold the permit until its worker finishes; the caller separately owns and joins worker handles. Assume no panic while a private gate lock is held; arbitrary abort, exit, and leaked permits are outside this contract. The deterministic in-game suite verifies interleavings and Send/Sync bounds; the host author test also uses real threads. No OS threads are created in the WASI suite.', exercise:gate},
    {
      id:'restore-crash-boundary', kind:'choice', title:'Restore the durable boundary',
      prompt:'The repaired handler now admits one permit, claims K7, calls the carrier outside the ledger lock, and records a confirmed receipt. Production adds a local inventory update and an event. A crash happens after that local update but before publish; on restart the in-memory ledger is empty. Which integrated repair closes the local write-and-publish gap?',
      options:[
        {id:'outbox', label:'Commit local inventory, its idempotency result, and an outbox row in one durable transaction. Relay stable IDs with bounded retries to a deduplicating receiver; reconcile uncertain carrier effects.'},
        {id:'mutex', label:'Put both operations behind an in-memory mutex and claim crash safety.'},
        {id:'published-first', label:'Publish first, then assume the inventory write cannot fail.'},
      ], answer:'outbox', success:'The transaction preserves the intent to publish. The relay may send again after an uncertain acknowledgment, so stable IDs and receiver deduplication remain necessary.',
      retry:'An in-process lock disappears on crash. A durable record must survive the gap between the two systems.',
    },
    {
      id:'canary-rollout', kind:'choice', title:'Bring the midnight route back',
      prompt:'K7 is still pending in the old incident log. The repaired service has admission permits, stable claims, bounded retry policy, and a durable outbox plan. Which rollout can distinguish a healthier service from a deployment that quietly drops work?',
      options:[
        {id:'green-http', label:'Only count successful HTTP responses; a drained queue is always success.'},
        {id:'no-retries', label:'Turn off all retry metrics and delete pending work when deploy begins.'},
        {id:'canary', label:'Reconcile old unknown IDs, canary bounded traffic, test replay/lost acknowledgments, and compare confirmed effects, claim conflicts, queue/retry metrics, and unfinished drains. Join accepted workers or persist unfinished work at the deadline.'},
      ], answer:'canary', success:'The service now distinguishes confirmed work, unresolved outcomes, and admission pressure. The rollout can detect disappearance as well as duplication.',
      retry:'A low queue depth can mean either successful processing or discarded requests. Track the disposition of accepted work.',
    },
  ],
};
