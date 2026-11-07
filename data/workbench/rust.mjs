// These drills fix one public API so the runner can grade an executable part of
// each book boss. The book's representation and evidence work is reviewed separately.
function drill({ cases, ...exercise }) {
  return {
    ...exercise,
    testNames: cases.map(([name]) => name),
    tests: cases.map(([name, body]) => `#[test]\nfn ${name}() {\n${body}\n}`).join('\n\n'),
  };
}

const shipmentTypes = `pub struct Shipment { pub header: String, pub payload: String, pub annotation: String }
pub struct Recovery { pub header: String, pub payload: String }
pub enum Mode { Inspect, Deliver, Reject }
pub enum Handled {
    Inspected { annotation_bytes: usize, recovery: Recovery },
    Delivered { header: String, payload: String, unused_annotation: String },
    Rejected(Shipment),
}
`;
const regionsSignature = `use std::ops::Range;

pub fn with_regions<T, R>(
    values: &mut [T], first: Range<usize>, second: Range<usize>,
    visit: impl FnOnce(&mut [T], &mut [T]) -> R,
) -> Option<R>`;
const plannerTypes = `pub trait Planner {
    type Plan;
    type Error;
    fn plan(&mut self) -> Result<Self::Plan, Self::Error>;
}

pub trait Policy<Plan> {
    fn accepts(&self, plan: &Plan) -> bool;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Approval<Plan, Error> { Accepted(Plan), Rejected(Plan), PlanningFailed(Error) }

pub fn approve<P: Planner, Q: Policy<P::Plan>>(planner: &mut P, policy: &Q) -> Approval<P::Plan, P::Error>`;
const scalarTypes = `use std::ops::Mul;

#[derive(Debug, PartialEq)]
pub struct Vector<T>(pub T, pub T);
pub struct Scalar<T>(pub T);

impl<T: Copy + Mul<Output = T>> Mul<T> for Vector<T> {
    type Output = Self;
    fn mul(self, scalar: T) -> Self::Output { VECTOR_BODY }
}

impl<T: Copy + Mul<Output = T>> Mul<Vector<T>> for Scalar<T> {
    type Output = Vector<T>;
    fn mul(self, vector: Vector<T>) -> Self::Output { SCALAR_BODY }
}

impl Mul<Vector<i32>> for i32 {
    type Output = Vector<i32>;
    fn mul(self, vector: Vector<i32>) -> Self::Output { I32_BODY }
}

impl Mul<Vector<f64>> for f64 {
    type Output = Vector<f64>;
    fn mul(self, vector: Vector<f64>) -> Self::Output { F64_BODY }
}`;
const lendingTypes = `pub trait PageReader {
    type View<'a>: AsRef<str> where Self: 'a;
    fn next(&mut self) -> Option<Self::View<'_>>;
}

pub struct StableReader<'source> { pages: &'source [&'source str], next: usize }
pub struct ScratchReader<'source> { pages: &'source [&'source str], next: usize, scratch: String }
pub struct ScratchView<'a>(&'a str);

impl AsRef<str> for ScratchView<'_> {
    fn as_ref(&self) -> &str { self.0 }
}

impl<'source> StableReader<'source> {
    pub fn new(pages: &'source [&'source str]) -> Self { Self { pages, next: 0 } }
    pub fn source_page(&self, index: usize) -> Option<&'source str> { SOURCE_BODY }
}

impl<'source> ScratchReader<'source> {
    pub fn new(pages: &'source [&'source str]) -> Self { Self { pages, next: 0, scratch: String::new() } }
}

impl PageReader for StableReader<'_> {
    type View<'a> = &'a str where Self: 'a;
    fn next(&mut self) -> Option<Self::View<'_>> { STABLE_BODY }
}

impl PageReader for ScratchReader<'_> {
    type View<'a> = ScratchView<'a> where Self: 'a;
    fn next(&mut self) -> Option<Self::View<'_>> { SCRATCH_BODY }
}

#[derive(Debug, PartialEq, Eq)]
pub struct PageSummary { pub bytes: usize, pub words: usize }

pub fn summarize(reader: &mut impl PageReader) -> Vec<PageSummary> { SUMMARY_BODY }`;
const macroHeader = `#[macro_export]
macro_rules! scoped_resource {
    (let $guard:ident = $acquire:expr; $body:block) => {{
        match $acquire {`;
const fanoutTypes = `use std::sync::{Arc, mpsc::{SyncSender, TrySendError}};

pub struct Announcement { pub id: u64, pub text: String }

pub enum Transfer {
    Accepted,
    Full(Arc<Announcement>),
    Disconnected(Arc<Announcement>),
}

pub struct FanoutReport { pub north: Transfer, pub south: Transfer }

pub fn fanout(
    announcement: Arc<Announcement>,
    north: &SyncSender<Arc<Announcement>>,
    south: &SyncSender<Arc<Announcement>>,
) -> FanoutReport`;
const pairTypes = `use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

pub struct CoherentPair { generation: AtomicUsize, left: AtomicUsize, right: AtomicUsize }

impl CoherentPair {
    pub fn new(generation: usize, left: usize, right: usize) -> Option<Self> {
        if generation % 2 != 0 { return None; }
        Some(Self {
            generation: AtomicUsize::new(generation),
            left: AtomicUsize::new(left),
            right: AtomicUsize::new(right),
        })
    }
`;
const raceTypes = `use std::{future::Future, pin::Pin, task::{Context, Poll}};

#[derive(Debug, PartialEq, Eq)]
pub enum Winner<L, R> { Left(L), Right(R) }

pub struct RaceTwo<L, R> { left: Option<Pin<Box<L>>>, right: Option<Pin<Box<R>>> }

impl<L, R> RaceTwo<L, R> {
    pub fn new(left: L, right: R) -> Self {
        Self { left: Some(Box::pin(left)), right: Some(Box::pin(right)) }
    }
}

impl<L: Future, R: Future> Future for RaceTwo<L, R> {
    type Output = Winner<L::Output, R::Output>;
`;
const pixelTypes = `pub struct PixelWindow<'a> { pixels: &'a mut [u8] }

impl<'a> PixelWindow<'a> {
    pub fn new(pixels: &'a mut [u8]) -> Self { Self { pixels } }
`;
const labelTypes = `pub struct AsciiLabel { bytes: Vec<u8> }

impl AsciiLabel {
`;
const snapshotTypes = `use std::{ops::Range, sync::Arc};

pub struct SourceSnapshot { source: Arc<str> }
pub struct RecordHandle { source: Arc<str>, range: Range<usize> }

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidRange { pub requested: Range<usize>, pub source_len: usize }

impl SourceSnapshot {
    pub fn new(source: String) -> Self { Self { source: Arc::from(source) } }
`;
const commandTypes = `use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Command { pub id: u64, pub delta: u64 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault { DeliverReply, LoseReply, RejectBeforeExecution }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reply { Confirmed(u64), Rejected, Lost }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State { Ready, Uncertain, Confirmed(u64), Rejected }

pub struct FakePeer { total: u64, retained: BTreeMap<u64, Reply> }

impl FakePeer {
    pub fn new() -> Self { Self { total: 0, retained: BTreeMap::new() } }
    pub fn total(&self) -> u64 { self.total }
    pub fn status(&self, id: u64) -> Option<Reply> { self.retained.get(&id).copied() }
    pub fn expire(&mut self, id: u64) { self.retained.remove(&id); }
    pub fn receive(&mut self, command: Command, fault: Fault) -> Reply { RECEIVE_BODY }
}

pub struct Client { command: Command, state: State }

impl Client {
    pub fn new(command: Command) -> Self { Self { command, state: State::Ready } }
    pub fn send(&mut self, peer: &mut FakePeer, fault: Fault) -> State { SEND_BODY }
    pub fn reconnect(&mut self, peer: &FakePeer) -> State { RECONNECT_BODY }
}`;

export default [
  drill({
    id: 'rust-shipment-moves', level: 2, title: 'Shipment ownership branches',
    description: 'Implement all three owned shipment outcomes. Inspection records the annotation byte count and returns the original header and payload allocations. Delivery returns all three allocations in their assigned fields. Rejection returns the original shipment. Review cleanup and the Drop variant in the book.',
    signature: 'handle(shipment: Shipment, mode: Mode) -> Handled',
    starter: `${shipmentTypes}
pub fn handle(shipment: Shipment, mode: Mode) -> Handled { todo!() }`,
    reference: `${shipmentTypes}
pub fn handle(shipment: Shipment, mode: Mode) -> Handled {
    match mode {
        Mode::Inspect => {
            let annotation = shipment.annotation;
            Handled::Inspected {
                annotation_bytes: annotation.len(),
                recovery: Recovery { header: shipment.header, payload: shipment.payload },
            }
        }
        Mode::Deliver => Handled::Delivered {
            header: shipment.header, payload: shipment.payload, unused_annotation: shipment.annotation,
        },
        Mode::Reject => Handled::Rejected(shipment),
    }
}`,
    cases: [
      ['inspect_preserves_header_and_payload', `let shipment = Shipment { header: "dock".into(), payload: "cargo".into(), annotation: "é".into() };
let Handled::Inspected { annotation_bytes, recovery } = handle(shipment, Mode::Inspect) else { panic!("Expected inspection.") };
assert_eq!(annotation_bytes, 2);
assert_eq!(recovery.header, "dock");
assert_eq!(recovery.payload, "cargo");`],
      ['inspection_and_delivery_move_allocations', `for mode in [Mode::Inspect, Mode::Deliver] {
    let shipment = Shipment { header: "H".into(), payload: "Payload".into(), annotation: "note".into() };
    let allocations = (shipment.header.as_ptr(), shipment.payload.as_ptr(), shipment.annotation.as_ptr());
    match handle(shipment, mode) {
        Handled::Inspected { recovery, .. } => assert_eq!((recovery.header.as_ptr(), recovery.payload.as_ptr()), (allocations.0, allocations.1)),
        Handled::Delivered { header, payload, unused_annotation } => {
            assert_eq!((header.as_ptr(), payload.as_ptr(), unused_annotation.as_ptr()), allocations);
        }
        _ => panic!("Unexpected outcome."),
    }
}`],
      ['reject_returns_original_shipment', `let shipment = Shipment { header: "a".into(), payload: "b".into(), annotation: "c".into() };
let pointer = shipment.payload.as_ptr();
let Handled::Rejected(returned) = handle(shipment, Mode::Reject) else { panic!("Expected rejection.") };
assert_eq!((returned.header.as_str(), returned.payload.as_str(), returned.annotation.as_str()), ("a", "b", "c"));
assert_eq!(returned.payload.as_ptr(), pointer);`],
    ],
  }),
  drill({
    id: 'rust-disjoint-regions', level: 3, title: 'Two disjoint regions',
    description: 'Grant the callback only the two requested nonempty half-open ranges, in request order. Reject an empty, overlapping, reversed or out-of-bounds range without running the callback. Return the callback result on success.',
    signature: 'with_regions<T, R>(&mut [T], Range<usize>, Range<usize>, impl FnOnce(&mut [T], &mut [T]) -> R) -> Option<R>',
    starter: `${regionsSignature} { todo!() }`,
    reference: `${regionsSignature} {
    if first.start >= first.end || second.start >= second.end
        || first.end > values.len() || second.end > values.len() { return None; }
    if first.end <= second.start {
        let (left, right) = values.split_at_mut(second.start);
        return Some(visit(&mut left[first], &mut right[..second.len()]));
    }
    if second.end <= first.start {
        let (left, right) = values.split_at_mut(first.start);
        return Some(visit(&mut right[..first.len()], &mut left[second]));
    }
    None
}`,
    cases: [
      ['adjacent_regions', `let mut values = [1, 2, 3, 4];
let result = with_regions(&mut values, 0..2, 2..4, |first, second| {
    first[0] = 10;
    second[0] = 20;
    first.len() + second.len()
});
assert_eq!(result, Some(4));
assert_eq!(values, [10, 2, 20, 4]);`],
      ['reverse_request_order_and_untouched_gap', `let mut values = [String::from("a"), String::from("b"), String::from("c"), String::from("d")];
assert_eq!(with_regions(&mut values, 3..4, 0..1, |first, second| {
    first[0].push('!');
    second[0].push('?');
}), Some(()));
assert_eq!(values, ["a?", "b", "c", "d!"]);`],
      ['rejects_invalid_regions_without_calling', `let mut values = [1, 2, 3, 4];
let reversed = 3..1;
for (first, second) in [(0..3, 2..4), (0..0, 2..4), (0..2, reversed), (0..2, 3..5), (3..5, 0..1)] {
    let mut called = false;
    assert_eq!(with_regions(&mut values, first, second, |_, _| { called = true; }), None);
    assert!(!called);
    assert_eq!(values, [1, 2, 3, 4]);
}`],
    ],
  }),
  drill({
    id: 'rust-planner-policy', level: 9, title: 'Approve a typed plan',
    description: 'Connect a planner to a policy that inspects its associated Plan type. Preserve an owned plan in accepted and rejected results, preserve the associated planning error on failure, and skip inspection after planning fails. The generic operation has no Display bound.',
    signature: 'approve<P: Planner, Q: Policy<P::Plan>>(&mut P, &Q) -> Approval<P::Plan, P::Error>',
    starter: `${plannerTypes} { todo!() }`,
    reference: `${plannerTypes} {
    match planner.plan() {
        Ok(plan) if policy.accepts(&plan) => Approval::Accepted(plan),
        Ok(plan) => Approval::Rejected(plan),
        Err(error) => Approval::PlanningFailed(error),
    }
}`,
    cases: [
      ['accepts_plan_without_display', `#[derive(Debug, PartialEq, Eq)]
struct Cargo(String);
struct PlanCargo;
impl Planner for PlanCargo {
    type Plan = Cargo;
    type Error = ();
    fn plan(&mut self) -> Result<Cargo, ()> { Ok(Cargo("cargo".into())) }
}
struct Check;
impl Policy<Cargo> for Check { fn accepts(&self, plan: &Cargo) -> bool { !plan.0.is_empty() } }
assert_eq!(approve(&mut PlanCargo, &Check), Approval::Accepted(Cargo("cargo".into())));`],
      ['one_policy_supports_distinct_plans', `struct First;
impl Planner for First {
    type Plan = String;
    type Error = ();
    fn plan(&mut self) -> Result<String, ()> { Ok("north".into()) }
}
struct Second;
impl Planner for Second {
    type Plan = usize;
    type Error = bool;
    fn plan(&mut self) -> Result<usize, bool> { Ok(17) }
}
struct Check;
impl Policy<String> for Check { fn accepts(&self, plan: &String) -> bool { plan == "north" } }
impl Policy<usize> for Check { fn accepts(&self, plan: &usize) -> bool { *plan < 10 } }
assert_eq!(approve(&mut First, &Check), Approval::Accepted("north".into()));
assert_eq!(approve(&mut Second, &Check), Approval::Rejected(17));`],
      ['failure_keeps_error_and_skips_policy', `struct Failing;
impl Planner for Failing {
    type Plan = u32;
    type Error = String;
    fn plan(&mut self) -> Result<u32, String> { Err("unavailable".into()) }
}
struct Check;
impl Policy<u32> for Check { fn accepts(&self, _: &u32) -> bool { panic!("Policy must not run.") } }
assert_eq!(approve(&mut Failing, &Check), Approval::PlanningFailed("unavailable".into()));`],
    ],
  }),
  drill({
    id: 'rust-scalar-coherence', level: 11, title: 'Coherent scalar multiplication',
    description: 'Multiply a two-coordinate Vector by a scalar on the right for any Copy type with closed multiplication. Support left multiplication using Scalar<T>, and support direct left multiplication for i32 and f64. Preserve operand order for a noncommutative Mul implementation.',
    signature: 'Vector<T> * T · Scalar<T> * Vector<T> · i32 * Vector<i32> · f64 * Vector<f64>',
    starter: scalarTypes.replace(/[A-Z0-9]+_BODY/g, 'todo!()'),
    reference: scalarTypes.replace('VECTOR_BODY', 'Self(self.0 * scalar, self.1 * scalar)')
      .replace('SCALAR_BODY', 'Vector(self.0 * vector.0, self.0 * vector.1)')
      .replace('I32_BODY', 'Scalar(self) * vector').replace('F64_BODY', 'Scalar(self) * vector'),
    cases: [
      ['vector_times_scalar', `assert_eq!(Vector(2, -3) * 4, Vector(8, -12));
assert_eq!(Vector(1.5, 2.0) * 2.0, Vector(3.0, 4.0));`],
      ['wrapper_keeps_operand_order', `#[derive(Clone, Copy, Debug, PartialEq)]
struct Token(u32);
impl std::ops::Mul for Token {
    type Output = Self;
    fn mul(self, right: Self) -> Self { Self(self.0 * 100 + right.0) }
}
assert_eq!(Scalar(Token(2)) * Vector(Token(1), Token(3)), Vector(Token(201), Token(203)));
assert_eq!(Vector(Token(1), Token(3)) * Token(2), Vector(Token(102), Token(302)));`],
      ['supported_primitive_left_operators', `assert_eq!(3_i32 * Vector(-1, 2), Vector(-3, 6));
assert_eq!(0.5_f64 * Vector(4.0, -2.0), Vector(2.0, -1.0));`],
    ],
  }),
  drill({
    id: 'rust-lending-pages', level: 13, title: 'Lend a page and own its summary',
    description: 'Implement a lending PageReader with stable source slices and a reusable scratch string. Summarize each page into owned UTF-8 byte and whitespace-separated word counts. The stable reader also exposes a direct source-lifetime view that survives cursor advances. The scratch view borrows only the current scratch buffer.',
    signature: 'PageReader::next(&mut self) -> Option<Self::View<\'_>> · StableReader::source_page(&self, usize) -> Option<&\'source str> · summarize(&mut impl PageReader) -> Vec<PageSummary>',
    starter: lendingTypes.replace(/[A-Z]+_BODY/g, 'todo!()'),
    reference: lendingTypes.replace('SOURCE_BODY', 'self.pages.get(index).copied()')
      .replace('STABLE_BODY', `
        let page = self.pages.get(self.next).copied()?;
        self.next += 1;
        Some(page)
    `)
      .replace('SCRATCH_BODY', `
        let page = self.pages.get(self.next).copied()?;
        self.next += 1;
        self.scratch.clear();
        self.scratch.push_str(page);
        Some(ScratchView(&self.scratch))
    `)
      .replace('SUMMARY_BODY', `
    let mut summaries = Vec::new();
    while let Some(view) = reader.next() {
        let page = view.as_ref();
        summaries.push(PageSummary { bytes: page.len(), words: page.split_whitespace().count() });
    }
    summaries
`),
    cases: [
      ['summarizes_both_reader_types', `let pages = ["north dock", "é", "", "one  two\tthree"];
let expected = vec![PageSummary { bytes: 10, words: 2 }, PageSummary { bytes: 2, words: 1 },
    PageSummary { bytes: 0, words: 0 }, PageSummary { bytes: 14, words: 3 }];
assert_eq!(summarize(&mut StableReader::new(&pages)), expected);
assert_eq!(summarize(&mut ScratchReader::new(&pages)), expected);`],
      ['scratch_advances_with_owned_results', `let pages = ["very long name", "short"];
let mut reader = ScratchReader::new(&pages);
let first = reader.next().expect("First page.").as_ref().to_owned();
assert_eq!(reader.next().expect("Second page.").as_ref(), "short");
assert_eq!(first, "very long name");
assert!(reader.next().is_none());`],
      ['stable_source_borrow_survives_cursor_and_owner', `let owned = String::from("north");
let pages = [owned.as_str(), "south"];
let mut reader = StableReader::new(&pages);
let retained = reader.source_page(0).expect("First source page.");
assert!(reader.source_page(2).is_none());
assert_eq!(reader.next(), Some("north"));
assert_eq!(reader.next(), Some("south"));
drop(reader);
assert_eq!(retained, "north");`],
    ],
  }),
  drill({
    id: 'rust-scoped-resource', level: 17, title: 'Scoped guard macro',
    description: 'Export scoped_resource! with the syntax below. Evaluate the Result-producing acquisition once. On success bind its non-Copy guard inside the block and return the block result. On acquisition failure return the same error without running the block. In this drill return and ? inside the block target the surrounding function.',
    signature: 'scoped_resource!(let guard = acquisition; { /* Result-valued block */ })',
    starter: `${macroHeader}
            ::core::result::Result::Ok($guard) => todo!(),
            ::core::result::Result::Err(error) => ::core::result::Result::Err(error),
        }
    }};
}`,
    reference: `${macroHeader}
            ::core::result::Result::Ok($guard) => $body,
            ::core::result::Result::Err(error) => ::core::result::Result::Err(error),
        }
    }};
}`,
    cases: [
      ['guard_is_in_scope_and_acquired_once', `let calls = std::cell::Cell::new(0);
let result: Result<usize, &str> = scoped_resource!(let guard = {
    calls.set(calls.get() + 1);
    Ok(String::from("dock"))
}; { Ok(guard.len()) });
assert_eq!(calls.get(), 1);
assert_eq!(result, Ok(4));`],
      ['failure_skips_block_and_preserves_error', `let mut entered = false;
let failed: Result<String, &str> = scoped_resource!(let guard = Err::<String, _>("no guard"); {
    entered = true;
    Ok(guard)
});
assert!(!entered);
assert_eq!(failed, Err("no guard"));`],
      ['block_propagates_to_enclosing_function', `fn use_guard() -> Result<usize, &'static str> {
    let _: Result<(), &str> = scoped_resource!(let guard = Ok(String::from("local")); {
        let _len = guard.len();
        Err("body rejected")?;
        Ok(())
    });
    Ok(999)
}
assert_eq!(use_guard(), Err("body rejected"));`],
    ],
  }),
  drill({
    id: 'rust-fanout-report', level: 21, title: 'Report bounded fanout separately',
    description: 'Try one nonblocking send to each tower. Send both queues shared ownership of the same announcement. Classify full and disconnected queues separately, returning their original announcement handles so a caller can retry only failed transfers.',
    signature: 'fanout(Arc<Announcement>, &SyncSender<Arc<Announcement>>, &SyncSender<Arc<Announcement>>) -> FanoutReport',
    starter: `${fanoutTypes} { todo!() }`,
    reference: `${fanoutTypes} {
    fn attempt(queue: &SyncSender<Arc<Announcement>>, value: Arc<Announcement>) -> Transfer {
        match queue.try_send(value) {
            Ok(()) => Transfer::Accepted,
            Err(TrySendError::Full(value)) => Transfer::Full(value),
            Err(TrySendError::Disconnected(value)) => Transfer::Disconnected(value),
        }
    }
    FanoutReport { north: attempt(north, Arc::clone(&announcement)), south: attempt(south, announcement) }
}`,
    cases: [
      ['both_towers_share_one_announcement', `use std::sync::{Arc, mpsc::sync_channel};
let (north, north_rx) = sync_channel(1);
let (south, south_rx) = sync_channel(1);
let report = fanout(Arc::new(Announcement { id: 9, text: "storm".into() }), &north, &south);
assert!(matches!(report.north, Transfer::Accepted) && matches!(report.south, Transfer::Accepted));
let a = north_rx.try_recv().ok().expect("North announcement.");
let b = south_rx.try_recv().ok().expect("South announcement.");
assert_eq!((a.id, a.text.as_str()), (9, "storm"));
assert!(Arc::ptr_eq(&a, &b));`],
      ['disconnected_recipient_preserves_retry_handle', `use std::sync::{Arc, mpsc::sync_channel};
let (north, north_rx) = sync_channel(1);
let (south, south_rx) = sync_channel(1);
drop(south_rx);
let original = Arc::new(Announcement { id: 11, text: "closed".into() });
let report = fanout(Arc::clone(&original), &north, &south);
assert!(matches!(report.north, Transfer::Accepted));
let Transfer::Disconnected(returned) = report.south else { panic!("South is disconnected.") };
assert!(Arc::ptr_eq(&original, &returned));
assert!(Arc::ptr_eq(&original, &north_rx.try_recv().ok().expect("North accepted.")));`],
      ['full_queue_does_not_prevent_other_transfer', `use std::sync::{Arc, mpsc::sync_channel};
let (north, north_rx) = sync_channel(1);
let (south, south_rx) = sync_channel(1);
assert!(north.try_send(Arc::new(Announcement { id: 1, text: "already queued".into() })).is_ok());
let original = Arc::new(Announcement { id: 2, text: "new".into() });
let report = fanout(Arc::clone(&original), &north, &south);
let Transfer::Full(returned) = report.north else { panic!("North is full.") };
assert!(Arc::ptr_eq(&returned, &original));
assert!(matches!(report.south, Transfer::Accepted));
assert_eq!(north_rx.try_recv().ok().expect("Older message.").id, 1);
assert_eq!(south_rx.try_recv().ok().expect("New message.").id, 2);`],
    ],
  }),
  drill({
    id: 'rust-coherent-pair', level: 22, title: 'Coherent atomic pair',
    description: 'Initialize with an even generation. One designated writer publishes a pair using odd then even SeqCst generations. Refuse exhaustion before writing either payload. Readers spend at most the supplied attempt budget and return only a pair from a coherent even generation. The book reviews the single-writer assumption and ordering proof.',
    signature: 'CoherentPair::new(usize, usize, usize) -> Option<Self> · publish(&self, usize, usize) -> Option<usize> · read(&self, usize) -> Option<(usize, usize)>',
    starter: `${pairTypes}
    pub fn publish(&self, left: usize, right: usize) -> Option<usize> { todo!() }
    pub fn read(&self, attempts: usize) -> Option<(usize, usize)> { todo!() }
}`,
    reference: `${pairTypes}
    pub fn publish(&self, left: usize, right: usize) -> Option<usize> {
        let old = self.generation.load(SeqCst);
        let next = old.checked_add(2)?;
        self.generation.store(old + 1, SeqCst);
        self.left.store(left, SeqCst);
        self.right.store(right, SeqCst);
        self.generation.store(next, SeqCst);
        Some(next)
    }

    pub fn read(&self, attempts: usize) -> Option<(usize, usize)> {
        for _ in 0..attempts {
            let generation = self.generation.load(SeqCst);
            if generation % 2 != 0 { continue; }
            let pair = (self.left.load(SeqCst), self.right.load(SeqCst));
            if self.generation.load(SeqCst) == generation { return Some(pair); }
        }
        None
    }
}`,
    cases: [
      ['publish_and_read', `let pair = CoherentPair::new(0, 3, 4).unwrap();
assert_eq!(pair.read(1), Some((3, 4)));
assert_eq!(pair.publish(9, 11), Some(2));
assert_eq!(pair.read(1), Some((9, 11)));`],
      ['finite_budget_and_generation_validation', `assert!(CoherentPair::new(1, 8, 9).is_none());
let pair = CoherentPair::new(10, 0, usize::MAX).unwrap();
assert_eq!(pair.read(0), None);
assert_eq!(pair.publish(3, 5), Some(12));
assert_eq!(pair.publish(7, 11), Some(14));
assert_eq!(pair.read(3), Some((7, 11)));`],
      ['exhaustion_does_not_change_payload', `let pair = CoherentPair::new(usize::MAX - 3, 1, 2).unwrap();
assert_eq!(pair.publish(3, 4), Some(usize::MAX - 1));
assert_eq!(pair.publish(5, 6), None);
assert_eq!(pair.publish(7, 8), None);
assert_eq!(pair.read(1), Some((3, 4)));`],
    ],
  }),
  drill({
    id: 'rust-pinned-race', level: 24, title: 'Race two pinned futures',
    description: 'Use the starter’s pinned child handles and poll left first. Return a tagged winning value, release both handles immediately on completion, and leave a terminal state. A later poll of the completed parent returns Pending without polling either child.',
    signature: 'RaceTwo::new(left, right) · Future<Output = Winner<LeftOutput, RightOutput>>',
    starter: `${raceTypes}
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> { todo!() }
}`,
    reference: `${raceTypes}
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let race = self.get_mut();
        if let Some(left) = race.left.as_mut() {
            if let Poll::Ready(value) = left.as_mut().poll(cx) {
                race.left = None;
                race.right = None;
                return Poll::Ready(Winner::Left(value));
            }
        }
        if let Some(right) = race.right.as_mut() {
            if let Poll::Ready(value) = right.as_mut().poll(cx) {
                race.left = None;
                race.right = None;
                return Poll::Ready(Winner::Right(value));
            }
        }
        Poll::Pending
    }
}`,
    cases: [
      ['left_wins_when_both_are_ready', `use std::{future::{Future, ready}, pin::Pin, task::{Context, Poll, Waker}};
let mut race = RaceTwo::new(ready(9_u8), ready("right"));
let mut cx = Context::from_waker(Waker::noop());
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Ready(Winner::Left(9)));
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Pending);`],
      ['right_win_drops_a_non_unpin_loser', `use std::{cell::Cell, future::{Future, ready}, marker::PhantomPinned, pin::Pin, rc::Rc, task::{Context, Poll, Waker}};
struct PendingChild { drops: Rc<Cell<usize>>, polls: Rc<Cell<usize>>, _pin: PhantomPinned }
impl Future for PendingChild {
    type Output = u8;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<u8> {
        self.polls.set(self.polls.get() + 1);
        Poll::Pending
    }
}
impl Drop for PendingChild {
    fn drop(&mut self) { self.drops.set(self.drops.get() + 1); }
}
let drops = Rc::new(Cell::new(0));
let polls = Rc::new(Cell::new(0));
let child = PendingChild { drops: drops.clone(), polls: polls.clone(), _pin: PhantomPinned };
let mut race = RaceTwo::new(child, ready("win"));
let mut cx = Context::from_waker(Waker::noop());
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Ready(Winner::Right("win")));
assert_eq!((polls.get(), drops.get()), (1, 1));
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Pending);
assert_eq!((polls.get(), drops.get()), (1, 1));`],
      ['both_pending_then_left_completes', `use std::{cell::Cell, future::{Future, pending, poll_fn}, pin::Pin, task::{Context, Poll, Waker}};
let calls = Cell::new(0);
let left = poll_fn(|_| {
    calls.set(calls.get() + 1);
    if calls.get() == 1 { Poll::Pending } else { Poll::Ready(2) }
});
let mut race = RaceTwo::new(left, pending::<i32>());
let mut cx = Context::from_waker(Waker::noop());
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Pending);
assert_eq!(Pin::new(&mut race).poll(&mut cx), Poll::Ready(Winner::Left(2)));`],
    ],
  }),
  drill({
    id: 'rust-pixel-window', level: 30, title: 'Split a borrowed pixel window',
    description: 'Implement a window that borrows the caller’s pixels. Replace one byte by index, returning false on invalid input. Splitting consumes the parent and returns two disjoint child windows. Allow offsets from zero through length and reject larger offsets.',
    signature: 'PixelWindow::new(&mut [u8]) · len(&self) -> usize · replace(&mut self, usize, u8) -> bool · split(self, usize) -> Option<(Self, Self)>',
    starter: `${pixelTypes}
    pub fn len(&self) -> usize { todo!() }
    pub fn replace(&mut self, index: usize, byte: u8) -> bool { todo!() }
    pub fn split(self, offset: usize) -> Option<(Self, Self)> { todo!() }
}`,
    reference: `${pixelTypes}
    pub fn len(&self) -> usize { self.pixels.len() }

    pub fn replace(&mut self, index: usize, byte: u8) -> bool {
        let Some(pixel) = self.pixels.get_mut(index) else { return false; };
        *pixel = byte;
        true
    }

    pub fn split(self, offset: usize) -> Option<(Self, Self)> {
        let (left, right) = self.pixels.split_at_mut_checked(offset)?;
        Some((Self::new(left), Self::new(right)))
    }
}`,
    cases: [
      ['children_edit_disjoint_pixels', `let mut values = [10, 20, 30, 40];
let window = PixelWindow::new(&mut values);
assert_eq!(window.len(), 4);
let (mut left, mut right) = window.split(2).expect("Valid split.");
assert_eq!((left.len(), right.len()), (2, 2));
assert!(left.replace(1, 2));
assert!(right.replace(0, 3));
assert_eq!(values, [10, 2, 3, 40]);`],
      ['empty_children_and_invalid_offsets', `let mut values = [5];
let (mut left, right) = PixelWindow::new(&mut values).split(0).expect("Zero is valid.");
assert_eq!((left.len(), right.len()), (0, 1));
assert!(!left.replace(0, 4));
let (left, right) = right.split(1).expect("Length is valid.");
assert_eq!((left.len(), right.len()), (1, 0));
assert!(left.split(2).is_none());
assert_eq!(values, [5]);`],
      ['replacement_checks_both_boundaries', `let mut values = [1, 2];
let mut window = PixelWindow::new(&mut values);
assert!(window.replace(0, 7));
assert!(window.replace(1, 8));
assert!(!window.replace(2, 9));
assert!(!window.replace(usize::MAX, 9));
assert_eq!(values, [7, 8]);`],
    ],
  }),
  drill({
    id: 'rust-ascii-label', level: 31, title: 'Keep an ASCII label valid',
    description: 'Own private ASCII bytes and expose a borrowed str. Reject any non-ASCII byte at construction, replacement or append. Replacement also rejects an invalid index. A failed edit leaves the label intact, including when append is given a mixed ASCII/non-ASCII slice. Explain the complete safe interface in the book.',
    signature: 'AsciiLabel::new(Vec<u8>) -> Option<Self> · as_str(&self) -> &str · replace(&mut self, usize, u8) -> bool · append(&mut self, &[u8]) -> bool',
    starter: `${labelTypes}
    pub fn new(bytes: Vec<u8>) -> Option<Self> { todo!() }
    pub fn as_str(&self) -> &str { todo!() }
    pub fn replace(&mut self, index: usize, byte: u8) -> bool { todo!() }
    pub fn append(&mut self, suffix: &[u8]) -> bool { todo!() }
}`,
    reference: `${labelTypes}
    pub fn new(bytes: Vec<u8>) -> Option<Self> {
        if !bytes.is_ascii() { return None; }
        Some(Self { bytes })
    }

    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes).expect("ASCII always encodes UTF-8")
    }

    pub fn replace(&mut self, index: usize, byte: u8) -> bool {
        if !byte.is_ascii() { return false; }
        let Some(target) = self.bytes.get_mut(index) else { return false; };
        *target = byte;
        true
    }

    pub fn append(&mut self, suffix: &[u8]) -> bool {
        if !suffix.is_ascii() { return false; }
        self.bytes.extend_from_slice(suffix);
        true
    }
}`,
    cases: [
      ['valid_edits_stay_ascii', `let mut label = AsciiLabel::new(b"Dock".to_vec()).expect("ASCII input.");
assert!(label.replace(0, b'R'));
assert!(label.append(b"-1"));
assert_eq!(label.as_str(), "Rock-1");`],
      ['rejects_utf8_that_is_not_ascii', `assert!(AsciiLabel::new("é".as_bytes().to_vec()).is_none());
assert!(AsciiLabel::new(vec![0xff]).is_none());
let mut label = AsciiLabel::new(Vec::new()).expect("Empty ASCII.");
assert!(label.append(&[0x00, 0x7f]));
assert_eq!(label.as_str().as_bytes(), [0x00, 0x7f]);`],
      ['failed_edits_leave_the_label_intact', `let mut label = AsciiLabel::new(b"a".to_vec()).expect("ASCII input.");
assert!(!label.replace(0, 0x80));
assert!(!label.replace(1, b'z'));
assert!(!label.append(&[b'b', 0xff]));
assert_eq!(label.as_str(), "a");
assert!(label.append(b""));
assert_eq!(label.as_str(), "a");`],
    ],
  }),
  drill({
    id: 'rust-snapshot-record', level: 37, title: 'Record bound to a source snapshot',
    description: 'Own immutable snapshot text and keep a validated byte range attached to its original snapshot. Return an owned diagnostic for reversed, out-of-bounds, or non-UTF-8-boundary spans. A valid empty span is allowed. Old handles remain usable after an edited snapshot is created and the original snapshot handle is dropped.',
    signature: 'SourceSnapshot::new(String) · record(&self, Range<usize>) -> Result<RecordHandle, InvalidRange> · RecordHandle::text(&self) -> &str',
    starter: `${snapshotTypes}
    pub fn record(&self, range: Range<usize>) -> Result<RecordHandle, InvalidRange> { todo!() }
}

impl RecordHandle {
    pub fn text(&self) -> &str { todo!() }
}`,
    reference: `${snapshotTypes}
    pub fn record(&self, range: Range<usize>) -> Result<RecordHandle, InvalidRange> {
        if self.source.get(range.clone()).is_none() {
            return Err(InvalidRange { requested: range, source_len: self.source.len() });
        }
        Ok(RecordHandle { source: Arc::clone(&self.source), range })
    }
}

impl RecordHandle {
    pub fn text(&self) -> &str { &self.source[self.range.clone()] }
}`,
    cases: [
      ['record_retains_original_text', `let snapshot = SourceSnapshot::new("name=crane".into());
let name = snapshot.record(5..10).ok().expect("Valid field.");
drop(snapshot);
assert_eq!(name.text(), "crane");`],
      ['edit_changes_offsets_without_retargeting_old_handle', `let old = SourceSnapshot::new("a=éx".into());
let previous = old.record(2..5).ok().expect("Old value.");
let new = SourceSnapshot::new("lengthened=東".into());
let current = new.record(11..14).ok().expect("New value.");
drop(old);
drop(new);
assert_eq!((previous.text(), current.text()), ("éx", "東"));`],
      ['invalid_spans_report_owned_diagnostics', `let snapshot = SourceSnapshot::new("éx".into());
let reversed = 2..1;
for range in [1..2, reversed, 0..4, 5..5] {
    let Err(diagnostic) = snapshot.record(range.clone()) else { panic!("Invalid byte span.") };
    assert_eq!(diagnostic, InvalidRange { requested: range, source_len: 3 });
}
assert_eq!(snapshot.record(3..3).ok().expect("Valid empty span.").text(), "");`],
    ],
  }),
  drill({
    id: 'rust-lost-acknowledgment', level: 40, title: 'Recover a lost acknowledgment',
    description: 'Simulate a peer applying a command’s delta once while its ID is retained. A lost reply can follow successful execution. Reconnection queries the same stable ID and resolves a retained outcome. A missing status leaves the client uncertain. Only a Ready client sends, so it never blindly repeats an uncertain command.',
    signature: 'FakePeer::receive(Command, Fault) -> Reply · Client::send(&mut FakePeer, Fault) -> State · Client::reconnect(&FakePeer) -> State',
    starter: commandTypes.replace(/[A-Z]+_BODY/g, 'todo!()'),
    reference: commandTypes.replace('RECEIVE_BODY', `
        let outcome = match self.status(command.id) {
            Some(previous) => previous,
            None => {
                let outcome = match (fault, self.total.checked_add(command.delta)) {
                    (Fault::RejectBeforeExecution, _) | (_, None) => Reply::Rejected,
                    (_, Some(next)) => {
                        self.total = next;
                        Reply::Confirmed(next)
                    }
                };
                self.retained.insert(command.id, outcome);
                outcome
            }
        };
        if fault == Fault::LoseReply { Reply::Lost } else { outcome }
    `)
      .replace('SEND_BODY', `
        if self.state == State::Ready {
            self.state = match peer.receive(self.command, fault) {
                Reply::Confirmed(receipt) => State::Confirmed(receipt),
                Reply::Rejected => State::Rejected,
                Reply::Lost => State::Uncertain,
            };
        }
        self.state
    `)
      .replace('RECONNECT_BODY', `
        if self.state == State::Uncertain {
            match peer.status(self.command.id) {
                Some(Reply::Confirmed(receipt)) => self.state = State::Confirmed(receipt),
                Some(Reply::Rejected) => self.state = State::Rejected,
                _ => {}
            }
        }
        self.state
    `),
    cases: [
      ['lost_reply_can_mean_applied', `let mut peer = FakePeer::new();
let mut client = Client::new(Command { id: 19, delta: 7 });
assert_eq!(client.send(&mut peer, Fault::LoseReply), State::Uncertain);
assert_eq!(peer.total(), 7);
assert_eq!(client.reconnect(&peer), State::Confirmed(7));
assert_eq!(peer.total(), 7);`],
      ['duplicate_delivery_uses_stable_id', `let mut peer = FakePeer::new();
let first = Command { id: 10, delta: 4 };
let second = Command { id: 11, delta: 9 };
assert_eq!(peer.receive(first, Fault::LoseReply), Reply::Lost);
assert_eq!(peer.receive(second, Fault::DeliverReply), Reply::Confirmed(13));
assert_eq!(peer.receive(first, Fault::DeliverReply), Reply::Confirmed(4));
assert_eq!(peer.total(), 13);`],
      ['expired_status_does_not_make_retry_safe', `let mut peer = FakePeer::new();
let command = Command { id: 3, delta: 5 };
let mut client = Client::new(command);
assert_eq!(client.send(&mut peer, Fault::LoseReply), State::Uncertain);
peer.expire(command.id);
assert_eq!(peer.status(command.id), None);
assert_eq!(client.reconnect(&peer), State::Uncertain);
assert_eq!(client.send(&mut peer, Fault::DeliverReply), State::Uncertain);
assert_eq!(peer.total(), 5);`],
      ['confirmed_rejection_has_no_effect', `let mut peer = FakePeer::new();
let mut client = Client::new(Command { id: 4, delta: 30 });
assert_eq!(client.send(&mut peer, Fault::RejectBeforeExecution), State::Rejected);
assert_eq!(client.reconnect(&peer), State::Rejected);
assert_eq!(client.send(&mut peer, Fault::DeliverReply), State::Rejected);
assert_eq!(peer.status(4), Some(Reply::Rejected));
assert_eq!(peer.total(), 0);`],
    ],
  }),
];

export const rustBossCoverage = [
  { level: 2, status: 'executable-component', reason: 'The drill checks ownership through all branches. The Drop and cleanup discussion remains authored review.' },
  { level: 3, status: 'executable-component', reason: 'The drill checks disjoint ranges, argument order, callback scope, and rejection.' },
  { level: 5, status: 'authored-review', reason: 'Variance direction and rejected substitutions need compilation evidence and an explanation.' },
  { level: 9, status: 'executable-component', reason: 'The drill checks a generic planner and policy boundary without formatting bounds. The mismatch probe and alternate trait design remain authored review.' },
  { level: 11, status: 'executable-component', reason: 'The drill checks the two legal multiplication designs and operand order. The orphan-rule argument and overlap audit remain authored review.' },
  { level: 13, status: 'executable-component', reason: 'The drill checks the common lending API, owned summaries, and the stable reader’s stronger access. The collect-all borrow probe remains authored review.' },
  { level: 17, status: 'executable-component', reason: 'A cross-crate drill checks macro hygiene, result propagation and single acquisition. Borrow escape and expansion walkthrough remain authored review.' },
  { level: 19, status: 'authored-review', reason: 'Scoped parallel workers and out-of-order thread completion require a native Rust thread runner.' },
  { level: 20, status: 'authored-review', reason: 'Condvar wait, wake, and shutdown evidence requires a native Rust thread runner and an explicit poison policy.' },
  { level: 21, status: 'executable-component', reason: 'The drill fixes nonblocking transfer and checks per-destination outcomes. Interruption and atomic broadcast reasoning remain authored review.' },
  { level: 22, status: 'executable-component', reason: 'The drill checks revision progress, budgets, and exhaustion. The SeqCst and single-writer coherence argument remains authored review.' },
  { level: 24, status: 'executable-component', reason: 'The drill checks a defined left-first policy, non-Unpin children, losing-handle cleanup and terminal behavior.' },
  { level: 28, status: 'authored-review', reason: 'Supervisor policy and thread shutdown require a native failure experiment and an uncertainty argument.' },
  { level: 30, status: 'executable-component', reason: 'The drill checks borrowed pixel edits and checked disjoint splits. The rejected borrow stays in the book evidence.' },
  { level: 31, status: 'executable-component', reason: 'The drill checks construction and mutation through a fixed API. The full safety argument remains authored review.' },
  { level: 33, status: 'authored-review', reason: 'The boss requires a C ownership table and external ABI reasoning that a WASI test cannot establish.' },
  { level: 34, status: 'authored-review', reason: 'The book asks for representation, walkthroughs, snapshot policy, and a benchmark plan.' },
  { level: 35, status: 'authored-review', reason: 'Benchmark design and recorded build or latency observations cannot be graded as one correct runtime.' },
  { level: 36, status: 'authored-review', reason: 'The deliverable is a fault evidence plan with synchronization and compile-time API properties.' },
  { level: 37, status: 'executable-component', reason: 'The drill checks retained spans against version changes and UTF-8 boundaries. The ownership diagram and full editor design remain authored review.' },
  { level: 39, status: 'authored-review', reason: 'A blocked dispatcher and actual thread joins require a native Rust thread runner.' },
  { level: 40, status: 'executable-component', reason: 'The drill checks one deterministic peer and status-only policy. The broader retry and protocol design remain authored review.' },
  { level: 41, status: 'authored-review', reason: 'The deliverable includes package contents, consumer fixtures, compatibility decisions, and release notes.' },
  { level: 42, status: 'authored-review', reason: 'The capstone combines a user-chosen simulator with a wait graph and an invariant argument.' },
];
