from pathlib import Path
import json
import re
from textwrap import dedent


exercises = []


def clean(source):
    return dedent(source).strip() + '\n'


def add(id, level, title, description, signature, prompt_match, source, checks):
    source = clean(source)
    checks = clean(checks)
    pattern = r'(?ms)^([ \t]*)// TASK: ([^\n]+)\n.*?^[ \t]*// END TASK\n'
    starter = re.sub(pattern, lambda m: f'{m[1]}todo!({json.dumps(m[2])})\n', source)
    solution = re.sub(r'^[ \t]*// (?:TASK: [^\n]+|END TASK)\n', '', source, flags=re.M)
    exercises.append({
        'id': id, 'level': level, 'title': title, 'description': description,
        'signature': signature, 'starter': starter,
        'testNames': re.findall(r'^#\[test\]\nfn (\w+)\(', checks, flags=re.M),
        'tests': checks, 'solution': solution, 'promptMatch': prompt_match,
    })


add('cargo-handoff', 1, 'Recover the rejected cargo',
    'Complete the loading dock’s consuming handoff. Accept a capsule whose destination is nonzero and whose payload length fits the dock’s per-capsule limit. Store it and return its zero-based position and destination. On rejection, return the original capsule with its allocation intact. Check the destination first when both checks fail. A valid destination with an empty payload is allowed.',
    'Dock::submit(&mut self, cargo: Capsule) -> Result<Receipt, (RejectReason, Capsule)>',
    'boss', r'''
    pub struct Capsule {
        destination: u16,
        payload: Vec<u8>,
    }

    impl Capsule {
        pub fn new(destination: u16, payload: Vec<u8>) -> Self {
            Self { destination, payload }
        }

        pub fn bytes(&self) -> &[u8] {
            &self.payload
        }

        pub fn replace_payload(&mut self, payload: Vec<u8>) {
            self.payload = payload;
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum RejectReason {
        InvalidDestination,
        PayloadTooLarge,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub struct Receipt {
        pub index: usize,
        pub destination: u16,
    }

    pub struct Dock {
        max_payload: usize,
        accepted: Vec<Capsule>,
    }

    impl Dock {
        pub fn new(max_payload: usize) -> Self {
            Self { max_payload, accepted: Vec::new() }
        }

        pub fn accepted(&self) -> &[Capsule] {
            &self.accepted
        }

        pub fn submit(&mut self, cargo: Capsule)
            -> Result<Receipt, (RejectReason, Capsule)>
        {
            // TASK: validate the cargo before moving it into the dock
            if cargo.destination == 0 {
                return Err((RejectReason::InvalidDestination, cargo));
            }
            if cargo.payload.len() > self.max_payload {
                return Err((RejectReason::PayloadTooLarge, cargo));
            }
            let receipt = Receipt {
                index: self.accepted.len(),
                destination: cargo.destination,
            };
            self.accepted.push(cargo);
            Ok(receipt)
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn accepts_exact_limit_without_copying() {
        let mut dock = Dock::new(3);
        let cargo = Capsule::new(9, vec![4, 5, 6]);
        let original = cargo.bytes().as_ptr();
        let receipt = dock.submit(cargo).ok().unwrap();
        assert_eq!(receipt, Receipt { index: 0, destination: 9 });
        assert_eq!(dock.accepted()[0].bytes(), &[4, 5, 6]);
        assert_eq!(dock.accepted()[0].bytes().as_ptr(), original);
    }

    #[test]
    fn rejected_owner_can_correct_and_resubmit() {
        let mut dock = Dock::new(2);
        let cargo = Capsule::new(3, vec![1, 2, 3]);
        let original = cargo.bytes().as_ptr();
        let (reason, mut returned) = dock.submit(cargo).err().unwrap();
        assert_eq!(reason, RejectReason::PayloadTooLarge);
        assert_eq!(returned.bytes(), &[1, 2, 3]);
        assert_eq!(returned.bytes().as_ptr(), original);
        assert!(dock.accepted().is_empty());
        returned.replace_payload(vec![7, 8]);
        assert_eq!(dock.submit(returned).ok().unwrap().index, 0);
        assert_eq!(dock.submit(Capsule::new(3, vec![])).ok().unwrap().index, 1);
    }

    #[test]
    fn invalid_destination_takes_precedence() {
        let mut dock = Dock::new(0);
        let (reason, cargo) = dock.submit(Capsule::new(0, vec![1])).err().unwrap();
        assert_eq!(reason, RejectReason::InvalidDestination);
        assert_eq!(cargo.bytes(), &[1]);
        assert!(dock.accepted().is_empty());
    }
    ''')


add('split-registers', 3, 'Borrow two disjoint registers',
    'Return mutable references to two distinct elements in the caller’s requested order. Return None for equal indices or any out-of-range index. Use safe slice splitting to turn a checked inequality into two exclusive borrows. The function should work with move-only elements.',
    'two_mut<T>(slice: &mut [T], first: usize, second: usize) -> Option<(&mut T, &mut T)>',
    'two arbitrary indices in a slice', r'''
    pub fn two_mut<T>(slice: &mut [T], first: usize, second: usize)
        -> Option<(&mut T, &mut T)>
    {
        // TASK: split the slice and preserve requested order
        if first == second || first >= slice.len() || second >= slice.len() {
            return None;
        }
        if first < second {
            let (before, after) = slice.split_at_mut(second);
            Some((&mut before[first], &mut after[0]))
        } else {
            let (before, after) = slice.split_at_mut(first);
            Some((&mut after[0], &mut before[second]))
        }
        // END TASK
    }
    ''', r'''
    #[test]
    fn borrows_in_forward_order() {
        let mut data = [10, 20, 30, 40];
        let (first, second) = two_mut(&mut data, 0, 3).unwrap();
        *first += 1;
        *second += 2;
        assert_eq!(data, [11, 20, 30, 42]);
    }

    #[test]
    fn preserves_reverse_order_and_move_only_values() {
        let mut data = [String::from("west"), String::from("east")];
        let (first, second) = two_mut(&mut data, 1, 0).unwrap();
        first.push('!');
        second.push('?');
        assert_eq!(data, ["west?", "east!"]);
    }

    #[test]
    fn rejects_equal_and_invalid_indices() {
        assert!(two_mut(&mut [9, 8], 1, 1).is_none());
        assert!(two_mut(&mut [9, 8], 0, usize::MAX).is_none());
        assert!(two_mut(&mut [9, 8], 2, 0).is_none());
        assert!(two_mut::<u8>(&mut [], 0, 1).is_none());
    }
    ''')


add('manifest-scope', 4, 'Inspect a temporary manifest',
    'Decode owned records from lines of the form station:count, trimming both fields. A station must be nonempty and count must parse as u16. Return the one-based line number on malformed input. An empty input contains zero records. After every line validates, invoke the visitor once with a temporary slice and return its result. The visitor can return a caller-owned reference captured independently of the records.',
    "inspect_manifest<R, F>(input: &str, visit: F) -> Result<R, ParseError> where F: for<'scope> FnOnce(&'scope [Record]) -> R",
    'boss', r'''
    pub struct Record {
        pub station: String,
        pub count: u16,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub struct ParseError {
        pub line: usize,
    }

    pub fn inspect_manifest<R, F>(input: &str, visit: F) -> Result<R, ParseError>
    where
        F: for<'scope> FnOnce(&'scope [Record]) -> R,
    {
        // TASK: decode owned records, then call the scoped visitor
        let mut records = Vec::new();
        for (index, line) in input.lines().enumerate() {
            let error = || ParseError { line: index + 1 };
            let (station, count) = line.split_once(':').ok_or_else(error)?;
            let station = station.trim();
            if station.is_empty() {
                return Err(error());
            }
            let count = count.trim().parse::<u16>().map_err(|_| error())?;
            records.push(Record { station: station.to_owned(), count });
        }
        Ok(visit(&records))
        // END TASK
    }
    ''', r'''
    #[test]
    fn returns_owned_summary() {
        let report = inspect_manifest(" east : 4\nwest:7\n", |rows| {
            let mut names = rows.iter().map(|row| row.station.clone()).collect::<Vec<_>>();
            names.sort();
            let total = rows.iter().map(|row| u32::from(row.count)).sum::<u32>();
            (names, total)
        }).unwrap();
        assert_eq!(report, (vec!["east".to_owned(), "west".to_owned()], 11));
    }

    #[test]
    fn returns_a_reference_captured_from_the_caller() {
        let configuration = String::from("night shift");
        let captured = configuration.as_str();
        let result = inspect_manifest("east:1", |rows| {
            assert_eq!(rows[0].station, "east");
            captured
        }).unwrap();
        assert_eq!(result.as_ptr(), captured.as_ptr());
        assert_eq!(result, "night shift");
    }

    #[test]
    fn validates_entire_input_before_visiting() {
        for text in ["ok:1\nbad", "ok:1\n :2", "ok:1\nbad:65536"] {
            let result = inspect_manifest(text, |_| -> () { panic!("visitor ran") });
            assert_eq!(result, Err(ParseError { line: 2 }));
        }
        assert_eq!(inspect_manifest("", |rows| rows.len()), Ok(0));
    }
    ''')


add('dense-atlas', 8, 'Retire stale atlas handles',
    'Complete a dense arena with a separate slot table. A handle identifies a slot generation, and the slot points to its current position in dense storage. Repair that mapping when swap removal moves a surviving record. Advance a deleted slot’s u8 generation before making it reusable. Prefer a reusable slot over a new slot and retire exhausted slots. Use each handle with its originating arena.',
    'Arena<T>::insert(&mut self, value: T) -> Handle | get(&self, handle: Handle) -> Option<&T> | remove(&mut self, handle: Handle) -> Option<T>',
    'boss', r'''
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Handle {
        slot: usize,
        generation: u8,
    }

    impl Handle {
        pub fn slot(self) -> usize {
            self.slot
        }
    }

    struct Entry<T> {
        slot: usize,
        value: T,
    }

    struct Slot {
        generation: u8,
        dense_index: Option<usize>,
    }

    pub struct Arena<T> {
        dense: Vec<Entry<T>>,
        slots: Vec<Slot>,
        free: Vec<usize>,
    }

    impl<T> Arena<T> {
        pub fn new() -> Self {
            Self { dense: Vec::new(), slots: Vec::new(), free: Vec::new() }
        }

        pub fn insert(&mut self, value: T) -> Handle {
            // TASK: allocate or reuse a slot and append the dense entry
            let slot = match self.free.pop() {
                Some(slot) => slot,
                None => {
                    let slot = self.slots.len();
                    self.slots.push(Slot { generation: 0, dense_index: None });
                    slot
                }
            };
            let index = self.dense.len();
            self.dense.push(Entry { slot, value });
            self.slots[slot].dense_index = Some(index);
            Handle { slot, generation: self.slots[slot].generation }
            // END TASK
        }

        fn dense_index(&self, handle: Handle) -> Option<usize> {
            // TASK: validate slot presence and generation before lookup
            let slot = self.slots.get(handle.slot)?;
            if slot.generation == handle.generation {
                slot.dense_index
            } else {
                None
            }
            // END TASK
        }

        pub fn get(&self, handle: Handle) -> Option<&T> {
            let index = self.dense_index(handle)?;
            Some(&self.dense[index].value)
        }

        pub fn remove(&mut self, handle: Handle) -> Option<T> {
            // TASK: remove densely, repair the moved slot, and retire or advance
            let index = self.dense_index(handle)?;
            let removed = self.dense.swap_remove(index);
            if let Some(moved) = self.dense.get(index) {
                self.slots[moved.slot].dense_index = Some(index);
            }
            let slot = &mut self.slots[removed.slot];
            slot.dense_index = None;
            if let Some(next) = slot.generation.checked_add(1) {
                slot.generation = next;
                self.free.push(removed.slot);
            }
            Some(removed.value)
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn preserves_handle_of_the_moved_survivor() {
        let mut arena = Arena::new();
        let first = arena.insert(String::from("first"));
        let middle = arena.insert(String::from("middle"));
        let last = arena.insert(String::from("last"));
        assert_eq!(arena.remove(first).as_deref(), Some("first"));
        assert_eq!(arena.get(last).map(String::as_str), Some("last"));
        assert_eq!(arena.remove(last).as_deref(), Some("last"));
        assert_eq!(arena.remove(middle).as_deref(), Some("middle"));
    }

    #[test]
    fn rejects_stale_handle_after_reuse() {
        let mut arena = Arena::new();
        let old = arena.insert(1);
        assert_eq!(arena.remove(old), Some(1));
        let new = arena.insert(2);
        assert_eq!(new.slot(), old.slot());
        assert_ne!(old, new);
        assert_eq!(arena.get(old), None);
        assert_eq!(arena.remove(old), None);
        assert_eq!(arena.get(new), Some(&2));
    }

    #[test]
    fn retires_slot_instead_of_wrapping_generation() {
        let mut arena = Arena::new();
        let original = arena.insert(0_u16);
        assert_eq!(arena.remove(original), Some(0));
        for value in 1..=u16::from(u8::MAX) {
            let current = arena.insert(value);
            assert_eq!(current.slot(), original.slot());
            assert_eq!(arena.get(original), None);
            assert_eq!(arena.remove(current), Some(value));
        }
        let replacement = arena.insert(256);
        assert_ne!(replacement.slot(), original.slot());
        assert_eq!(arena.get(original), None);
    }
    ''')


add('borrowed-router', 10, 'Route across borrowed trait objects',
    'Route a payload through mutable trait-object references. Try each sink in input order. A Busy result advances to the next sink, while Invalid stops routing and reports that index. Success returns the accepting index. Empty or wholly busy input returns NoAvailableSink. The caller keeps ownership of every sink and the payload.',
    'route(sinks: &mut [&mut dyn Sink], payload: &[u8]) -> Result<usize, RouteError>',
    'require heap allocation', r'''
    #[derive(Debug, PartialEq, Eq)]
    pub enum SinkError {
        Busy,
        Invalid,
    }

    pub trait Sink {
        fn send(&mut self, payload: &[u8]) -> Result<(), SinkError>;
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum RouteError {
        Invalid { index: usize },
        NoAvailableSink,
    }

    pub fn route(sinks: &mut [&mut dyn Sink], payload: &[u8]) -> Result<usize, RouteError> {
        // TASK: try the borrowed sinks in order and stop at a terminal outcome
        for (index, sink) in sinks.iter_mut().enumerate() {
            match sink.send(payload) {
                Ok(()) => return Ok(index),
                Err(SinkError::Busy) => {}
                Err(SinkError::Invalid) => return Err(RouteError::Invalid { index }),
            }
        }
        Err(RouteError::NoAvailableSink)
        // END TASK
    }
    ''', r'''
    struct Busy(usize);
    impl Sink for Busy {
        fn send(&mut self, _: &[u8]) -> Result<(), SinkError> {
            self.0 += 1;
            Err(SinkError::Busy)
        }
    }

    struct Accept(Vec<u8>);
    impl Sink for Accept {
        fn send(&mut self, payload: &[u8]) -> Result<(), SinkError> {
            self.0.extend_from_slice(payload);
            Ok(())
        }
    }

    struct Invalid;
    impl Sink for Invalid {
        fn send(&mut self, _: &[u8]) -> Result<(), SinkError> {
            Err(SinkError::Invalid)
        }
    }

    #[test]
    fn tries_busy_sink_then_stops_at_acceptance() {
        let mut busy = Busy(0);
        let mut accept = Accept(Vec::new());
        let mut later = Accept(Vec::new());
        let mut sinks: [&mut dyn Sink; 3] = [&mut busy, &mut accept, &mut later];
        assert_eq!(route(&mut sinks, &[9, 7]), Ok(1));
        assert_eq!(busy.0, 1);
        assert_eq!(accept.0, [9, 7]);
        assert!(later.0.is_empty());
    }

    #[test]
    fn stops_on_permanent_rejection() {
        let mut busy = Busy(0);
        let mut invalid = Invalid;
        let mut later = Accept(Vec::new());
        let mut sinks: [&mut dyn Sink; 3] = [&mut busy, &mut invalid, &mut later];
        assert_eq!(route(&mut sinks, &[9]), Err(RouteError::Invalid { index: 1 }));
        assert_eq!(busy.0, 1);
        assert!(later.0.is_empty());
    }

    #[test]
    fn reports_no_available_sink() {
        assert_eq!(route(&mut [], b"x"), Err(RouteError::NoAvailableSink));
        let mut a = Busy(0);
        let mut b = Busy(0);
        assert_eq!(route(&mut [&mut a, &mut b], b"x"), Err(RouteError::NoAvailableSink));
        assert_eq!((a.0, b.0), (1, 1));
    }
    ''')


add('lending-windows', 13, 'Lend overlapping mutable windows',
    'Implement a lending iterator over windows of a mutable slice. Advance the start by one after each successful window. Width zero and widths larger than the remaining region produce no window. Each window borrows the iterator for that call, so the next window can overlap once the caller finishes using the previous one.',
    "LendingIterator::next(&mut self) -> Option<Self::Item<'_>>",
    'two overlapping mutable windows', r'''
    pub trait LendingIterator {
        type Item<'a> where Self: 'a;

        fn next(&mut self) -> Option<Self::Item<'_>>;
    }

    pub struct WindowsMut<'data, T> {
        slice: &'data mut [T],
        width: usize,
        next: usize,
    }

    impl<'data, T> WindowsMut<'data, T> {
        pub fn new(slice: &'data mut [T], width: usize) -> Self {
            Self { slice, width, next: 0 }
        }
    }

    impl<T> LendingIterator for WindowsMut<'_, T> {
        type Item<'a> = &'a mut [T] where Self: 'a;

        fn next(&mut self) -> Option<Self::Item<'_>> {
            // TASK: lend a window for this borrow of the iterator
            if self.width == 0 {
                return None;
            }
            let start = self.next;
            let end = start.checked_add(self.width)?;
            let window = self.slice.get_mut(start..end)?;
            self.next += 1;
            Some(window)
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn later_windows_observe_prior_mutation() {
        let mut data = [0, 1, 2, 3];
        let mut windows = WindowsMut::new(&mut data, 2);
        windows.next().unwrap()[1] = 7;
        let second = windows.next().unwrap();
        assert_eq!(second, &[7, 2]);
        second[1] = 8;
        assert_eq!(windows.next().unwrap(), &[8, 3]);
        assert!(windows.next().is_none());
        assert!(windows.next().is_none());
        assert_eq!(data, [0, 7, 8, 3]);
    }

    #[test]
    fn handles_one_full_width_window_of_owned_strings() {
        let mut data = [String::from("a"), String::from("b")];
        let mut windows = WindowsMut::new(&mut data, 2);
        windows.next().unwrap().swap(0, 1);
        assert!(windows.next().is_none());
        assert_eq!(data, ["b", "a"]);
    }

    #[test]
    fn handles_empty_and_impossible_widths() {
        assert!(WindowsMut::<u8>::new(&mut [], 1).next().is_none());
        assert!(WindowsMut::new(&mut [5], 0).next().is_none());
        assert!(WindowsMut::new(&mut [5], usize::MAX).next().is_none());
    }
    ''')


add('dispatch-ticket', 15, 'Return approval only before handoff',
    'Validate a draft by checking its nonzero destination before its payload length. A payload may be as large as the limit. Failed validation returns the draft intact. Dispatch consumes an approved ticket. Capacity rejection before handoff returns that approval intact. A lost acknowledgment after handoff carries only the stable operation ID as uncertain evidence, and confirmation carries the ID as a receipt.',
    'Ticket<Draft>::approve(self, limit: usize) -> Result<Ticket<Approved>, (ValidationError, Self)> | Ticket<Approved>::dispatch(self, outcome: Handoff) -> DispatchResult',
    'boss', r'''
    pub struct Draft;
    pub struct Approved;

    pub struct Ticket<S> {
        id: u64,
        destination: u16,
        bytes: Vec<u8>,
        _state: S,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum ValidationError {
        InvalidDestination,
        PayloadTooLarge,
    }

    pub enum Handoff {
        CapacityRejected,
        AcknowledgmentLost,
        Acknowledged,
    }

    pub enum DispatchResult {
        Rejected(Ticket<Approved>),
        Uncertain { operation_id: u64 },
        Confirmed { operation_id: u64 },
    }

    impl<S> Ticket<S> {
        pub fn bytes(&self) -> &[u8] {
            &self.bytes
        }
    }

    impl Ticket<Draft> {
        pub fn new(id: u64, destination: u16, bytes: Vec<u8>) -> Self {
            Self { id, destination, bytes, _state: Draft }
        }

        pub fn approve(self, limit: usize) -> Result<Ticket<Approved>, (ValidationError, Self)> {
            // TASK: preserve the draft on rejection and consume it on approval
            if self.destination == 0 {
                return Err((ValidationError::InvalidDestination, self));
            }
            if self.bytes.len() > limit {
                return Err((ValidationError::PayloadTooLarge, self));
            }
            Ok(Ticket {
                id: self.id,
                destination: self.destination,
                bytes: self.bytes,
                _state: Approved,
            })
            // END TASK
        }
    }

    impl Ticket<Approved> {
        pub fn dispatch(self, outcome: Handoff) -> DispatchResult {
            // TASK: expose the approval again only when handoff did not begin
            match outcome {
                Handoff::CapacityRejected => DispatchResult::Rejected(self),
                Handoff::AcknowledgmentLost => DispatchResult::Uncertain {
                    operation_id: self.id,
                },
                Handoff::Acknowledged => DispatchResult::Confirmed {
                    operation_id: self.id,
                },
            }
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn capacity_rejection_preserves_owned_approval() {
        let draft = Ticket::new(32, 4, vec![8, 9]);
        let pointer = draft.bytes().as_ptr();
        let approved = draft.approve(2).ok().unwrap();
        let DispatchResult::Rejected(returned) = approved.dispatch(Handoff::CapacityRejected)
        else { panic!("expected reusable approval") };
        assert_eq!(returned.bytes(), &[8, 9]);
        assert_eq!(returned.bytes().as_ptr(), pointer);
        assert!(matches!(returned.dispatch(Handoff::AcknowledgmentLost),
            DispatchResult::Uncertain { operation_id: 32 }));
    }

    #[test]
    fn failed_validation_keeps_the_draft_and_checks_destination_first() {
        let draft = Ticket::new(1, 0, vec![1, 2]);
        let pointer = draft.bytes().as_ptr();
        let (error, returned) = draft.approve(1).err().unwrap();
        assert_eq!(error, ValidationError::InvalidDestination);
        assert_eq!(returned.bytes().as_ptr(), pointer);
        let (error, returned) = Ticket::new(2, 9, vec![1, 2]).approve(1).err().unwrap();
        assert_eq!(error, ValidationError::PayloadTooLarge);
        assert_eq!(returned.bytes(), &[1, 2]);
    }

    #[test]
    fn confirmation_carries_the_same_operation_id() {
        let approved = Ticket::new(89, 3, vec![]).approve(0).ok().unwrap();
        assert!(matches!(approved.dispatch(Handoff::Acknowledged),
            DispatchResult::Confirmed { operation_id: 89 }));
    }
    ''')


add('bounded-admission', 20, 'Keep the pool invariant under one lock',
    'Implement capacity admission, close, and permit destruction. A snapshot must report occupied plus free equal to capacity. Admission succeeds only while open and below capacity. Closing an empty pool closes it immediately. Otherwise it drains and rejects new work until the final owned permit drops. Dropping a permit releases one slot, including during a drain.',
    'Admission::try_admit(&self) -> Option<Permit> | close(&self) -> Phase | Permit::drop(&mut self)',
    'Two counters represent free slots and occupied slots', r'''
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Phase {
        Open,
        Draining,
        Closed,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub struct Snapshot {
        pub phase: Phase,
        pub occupied: usize,
        pub free: usize,
    }

    struct State {
        phase: Phase,
        active: usize,
        limit: usize,
    }

    #[derive(Clone)]
    pub struct Admission {
        state: Arc<Mutex<State>>,
    }

    pub struct Permit {
        state: Arc<Mutex<State>>,
    }

    impl Admission {
        pub fn new(limit: usize) -> Self {
            let state = State { phase: Phase::Open, active: 0, limit };
            Self { state: Arc::new(Mutex::new(state)) }
        }

        pub fn snapshot(&self) -> Snapshot {
            let state = self.state.lock().unwrap();
            Snapshot {
                phase: state.phase,
                occupied: state.active,
                free: state.limit - state.active,
            }
        }

        pub fn try_admit(&self) -> Option<Permit> {
            // TASK: check phase and register a permit in one critical section
            let mut state = self.state.lock().unwrap();
            if state.phase != Phase::Open || state.active >= state.limit {
                return None;
            }
            state.active += 1;
            Some(Permit { state: Arc::clone(&self.state) })
            // END TASK
        }

        pub fn close(&self) -> Phase {
            // TASK: stop admission and select draining or closed
            let mut state = self.state.lock().unwrap();
            if state.phase == Phase::Open {
                state.phase = if state.active == 0 { Phase::Closed } else { Phase::Draining };
            }
            state.phase
            // END TASK
        }
    }

    impl Drop for Permit {
        fn drop(&mut self) {
            // TASK: release capacity and complete the final drain transition
            let mut state = self.state.lock().unwrap();
            state.active -= 1;
            if state.phase == Phase::Draining && state.active == 0 {
                state.phase = Phase::Closed;
            }
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn releasing_a_permit_reopens_capacity() {
        let gate = Admission::new(1);
        let permit = gate.try_admit().unwrap();
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Open, occupied: 1, free: 0 });
        assert!(gate.try_admit().is_none());
        drop(permit);
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Open, occupied: 0, free: 1 });
        assert!(gate.try_admit().is_some());
    }

    #[test]
    fn close_rejects_new_work_until_every_existing_permit_drops() {
        let gate = Admission::new(3);
        let a = gate.try_admit().unwrap();
        let b = gate.try_admit().unwrap();
        assert_eq!(gate.close(), Phase::Draining);
        assert!(gate.try_admit().is_none());
        drop(a);
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Draining, occupied: 1, free: 2 });
        drop(b);
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Closed, occupied: 0, free: 3 });
        assert_eq!(gate.close(), Phase::Closed);
        assert!(gate.try_admit().is_none());
    }

    #[test]
    fn zero_capacity_closes_immediately() {
        let gate = Admission::new(0);
        assert!(gate.try_admit().is_none());
        assert_eq!(gate.close(), Phase::Closed);
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Closed, occupied: 0, free: 0 });
    }

    #[test]
    fn simultaneous_callers_respect_capacity() {
        let gate = Admission::new(2);
        let workers: Vec<_> = (0..4).map(|_| {
            let gate = gate.clone();
            std::thread::spawn(move || gate.try_admit())
        }).collect();
        // A successful worker leaves its permit owned by its result until collection.
        let permits: Vec<_> = workers.into_iter()
            .filter_map(|worker| worker.join().unwrap()).collect();
        assert_eq!(permits.len(), 2);
        assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Open, occupied: 2, free: 0 });
        drop(permits);
        assert_eq!(gate.snapshot().free, 2);
    }
    ''')


add('budgeted-future', 23, 'Give each poll a work budget',
    'Implement an owned future that computes a wrapping u64 sum of its bytes. Each poll processes the next 64 bytes or all remaining bytes if fewer. Return Ready with the sum as soon as the final byte is consumed. If work remains, request another poll using the current waker and return Pending. Repeated polls after completion return the stored answer without requesting another poll.',
    "BudgetSum::poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<u64>",
    'boss', r'''
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context, Poll};

    pub struct BudgetSum {
        bytes: Vec<u8>,
        next: usize,
        sum: u64,
    }

    impl BudgetSum {
        pub fn new(bytes: Vec<u8>) -> Self {
            Self { bytes, next: 0, sum: 0 }
        }

        pub fn bytes_processed(&self) -> usize {
            self.next
        }
    }

    impl Future for BudgetSum {
        type Output = u64;

        fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<u64> {
            // TASK: process one bounded chunk and schedule only unfinished work
            let this = self.get_mut();
            let end = this.next + (this.bytes.len() - this.next).min(64);
            for &byte in &this.bytes[this.next..end] {
                this.sum = this.sum.wrapping_add(u64::from(byte));
            }
            this.next = end;
            if end == this.bytes.len() {
                Poll::Ready(this.sum)
            } else {
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            // END TASK
        }
    }
    ''', r'''
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    use std::task::{Context, Poll, Wake, Waker};

    #[derive(Default)]
    struct Counter(AtomicUsize);

    impl Wake for Counter {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn limits_work_and_notifies_the_current_waker() {
        let a = Arc::new(Counter::default());
        let b = Arc::new(Counter::default());
        let waker_a = Waker::from(Arc::clone(&a));
        let waker_b = Waker::from(Arc::clone(&b));
        let mut sum = BudgetSum::new(vec![2; 130]);
        assert_eq!(Pin::new(&mut sum).poll(&mut Context::from_waker(&waker_a)), Poll::Pending);
        assert_eq!(sum.bytes_processed(), 64);
        assert_eq!(a.0.load(Ordering::Relaxed), 1);
        assert_eq!(Pin::new(&mut sum).poll(&mut Context::from_waker(&waker_b)), Poll::Pending);
        assert_eq!(sum.bytes_processed(), 128);
        assert_eq!(a.0.load(Ordering::Relaxed), 1);
        assert_eq!(b.0.load(Ordering::Relaxed), 1);
        let mut cx = Context::from_waker(&waker_b);
        assert_eq!(Pin::new(&mut sum).poll(&mut cx), Poll::Ready(260));
        assert_eq!(Pin::new(&mut sum).poll(&mut cx), Poll::Ready(260));
        assert_eq!(sum.bytes_processed(), 130);
        assert_eq!(b.0.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn empty_input_is_ready_without_waking() {
        let wake_count = Arc::new(Counter::default());
        let waker = Waker::from(Arc::clone(&wake_count));
        let mut sum = BudgetSum::new(vec![]);
        assert_eq!(Pin::new(&mut sum).poll(&mut Context::from_waker(&waker)), Poll::Ready(0));
        assert_eq!(sum.bytes_processed(), 0);
        assert_eq!(wake_count.0.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn exact_budget_completes_in_one_poll() {
        let mut sum = BudgetSum::new(vec![255; 64]);
        let mut cx = Context::from_waker(Waker::noop());
        assert_eq!(Pin::new(&mut sum).poll(&mut cx), Poll::Ready(16_320));
        assert_eq!(sum.bytes_processed(), 64);
    }
    ''')


add('resumable-export', 26, 'Resume a cancelled frame write',
    'Keep an unfinished frame and its offset in Exporter. A flush poll asks the sink to accept one suffix. Pending keeps the offset unchanged. A valid positive count advances it, and a short write schedules another poll. Zero with bytes remaining returns NoProgress. A count beyond the offered slice returns InvalidCount. Both errors preserve the local offset. While a frame remains pending, begin returns any new frame unchanged. An empty frame completes immediately.',
    'Exporter::begin(&mut self, bytes: Vec<u8>) -> Result<(), Vec<u8>> | async flush<S: Sink>(&mut self, sink: &mut S) -> Result<(), FlushError>',
    'boss', r'''
    use std::future::poll_fn;
    use std::task::{Context, Poll};

    pub trait Sink {
        // Pending accepts zero bytes and arranges a readiness wakeup.
        fn poll_append(&mut self, cx: &mut Context<'_>, bytes: &[u8]) -> Poll<usize>;
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum FlushError {
        NoProgress,
        InvalidCount,
    }

    struct FrameState {
        bytes: Vec<u8>,
        offset: usize,
    }

    pub struct Exporter {
        pending: Option<FrameState>,
    }

    impl Exporter {
        pub fn new() -> Self {
            Self { pending: None }
        }

        pub fn bytes_sent(&self) -> Option<usize> {
            self.pending.as_ref().map(|frame| frame.offset)
        }

        pub fn begin(&mut self, bytes: Vec<u8>) -> Result<(), Vec<u8>> {
            // TASK: preserve any frame that already owns the write boundary
            if self.pending.is_some() {
                return Err(bytes);
            }
            self.pending = Some(FrameState { bytes, offset: 0 });
            Ok(())
            // END TASK
        }

        pub async fn flush<S: Sink>(&mut self, sink: &mut S) -> Result<(), FlushError> {
            poll_fn(|cx| self.poll_flush(sink, cx)).await
        }

        fn poll_flush<S: Sink>(&mut self, sink: &mut S, cx: &mut Context<'_>)
            -> Poll<Result<(), FlushError>>
        {
            // TASK: handle one write and record progress before yielding
            let Some(frame) = self.pending.as_mut() else {
                return Poll::Ready(Ok(()));
            };
            let remaining = &frame.bytes[frame.offset..];
            if remaining.is_empty() {
                self.pending = None;
                return Poll::Ready(Ok(()));
            }
            match sink.poll_append(cx, remaining) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(0) => Poll::Ready(Err(FlushError::NoProgress)),
                Poll::Ready(count) if count > remaining.len() => {
                    Poll::Ready(Err(FlushError::InvalidCount))
                }
                Poll::Ready(count) => {
                    frame.offset += count;
                    if frame.offset == frame.bytes.len() {
                        self.pending = None;
                        Poll::Ready(Ok(()))
                    } else {
                        cx.waker().wake_by_ref();
                        Poll::Pending
                    }
                }
            }
            // END TASK
        }
    }
    ''', r'''
    use std::collections::VecDeque;
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    enum Step {
        Accept(usize),
        Pending,
    }

    struct ScriptSink {
        steps: VecDeque<Step>,
        accepted: Vec<u8>,
    }

    impl ScriptSink {
        fn new(steps: impl IntoIterator<Item = Step>) -> Self {
            Self { steps: steps.into_iter().collect(), accepted: Vec::new() }
        }
    }

    impl Sink for ScriptSink {
        fn poll_append(&mut self, cx: &mut Context<'_>, bytes: &[u8]) -> Poll<usize> {
            match self.steps.pop_front().expect("unexpected sink poll") {
                Step::Pending => {
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
                Step::Accept(count) => {
                    if let Some(prefix) = bytes.get(..count) {
                        self.accepted.extend_from_slice(prefix);
                    }
                    Poll::Ready(count)
                }
            }
        }
    }

    #[test]
    fn cancellation_preserves_progress_and_rejects_interleaving() {
        let mut export = Exporter::new();
        export.begin(b"ABCDE".to_vec()).unwrap();
        let mut sink = ScriptSink::new([Step::Accept(2), Step::Pending, Step::Accept(3)]);
        let mut cx = Context::from_waker(Waker::noop());
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut cx), Poll::Pending);
        drop(attempt);
        assert_eq!(export.bytes_sent(), Some(2));
        assert_eq!(sink.accepted, b"AB");
        let extra = vec![0xAA, 0xBB];
        let pointer = extra.as_ptr();
        let returned = export.begin(extra).unwrap_err();
        assert_eq!(returned.as_ptr(), pointer);
        assert_eq!(returned, [0xAA, 0xBB]);
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut cx), Poll::Pending);
        drop(attempt);
        assert_eq!(export.bytes_sent(), Some(2));
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut cx), Poll::Ready(Ok(())));
        drop(attempt);
        assert_eq!(export.bytes_sent(), None);
        assert_eq!(sink.accepted, b"ABCDE");
    }

    #[test]
    fn invalid_counts_leave_local_progress_unchanged() {
        let mut export = Exporter::new();
        export.begin(b"xy".to_vec()).unwrap();
        let mut sink = ScriptSink::new([Step::Accept(0), Step::Accept(3)]);
        let mut cx = Context::from_waker(Waker::noop());
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut cx), Poll::Ready(Err(FlushError::NoProgress)));
        drop(attempt);
        assert_eq!(export.bytes_sent(), Some(0));
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut cx), Poll::Ready(Err(FlushError::InvalidCount)));
        drop(attempt);
        assert_eq!(export.bytes_sent(), Some(0));
        assert!(sink.accepted.is_empty());
    }

    #[test]
    fn empty_frame_completes_without_a_sink_call() {
        let mut export = Exporter::new();
        export.begin(vec![]).unwrap();
        let mut sink = ScriptSink::new([]);
        let mut attempt = Box::pin(export.flush(&mut sink));
        assert_eq!(attempt.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Ready(Ok(())));
        drop(attempt);
        assert_eq!(export.bytes_sent(), None);
    }
    ''')


add('mimic-packet', 29, 'Decode the wire format explicitly',
    'Implement a codec for the Mimic Packet. The header contains a one-byte tag of 1 or 2, a little-endian u32 sequence, and a little-endian u16 payload length. Decode one borrowed frame and report its consumed byte count, leaving subsequent bytes available. An available invalid tag is an error immediately. Missing header or payload bytes are incomplete. Encode the same layout, rejecting an invalid tag before checking length.',
    "decode(input: &[u8]) -> Decode<'_> | encode(tag: u8, sequence: u32, payload: &[u8]) -> Result<Vec<u8>, EncodeError>",
    'boss', r'''
    const HEADER_LEN: usize = 7;

    #[derive(Debug, PartialEq, Eq)]
    pub enum Decode<'a> {
        Incomplete,
        InvalidTag(u8),
        InvalidLength,
        Frame { tag: u8, sequence: u32, payload: &'a [u8], consumed: usize },
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum EncodeError {
        InvalidTag(u8),
        PayloadTooLarge,
    }

    pub fn decode(input: &[u8]) -> Decode<'_> {
        // TASK: validate the header and borrow precisely one complete payload
        let Some(&tag) = input.first() else { return Decode::Incomplete };
        if !matches!(tag, 1 | 2) {
            return Decode::InvalidTag(tag);
        }
        let Some(header) = input.get(..HEADER_LEN) else { return Decode::Incomplete };
        let sequence = u32::from_le_bytes([header[1], header[2], header[3], header[4]]);
        let length = usize::from(u16::from_le_bytes([header[5], header[6]]));
        let Some(consumed) = HEADER_LEN.checked_add(length) else { return Decode::InvalidLength };
        let Some(payload) = input.get(HEADER_LEN..consumed) else { return Decode::Incomplete };
        Decode::Frame { tag, sequence, payload, consumed }
        // END TASK
    }

    pub fn encode(tag: u8, sequence: u32, payload: &[u8]) -> Result<Vec<u8>, EncodeError> {
        // TASK: emit explicit little-endian fields and the original payload bytes
        if !matches!(tag, 1 | 2) {
            return Err(EncodeError::InvalidTag(tag));
        }
        let length = u16::try_from(payload.len()).map_err(|_| EncodeError::PayloadTooLarge)?;
        let capacity = HEADER_LEN.checked_add(payload.len()).ok_or(EncodeError::PayloadTooLarge)?;
        let mut bytes = Vec::with_capacity(capacity);
        bytes.push(tag);
        bytes.extend_from_slice(&sequence.to_le_bytes());
        bytes.extend_from_slice(&length.to_le_bytes());
        bytes.extend_from_slice(payload);
        Ok(bytes)
        // END TASK
    }
    ''', r'''
    #[test]
    fn decodes_borrowed_payload_and_leaves_next_frame() {
        let bytes = [2, 0x78, 0x56, 0x34, 0x12, 3, 0, 9, 8, 7, 1, 4, 0, 0, 0, 0, 0];
        let Decode::Frame { tag, sequence, payload, consumed } = decode(&bytes)
        else { panic!("first frame should be complete") };
        assert_eq!((tag, sequence, consumed), (2, 0x1234_5678, 10));
        assert_eq!(payload, &[9, 8, 7]);
        assert_eq!(payload.as_ptr(), bytes[7..].as_ptr());
        assert_eq!(decode(&bytes[consumed..]), Decode::Frame {
            tag: 1, sequence: 4, payload: &[], consumed: 7,
        });
    }

    #[test]
    fn every_valid_prefix_is_incomplete_until_payload_arrives() {
        let bytes = [1, 0, 0, 0, 0, 2, 0, 8, 9];
        for length in 0..bytes.len() {
            assert_eq!(decode(&bytes[..length]), Decode::Incomplete);
        }
        assert_eq!(decode(&[99]), Decode::InvalidTag(99));
    }

    #[test]
    fn encoder_matches_an_independent_wire_fixture() {
        assert_eq!(encode(2, 0xA1B2_C3D4, &[3, 5, 7]).unwrap(),
            [2, 0xD4, 0xC3, 0xB2, 0xA1, 3, 0, 3, 5, 7]);
        assert_eq!(encode(1, 1, &[]).unwrap(), [1, 1, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn rejects_unknown_tags_and_oversized_payloads() {
        let payload = vec![0; 65_536];
        assert_eq!(encode(1, 0, &payload), Err(EncodeError::PayloadTooLarge));
        assert_eq!(encode(3, 0, &payload), Err(EncodeError::InvalidTag(3)));
    }
    ''')


add('scattered-assembly', 32, 'Track initialized slots independently',
    'Build the safe model of the scattered assembly. Insert move-only values at arbitrary indices. Duplicate and out-of-range insertions return the incoming value with a distinct error. A complete finish transfers an array in index order. An incomplete finish returns the original assembly, including all stored values. The empty assembly finishes immediately.',
    'Assembly<T, N>::insert(&mut self, index: usize, value: T) -> Result<(), InsertError<T>> | finish(self) -> Result<[T; N], Self>',
    'boss', r'''
    pub enum InsertError<T> {
        OutOfBounds(T),
        Occupied(T),
    }

    pub struct Assembly<T, const N: usize> {
        slots: [Option<T>; N],
        remaining: usize,
    }

    impl<T, const N: usize> Assembly<T, N> {
        pub fn new() -> Self {
            Self { slots: std::array::from_fn(|_| None), remaining: N }
        }

        pub fn remaining(&self) -> usize {
            self.remaining
        }

        pub fn insert(&mut self, index: usize, value: T) -> Result<(), InsertError<T>> {
            // TASK: install a value only into an empty valid slot
            let Some(slot) = self.slots.get_mut(index) else {
                return Err(InsertError::OutOfBounds(value));
            };
            if slot.is_some() {
                return Err(InsertError::Occupied(value));
            }
            *slot = Some(value);
            self.remaining -= 1;
            Ok(())
            // END TASK
        }

        pub fn finish(self) -> Result<[T; N], Self> {
            // TASK: transfer a complete array or return the unfinished owner
            if self.remaining != 0 {
                return Err(self);
            }
            Ok(self.slots.map(|slot| slot.expect("every slot is initialized")))
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn out_of_order_insertion_and_retry_preserve_values() {
        let mut assembly = Assembly::<String, 3>::new();
        assert!(assembly.insert(2, "last".to_owned()).is_ok());
        assert_eq!(assembly.remaining(), 2);
        let mut assembly = assembly.finish().err().unwrap();
        assert!(assembly.insert(0, "first".to_owned()).is_ok());
        assert!(assembly.insert(1, "middle".to_owned()).is_ok());
        assert_eq!(assembly.remaining(), 0);
        assert_eq!(assembly.finish().ok().unwrap(), ["first", "middle", "last"]);
    }

    #[test]
    fn failed_insertion_returns_the_incoming_owner() {
        let mut assembly = Assembly::<String, 1>::new();
        assert!(assembly.insert(0, "kept".to_owned()).is_ok());
        let extra = "returned".to_owned();
        let pointer = extra.as_ptr();
        let Err(InsertError::Occupied(extra)) = assembly.insert(0, extra)
        else { panic!("expected occupied") };
        assert_eq!(extra.as_ptr(), pointer);
        let Err(InsertError::OutOfBounds(extra)) = assembly.insert(usize::MAX, extra)
        else { panic!("expected bounds failure") };
        assert_eq!(extra, "returned");
        assert_eq!(extra.as_ptr(), pointer);
        assert_eq!(assembly.finish().ok().unwrap(), ["kept"]);
    }

    #[test]
    fn drops_exactly_the_values_still_owned() {
        use std::{cell::RefCell, rc::Rc};
        struct Trace(u8, Rc<RefCell<Vec<u8>>>);
        impl Drop for Trace {
            fn drop(&mut self) {
                self.1.borrow_mut().push(self.0);
            }
        }
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut assembly = Assembly::<Trace, 3>::new();
        assert!(assembly.insert(2, Trace(7, Rc::clone(&log))).is_ok());
        assert!(assembly.insert(0, Trace(5, Rc::clone(&log))).is_ok());
        let assembly = assembly.finish().err().unwrap();
        assert!(log.borrow().is_empty());
        drop(assembly);
        let mut observed = log.borrow().clone();
        observed.sort();
        assert_eq!(observed, [5, 7]);
    }

    #[test]
    fn empty_assembly_is_complete() {
        let mut assembly = Assembly::<u8, 0>::new();
        assert!(matches!(assembly.insert(0, 42), Err(InsertError::OutOfBounds(42))));
        assert_eq!(assembly.finish().ok().unwrap(), []);
    }
    ''')


add('nested-savepoints', 38, 'Merge a proposal without publishing it',
    'Implement the overlay operations for local savepoints. Reads search from the newest layer to the base and stop at the first entry, including a deletion. Merge moves the newest changes into its immediate parent. Rollback drops that newest layer. Both return false at the root. Only a store commit with no open savepoint can publish, after checking its original snapshot and version.',
    'Transaction::get(&self, key: &str) -> Option<i64> | begin_savepoint(&mut self) | merge_savepoint(&mut self) -> bool | rollback_savepoint(&mut self) -> bool',
    'boss', r'''
    use std::collections::BTreeMap;
    use std::sync::Arc;

    type Records = BTreeMap<String, i64>;
    type Overlay = BTreeMap<String, Option<i64>>;

    #[derive(Debug, PartialEq, Eq)]
    pub enum CommitError {
        OpenSavepoint,
        Conflict,
        VersionExhausted,
    }

    pub struct Store {
        version: u64,
        data: Arc<Records>,
    }

    pub struct Transaction {
        base_version: u64,
        base: Arc<Records>,
        layers: Vec<Overlay>,
    }

    impl Store {
        pub fn new() -> Self {
            Self { version: 0, data: Arc::new(Records::new()) }
        }

        pub fn get(&self, key: &str) -> Option<i64> {
            self.data.get(key).copied()
        }

        pub fn begin(&self) -> Transaction {
            Transaction {
                base_version: self.version,
                base: Arc::clone(&self.data),
                layers: vec![Overlay::new()],
            }
        }

        pub fn commit(&mut self, tx: Transaction) -> Result<(), CommitError> {
            if tx.layers.len() != 1 {
                return Err(CommitError::OpenSavepoint);
            }
            if tx.base_version != self.version || !Arc::ptr_eq(&tx.base, &self.data) {
                return Err(CommitError::Conflict);
            }
            let next_version = self.version.checked_add(1).ok_or(CommitError::VersionExhausted)?;
            let mut next = self.data.as_ref().clone();
            for (key, value) in tx.layers.into_iter().next().expect("root layer exists") {
                match value {
                    Some(value) => { next.insert(key, value); }
                    None => { next.remove(&key); }
                }
            }
            self.data = Arc::new(next);
            self.version = next_version;
            Ok(())
        }
    }

    impl Transaction {
        fn current(&mut self) -> &mut Overlay {
            self.layers.last_mut().expect("root layer exists")
        }

        pub fn put(&mut self, key: &str, value: i64) {
            self.current().insert(key.to_owned(), Some(value));
        }

        pub fn delete(&mut self, key: &str) {
            self.current().insert(key.to_owned(), None);
        }

        pub fn get(&self, key: &str) -> Option<i64> {
            // TASK: search the overlays and stop at any staged entry
            for layer in self.layers.iter().rev() {
                if let Some(value) = layer.get(key) {
                    return *value;
                }
            }
            self.base.get(key).copied()
            // END TASK
        }

        pub fn begin_savepoint(&mut self) {
            // TASK: establish one empty proposal layer above the current layer
            self.layers.push(Overlay::new());
            // END TASK
        }

        pub fn merge_savepoint(&mut self) -> bool {
            // TASK: move the newest layer into its parent without touching the store
            if self.layers.len() == 1 {
                return false;
            }
            let child = self.layers.pop().expect("savepoint exists");
            self.current().extend(child);
            true
            // END TASK
        }

        pub fn rollback_savepoint(&mut self) -> bool {
            // TASK: discard only the newest savepoint layer
            if self.layers.len() == 1 {
                return false;
            }
            self.layers.pop();
            true
            // END TASK
        }
    }
    ''', r'''
    #[test]
    fn nested_merge_then_parent_rollback_restores_root_view() {
        let store = Store::new();
        let mut tx = store.begin();
        tx.put("power", 6);
        tx.begin_savepoint();
        tx.delete("power");
        assert_eq!(tx.get("power"), None);
        tx.begin_savepoint();
        tx.put("power", 7);
        tx.put("cooling", 12);
        assert!(tx.merge_savepoint());
        assert_eq!(tx.get("power"), Some(7));
        assert_eq!(tx.get("cooling"), Some(12));
        assert!(tx.rollback_savepoint());
        assert_eq!(tx.get("power"), Some(6));
        assert_eq!(tx.get("cooling"), None);
        assert!(!tx.merge_savepoint());
        assert!(!tx.rollback_savepoint());
    }

    #[test]
    fn child_merge_keeps_changes_private_until_outer_commit() {
        let mut store = Store::new();
        let mut initial = store.begin();
        initial.put("power", 9);
        store.commit(initial).unwrap();
        let mut tx = store.begin();
        tx.begin_savepoint();
        assert_eq!(tx.get("power"), Some(9));
        tx.delete("power");
        tx.put("reserve", 15);
        assert!(tx.merge_savepoint());
        assert_eq!(tx.get("power"), None);
        assert_eq!(store.get("power"), Some(9));
        assert_eq!(store.get("reserve"), None);
        store.commit(tx).unwrap();
        assert_eq!(store.get("power"), None);
        assert_eq!(store.get("reserve"), Some(15));
    }

    #[test]
    fn stale_and_foreign_transactions_cannot_publish() {
        let mut store = Store::new();
        let other = Store::new();
        let mut foreign = other.begin();
        foreign.put("intrusion", 2);
        assert_eq!(store.commit(foreign), Err(CommitError::Conflict));
        let mut stale = store.begin();
        stale.begin_savepoint();
        stale.put("power", 20);
        assert!(stale.merge_savepoint());
        let mut newer = store.begin();
        newer.put("power", 30);
        store.commit(newer).unwrap();
        assert_eq!(stale.get("power"), Some(20));
        assert_eq!(store.commit(stale), Err(CommitError::Conflict));
        assert_eq!(store.get("power"), Some(30));
        assert_eq!(store.get("intrusion"), None);
    }

    #[test]
    fn open_savepoint_blocks_publication() {
        let mut store = Store::new();
        let mut tx = store.begin();
        tx.put("power", 1);
        tx.begin_savepoint();
        tx.put("power", 2);
        assert_eq!(store.commit(tx), Err(CommitError::OpenSavepoint));
        assert_eq!(store.get("power"), None);
    }
    ''')


add('last-sequence', 40, 'Send the maximum sequence exactly once',
    'Complete send on an established in-memory connection. A payload at most 1,024 bytes may use the current sequence, including u32::MAX exactly once. After that the connection is exhausted. A rejected send returns the original payload and leaves sequence and transcript intact. Check oversized payloads before checking exhaustion. Closing consumes the established connection and appends one Close frame.',
    'Connection<Established>::send(&mut self, payload: Vec<u8>) -> Result<u32, (SendError, Vec<u8>)>',
    'sequence number may be used exactly once', r'''
    #[derive(Debug, PartialEq, Eq)]
    pub enum Frame {
        Data { sequence: u32, payload: Vec<u8> },
        Close,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum SendError {
        PayloadTooLarge,
        SequenceExhausted,
    }

    pub struct Established {
        next_sequence: Option<u32>,
    }

    pub struct Closed;

    pub struct Connection<S> {
        frames: Vec<Frame>,
        state: S,
    }

    impl<S> Connection<S> {
        pub fn frames(&self) -> &[Frame] {
            &self.frames
        }
    }

    impl Connection<Established> {
        pub fn at_sequence(sequence: u32) -> Self {
            Self { frames: Vec::new(), state: Established { next_sequence: Some(sequence) } }
        }

        pub fn send(&mut self, payload: Vec<u8>) -> Result<u32, (SendError, Vec<u8>)> {
            // TASK: emit the current sequence, then record its checked successor
            if payload.len() > 1024 {
                return Err((SendError::PayloadTooLarge, payload));
            }
            let Some(sequence) = self.state.next_sequence else {
                return Err((SendError::SequenceExhausted, payload));
            };
            self.frames.push(Frame::Data { sequence, payload });
            self.state.next_sequence = sequence.checked_add(1);
            Ok(sequence)
            // END TASK
        }

        pub fn close(mut self) -> Connection<Closed> {
            self.frames.push(Frame::Close);
            Connection { frames: self.frames, state: Closed }
        }
    }
    ''', r'''
    #[test]
    fn maximum_is_used_once_without_wrapping() {
        let mut connection = Connection::at_sequence(u32::MAX - 1);
        assert_eq!(connection.send(vec![1]), Ok(u32::MAX - 1));
        assert_eq!(connection.send(vec![2]), Ok(u32::MAX));
        assert_eq!(connection.send(vec![3]), Err((SendError::SequenceExhausted, vec![3])));
        assert_eq!(connection.send(vec![]), Err((SendError::SequenceExhausted, vec![])));
        assert_eq!(connection.close().frames(), &[
            Frame::Data { sequence: u32::MAX - 1, payload: vec![1] },
            Frame::Data { sequence: u32::MAX, payload: vec![2] },
            Frame::Close,
        ]);
    }

    #[test]
    fn oversized_payload_preserves_the_last_sequence_and_allocation() {
        let mut connection = Connection::at_sequence(u32::MAX);
        let payload = vec![5; 1025];
        let pointer = payload.as_ptr();
        let (error, mut returned) = connection.send(payload).unwrap_err();
        assert_eq!(error, SendError::PayloadTooLarge);
        assert_eq!(returned.as_ptr(), pointer);
        assert!(connection.frames().is_empty());
        returned.truncate(1024);
        assert_eq!(connection.send(returned), Ok(u32::MAX));
        let [Frame::Data { payload, .. }] = connection.frames()
        else { panic!("one frame should have been queued") };
        assert_eq!(payload.len(), 1024);
        assert_eq!(payload.as_ptr(), pointer);
    }

    #[test]
    fn payload_error_precedes_exhaustion() {
        let mut connection = Connection::at_sequence(u32::MAX);
        assert_eq!(connection.send(vec![]), Ok(u32::MAX));
        let (error, returned) = connection.send(vec![1; 1025]).unwrap_err();
        assert_eq!(error, SendError::PayloadTooLarge);
        assert_eq!(returned.len(), 1025);
        assert_eq!(connection.frames().len(), 1);
    }
    ''')


work = Path(__file__).resolve().parent
app = work.parent if (work.parent / 'server.mjs').is_file() else work / 'ferrum-web'
output = app / 'data' / 'exercises.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(exercises, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
