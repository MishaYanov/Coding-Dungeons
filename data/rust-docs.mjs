import reference from './rust-docs-reference.json' with { type: 'json' };

export const rustDocsVersion = reference.version;
export const rustDocsIndexUrl = reference.indexUrl;
export const rustDocsLicense = reference.license;

// Excerpts and declarations come from the pinned upstream archive. These notes
// describe the API without depending on the player's current page or exercise.
function note(summary, detail, aliases) {
  return { summary, detail, aliases };
}

const notes = {
  'Vec::retain': note(
    'Keep matching elements in the existing vector.',
    'The predicate receives a shared reference to each element in original order. Returning true keeps the element. Returning false removes it. The surviving elements keep their order, and the method returns ().',
    ['remove empty strings from a vector', 'filter a vector in place', 'keep only matching elements', 'delete items that match a condition'],
  ),
  'Vec::dedup': note(
    'Keep the first item in each run of consecutive equal elements.',
    'Deduplication compares neighbors in the current order. For example, [1, 2, 1] stays [1, 2, 1]. Sorting first can group all equal values together when changing the order is acceptable.',
    ['remove consecutive duplicates from a vector', 'collapse adjacent equal values', 'deduplicate sorted vector'],
  ),
  'Vec::len': note(
    'Count the initialized elements in a vector.',
    'The returned usize is the current element count. Capacity includes spare room for future elements and can be larger. A valid single-element index is always smaller than len().',
    ['how many elements in a vector', 'length of my vector', 'count items in vec'],
  ),
  'Vec::push': note(
    'Move one new element onto the end of a vector.',
    'The vector needs a mutable borrow. Its length grows by one. If its current capacity is exhausted, it may allocate a larger buffer and move the existing elements.',
    ['append an item to a vector', 'add an element to the end', 'grow a vector'],
  ),
  'Vec::pop': note(
    'Take ownership of the final element if the vector has one.',
    'The vector loses its last element and returns Some(value). An empty vector stays empty and returns None. This is convenient for treating a vector as a stack.',
    ['take the last item from a vector', 'pop a stack', 'remove last element'],
  ),
  'Vec::remove': note(
    'Remove an element by index while preserving the order of the others.',
    'You receive the removed value by ownership. Later elements shift left by one position, so removing near the start of a long vector can be expensive. An index at or beyond the length panics.',
    ['remove item by index in order', 'delete element at a position', 'shift vector elements left'],
  ),
  'Vec::swap_remove': note(
    'Remove a vector element in constant time when order can change.',
    'The final element fills the removed slot. You receive the removed value by ownership. An index at or beyond the length panics.',
    ['unordered removal from a vector', 'delete by swapping with last', 'constant time remove by index'],
  ),
  'Vec::drain': note(
    'Remove a range from a vector and iterate over the removed values.',
    'The drain iterator holds a mutable borrow of the vector and yields owned elements. Dropping it also drops remaining removed elements. Check the bounds of the range before calling.',
    ['remove range from vector', 'consume a contiguous range of elements', 'drain items'],
  ),
  'Vec::split_off': note(
    'Move the tail of a vector into a second vector.',
    'The original vector keeps everything before the index. The returned vector owns the rest. The index may equal the length, which produces an empty tail. Larger indices panic.',
    ['split a vector into two owned vectors', 'move vector tail', 'separate elements after index'],
  ),
  'Vec::with_capacity': note(
    'Create an empty vector with room reserved for a known number of elements.',
    'Its length starts at zero. Push elements to fill it. The capacity is at least the requested amount, and indexing into spare capacity still falls outside the vector’s length.',
    ['reserve space before pushing', 'preallocate an empty vector', 'vector capacity versus length'],
  ),
  'slice::get': note(
    'Read an element or a range by index and handle a missing result.',
    'A single index yields Option<&T>, and a range yields an optional borrowed slice. An invalid index or range returns None. Vector and array values also expose slice methods.',
    ['get by index from a vector', 'safely read an array element', 'bounds checked slice lookup', 'get a range without panic'],
  ),
  'slice::get_mut': note(
    'Borrow an element or subslice mutably when the index is in bounds.',
    'A valid index gives a mutable reference tied to the original slice. Change the underlying data through that reference. An invalid index or range returns None.',
    ['mutate an element by index safely', 'get a mutable subslice', 'edit an array element if present'],
  ),
  'slice::split_at_mut': note(
    'Borrow two disjoint mutable slices from the same sequence.',
    'The left slice ends before mid and the right slice begins at mid. Rust can allow simultaneous changes through the two references because the regions cannot overlap. Values greater than the length panic.',
    ['borrow two mutable halves', 'split disjoint mutable slice', 'mutate separate regions of an array'],
  ),
  'slice::chunks': note(
    'Read a slice in successive non-overlapping groups.',
    'Each item is a borrowed subslice of at most chunk_size elements. The last one can be shorter. A chunk size of zero panics.',
    ['divide a slice into batches', 'iterate over groups', 'nonoverlapping chunks'],
  ),
  'slice::iter': note(
    'Visit a slice’s elements through shared references.',
    'The iterator yields &T for each position. The slice retains its elements. This works on arrays and vectors through their slice methods.',
    ['iterate over borrowed elements', 'read all items without moving them', 'loop over vector by reference'],
  ),
  'slice::len': note(
    'Read the number of elements visible through a slice.',
    'The answer is a usize measured in elements. A slice of a larger array counts only its own range. Taking the length borrows the slice and leaves its contents available.',
    ['length of a slice', 'number of elements in an array', 'count elements of a subslice'],
  ),
  'slice::iter_mut': note(
    'Visit and update elements through mutable references.',
    'The iterator borrows the slice exclusively and yields &mut T for successive positions. Write through each reference to change the original data.',
    ['mutate every item in a vector', 'iterate over mutable references', 'update each element in place'],
  ),
  'slice::sort_by_key': note(
    'Sort elements in place using an ordered key for each element.',
    'Equal keys preserve their original relative ordering. The key function may run more than once per element. The slice must be mutably borrowed for the sort.',
    ['sort a vector by field', 'stable sort by key', 'sort records by property'],
  ),
  'str::trim': note(
    'Borrow the part of a string between its leading and trailing whitespace.',
    'The returned &str points into the original text. Unicode whitespace at either end is excluded. Whitespace inside the text is preserved.',
    ['trim whitespace from a string', 'strip spaces around text', 'remove leading and trailing whitespace'],
  ),
  'str::len': note(
    'Read the length of a string slice in UTF-8 bytes.',
    'One Unicode scalar value can take between one and four bytes. Use chars().count() to count scalar values. A user-perceived character may consist of several scalar values.',
    ['length of a string slice in bytes', 'count utf8 bytes in str', 'byte length of borrowed text'],
  ),
  'str::split': note(
    'Read fields in a string using a delimiter or matching pattern.',
    'The iterator yields borrowed pieces, excluding matched separators. Consecutive separators and a separator at either edge can produce empty fields. The original string stays available.',
    ['split text by comma', 'separate a string by delimiter', 'split string into fields'],
  ),
  'str::split_whitespace': note(
    'Read the whitespace-separated words in a string.',
    'Runs of Unicode whitespace act as separators. The iterator yields borrowed nonempty pieces. Empty or all-whitespace input yields no words.',
    ['split words on whitespace', 'ignore repeated spaces between words', 'tokenize whitespace separated text'],
  ),
  'str::parse': note(
    'Convert text to a type that implements FromStr.',
    'The target type determines which formats are accepted and which error type is returned. Supply a type annotation or a type argument such as parse::<u32>() when inference needs help.',
    ['convert a string to an integer', 'parse text as a number', 'FromStr conversion'],
  ),
  'str::chars': note(
    'Iterate over the Unicode scalar values in UTF-8 text.',
    'Each item is a Rust char. A scalar value can occupy multiple UTF-8 bytes, and a user-perceived character can contain multiple scalar values. The iterator borrows its input.',
    ['iterate characters in utf8', 'read unicode scalar values', 'loop over characters of a string'],
  ),
  'str::get': note(
    'Borrow a substring using a checked byte range.',
    'The range must be in bounds and its endpoints must fall on UTF-8 character boundaries. An invalid range returns None. To count Unicode scalar values, use a character iterator.',
    ['substring by byte range', 'slice text at utf8 boundaries', 'get part of a string safely'],
  ),
  'String::retain': note(
    'Keep selected characters inside an owned string.',
    'The predicate is called with each Unicode scalar value in original order. Returning false removes that character. The operation borrows the String mutably and keeps retained characters in order.',
    ['remove characters from a string', 'filter letters in place', 'keep digits in a string'],
  ),
  'String::pop': note(
    'Remove the last Unicode scalar value from an owned string.',
    'A nonempty String returns the removed char in Some. Empty input returns None. The byte length shrinks by the UTF-8 width of that char.',
    ['remove last character of a string', 'pop a character off text', 'take final character from owned string'],
  ),
  'String::len': note(
    'Read the byte length of an owned UTF-8 string.',
    'A string grows by the number of bytes used to encode each appended character. For example, the scalar value é occupies two UTF-8 bytes. Use chars().count() when you need a scalar-value count.',
    ['length of a string in bytes', 'count bytes in owned text', 'byte length of a string'],
  ),
  'String::push_str': note(
    'Append the contents of a borrowed string slice to an owned string.',
    'The destination is borrowed mutably. The source is borrowed for the call and can still be used afterward. The destination may grow its allocation.',
    ['append text to a string', 'concatenate a borrowed string', 'add a string suffix'],
  ),
  'String::into_bytes': note(
    'Consume an owned string and take its UTF-8 bytes as a vector.',
    'The vector takes over the string’s buffer, so the conversion does not have to copy its contents. The original String has been moved. To borrow the bytes, use as_bytes().',
    ['convert owned string to byte vector', 'take utf8 bytes without copying', 'move string buffer'],
  ),
  'HashMap::entry': note(
    'Look up a key and work with its occupied or vacant entry.',
    'The key is taken by value and the map is mutably borrowed. The entry API supports updating an existing value or initializing a missing one in a single lookup.',
    ['update or insert a map value', 'get occupied or vacant entry', 'modify a value by key in place'],
  ),
  'HashMap::get': note(
    'Read a map value by borrowing its key.',
    'A present key returns Some(&V). A missing key returns None. The lookup can use a borrowed form of the stored key when its equality and hashing agree, such as &str for a String key.',
    ['look up a value by key', 'read from a hash map', 'find a dictionary entry'],
  ),
  'HashMap::insert': note(
    'Store a key and value and recover any value that was replaced.',
    'A new key returns None. When an equivalent key already exists, its original key stays in the map, its value is replaced, and you receive the old value in Some.',
    ['replace value for key', 'add key value pair', 'insert into dictionary'],
  ),
  'Entry::or_insert_with': note(
    'Get a mutable map value and construct a default only for a vacant entry.',
    'The closure runs when a value must be inserted. The returned &mut V refers to the value in the map in either case. Start with HashMap::entry to obtain the entry.',
    ['lazy map default', 'initialize missing key with closure', 'insert if absent'],
  ),
  'Entry::or_insert': note(
    'Put a value in a map only when its key is absent.',
    'Start with HashMap::entry(key) and supply a default value. An occupied entry keeps its existing value. Both paths return a mutable reference to the stored value. Use or_insert_with when computing the default is expensive.',
    ['put a key in a map only if absent', 'insert value if key is missing', 'supply default for vacant hash map entry'],
  ),
  'Iterator::map': note(
    'Transform each yielded item using a closure.',
    'The adapter takes ownership of the iterator. Its closure runs as a consumer requests items. The item can itself be a reference when the upstream iterator borrows its data.',
    ['transform every item', 'convert each iterator element', 'apply a function to an iterator'],
  ),
  'Iterator::filter': note(
    'Build an iterator that yields only items passing a test.',
    'The predicate receives a reference to each item. Calling iter() on a vector starts with borrowed elements, so filtering that iterator leaves the vector intact. A consumer such as collect drives the work. Collecting those references gives a collection that still borrows from the original.',
    ['filter into a new collection', 'keep matching iterator items', 'skip items that fail predicate', 'filter a vector without changing the original'],
  ),
  'Iterator::collect': note(
    'Consume iterator items to build a result type implementing FromIterator.',
    'The expected type decides what to build. For example, collect::<Vec<_>>() gathers items into a vector. Collecting Result items into Result<Vec<_>, _> can stop at the first error.',
    ['convert an iterator to a vector', 'gather items into a collection', 'collect results'],
  ),
  'Iterator::filter_map': note(
    'Transform iterator items and skip those that produce None.',
    'The closure receives each item by value. Some(output) yields that output and None skips the input. The adapter does its work when consumed.',
    ['map and filter at once', 'skip missing transformed values', 'keep some outputs and skip none'],
  ),
  'Iterator::fold': note(
    'Combine all iterator items into a single accumulator.',
    'Start with an explicit initial value. For each item the closure takes the accumulator and returns its next value. An empty iterator returns the initial value.',
    ['accumulate from an initial state', 'reduce iterator to one value', 'combine all items'],
  ),
  'Iterator::find': note(
    'Take the first matching item from an iterator.',
    'The iterator advances through the match and returns it in Some. If no item matches, it reaches the end and returns None. You can continue using the iterator after a successful search.',
    ['find first matching element', 'search an iterator by predicate', 'stop at first match'],
  ),
  'Iterator::enumerate': note(
    'Pair each yielded item with its zero-based position in the iteration.',
    'The adapter yields (usize, item). Its count starts at zero where you apply enumerate, so filtering first renumbers the remaining items.',
    ['loop with index and value', 'number iterator items', 'get position while iterating'],
  ),
  'Option::map': note(
    'Transform the value inside Some and propagate None.',
    'The method consumes the Option. Its closure takes the contained value by ownership when present. To keep an owned value in the original option, first borrow it with as_ref().',
    ['transform an optional value', 'change value inside some', 'apply a function if present'],
  ),
  'Option::and_then': note(
    'Chain a second operation that can return None.',
    'With Some(value), the closure takes the value and returns the next Option. With None, the closure is skipped. This keeps the result in a single Option layer.',
    ['chain optional operations', 'flat map an option', 'avoid nested options'],
  ),
  'Option::as_ref': note(
    'Borrow an optional value without moving its contents.',
    'The result is Some(&value) or None. As long as the reference is in use, it borrows from the original option. The owner can keep using its stored value after that borrow ends.',
    ['borrow inside an option', 'inspect some without moving', 'convert to option of reference'],
  ),
  'Option::take': note(
    'Move a value out of an Option field and leave None behind.',
    'The method needs a mutable borrow of the option. It returns the previous Option by ownership, so a second call without replacement returns None.',
    ['move out of optional field', 'empty an option', 'take value leaving none'],
  ),
  'Option::ok_or_else': note(
    'Turn a missing optional value into a lazily constructed error.',
    'Some(value) becomes Ok(value). For None the closure runs to produce Err(error). The method consumes the original option.',
    ['convert option to result', 'create an error for none', 'require an optional value'],
  ),
  'Option::unwrap_or_else': note(
    'Get the optional value or calculate a fallback when it is missing.',
    'The method consumes the Option and returns a T. The closure is skipped when a value is present, which avoids computing an expensive fallback unnecessarily.',
    ['use a fallback for none', 'compute default only if missing', 'unwrap option with closure'],
  ),
  'Result::map': note(
    'Transform the successful value of a Result.',
    'The operation consumes the Result. An Ok value is moved into the closure. An Err value is passed through with its original error type.',
    ['transform successful result', 'change ok value', 'map successful response'],
  ),
  'Result::as_ref': note(
    'Borrow either side of a Result.',
    'The returned Result contains &T on success or &E on failure. The original still owns both possible payloads, so you can inspect it and use it again once the borrow ends.',
    ['inspect result without moving', 'borrow ok or err', 'get a reference inside result'],
  ),
  'Result::map_err': note(
    'Convert an error while preserving a successful value.',
    'The method consumes the Result. When the value is Err, the closure takes its error and produces the new error type. For Ok, no conversion runs.',
    ['convert error type', 'transform err value', 'translate a result error'],
  ),
  'Result::and_then': note(
    'Continue a successful operation with another fallible operation.',
    'The closure receives the owned Ok value and returns the next Result with the same error type. The first Err skips the closure and propagates.',
    ['chain fallible operations', 'flat map result', 'run next step on success'],
  ),
  'mem::take': note(
    'Move a value out through a mutable reference and leave its default behind.',
    'The type must implement Default. The previous value is returned by ownership. This is useful when a struct field must remain initialized while you process its old contents separately.',
    ['move out of a field with default', 'take ownership of a field', 'replace value with default'],
  ),
  'mem::replace': note(
    'Exchange a value behind a mutable reference for a replacement you supply.',
    'The replacement is moved into the destination, and the old value is returned to you. This function does not drop either value during the exchange.',
    ['swap a field for a new value', 'move out using a replacement', 'replace and get previous value'],
  ),
  'Arc::new': note(
    'Allocate a value with atomically reference-counted shared ownership.',
    'The input moves into the allocation. Cloning the Arc handle shares ownership of the same allocation. Access from multiple threads still depends on the contained type’s Send and Sync bounds.',
    ['share ownership across threads', 'create atomic reference counted pointer', 'put data in an arc'],
  ),
  'Arc::make_mut': note(
    'Obtain mutable access with clone-on-write behavior.',
    'If another strong Arc shares the allocation, its contents are cloned for this owner. With a single strong owner and outstanding Weak handles, the weak handles are disassociated. With exclusive ownership, the contents can be mutated directly.',
    ['clone on write arc', 'mutate shared arc data by cloning', 'arc copy on write'],
  ),
  'Mutex::lock': note(
    'Acquire exclusive access to the protected value, waiting when necessary.',
    'A successful lock returns a guard. Dropping the guard releases the lock. A poisoned mutex returns an error containing the acquired guard, letting the caller decide how to handle the protected state.',
    ['acquire a mutex guard', 'block until lock available', 'mutually exclusive access'],
  ),
  'Mutex::try_lock': note(
    'Try to acquire a mutex and return immediately.',
    'An available unpoisoned lock gives you a guard. A busy lock returns WouldBlock. A poisoned lock that was acquired reports Poisoned with its guard.',
    ['try a nonblocking lock', 'acquire mutex without waiting', 'test if mutex is available'],
  ),
  'OnceLock::get_or_init': note(
    'Read a shared value and initialize it on first access.',
    'Concurrent callers coordinate initialization. After a successful initialization they receive references to the same stored value. If the initializer panics, the cell remains uninitialized.',
    ['initialize shared state once', 'thread safe lazy initialization', 'cache value on first use'],
  ),
  'RefCell::try_borrow_mut': note(
    'Ask for an exclusive runtime-checked borrow and handle a conflict.',
    'The RefMut guard permits writing while it lives. Any active shared or exclusive borrow causes this call to return an error. Releasing the guard ends the borrow.',
    ['check refcell mutable borrow', 'avoid a borrow_mut panic', 'borrow mutably at runtime'],
  ),
  'thread::spawn': note(
    'Start an operating-system thread and get a handle for joining it.',
    'The closure and its return type must satisfy Send and the static lifetime bound. Joining waits for completion and reports a panic. Dropping the handle detaches the thread.',
    ['start a new thread', 'spawn background work', 'launch a worker thread'],
  ),
  'thread::scope': note(
    'Run scoped threads that can borrow data from their surroundings.',
    'Use the supplied scope to spawn threads. Unjoined scoped threads are joined before the scope returns. Borrowed data must stay valid for that scope.',
    ['spawn threads borrowing local data', 'scoped threads', 'join workers before scope ends'],
  ),
  'mpsc::channel': note(
    'Create a multi-producer, single-consumer channel with an unbounded buffer.',
    'The sender can be cloned, and each sent value moves into the channel when the send succeeds. Incoming messages can accumulate if producers outpace the receiver. For a fixed capacity, see sync_channel.',
    ['send messages between threads', 'unbounded queue with multiple producers', 'create a channel'],
  ),
};

export const rustDocsEntries = reference.items.map(item => ({ ...item, ...notes[item.title] }));
