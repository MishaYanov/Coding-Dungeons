use std::alloc::Layout;
use std::cell::Cell;
use std::ffi::c_int;
use std::ptr;

fn shorten<'long: 'short, 'short>(
    source: Cell<&'long mut i32>,
) -> Cell<&'short mut dyn Send> {
    source
}

unsafe extern "C" fn add_pair(mut arguments: ...) -> i64 {
    // SAFETY: callers supply two c_int arguments in this order.
    let left = unsafe { arguments.next_arg::<c_int>() };
    let right = unsafe { arguments.next_arg::<c_int>() };
    i64::from(left) + i64::from(right)
}

fn main() {
    let mut value = 42_i32;
    let _erased = shorten(Cell::new(&mut value));

    let mut elements = [1_u32, 2, 3];
    let raw_slice = ptr::slice_from_raw_parts_mut(elements.as_mut_ptr(), 3);
    // SAFETY: slice metadata is correct and the size fits in isize.
    assert_eq!(unsafe { Layout::for_value_raw(raw_slice) }, Layout::new::<[u32; 3]>());

    let owned = Box::new(42_u32);
    let owner = Box::into_non_null(owned);
    // SAFETY: same pointer from into_non_null, recovered once.
    assert_eq!(*unsafe { Box::from_non_null(owner) }, 42);

    let (owner, len, capacity) = vec![2, 3, 5].into_parts();
    // SAFETY: original owned allocation and metadata, recovered once.
    assert_eq!(unsafe { Vec::from_parts(owner, len, capacity) }, [2, 3, 5]);

    // SAFETY: there are two arguments and both have the expected promoted type.
    assert_eq!(unsafe { add_pair(19 as c_int, 23 as c_int) }, 42);
}
