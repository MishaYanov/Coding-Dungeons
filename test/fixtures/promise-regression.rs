#[test]
fn replacing_a_registered_waker_drops_it_after_unlocking() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Weak;
    use std::task::Wake;

    struct ObserveDrop {
        shared: Weak<Mutex<Shared<u32>>>,
        unlocked: Arc<AtomicBool>,
    }

    impl Wake for ObserveDrop {
        fn wake(self: Arc<Self>) {}
    }

    impl Drop for ObserveDrop {
        fn drop(&mut self) {
            let shared = self.shared.upgrade().expect("promise still owns the mutex");
            self.unlocked.store(shared.try_lock().is_ok(), Ordering::Relaxed);
        }
    }

    struct CountWake(AtomicUsize);

    impl Wake for CountWake {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    let (complete, mut promise) = completion_pair::<u32>();
    let unlocked = Arc::new(AtomicBool::new(false));
    let first = Waker::from(Arc::new(ObserveDrop {
        shared: Arc::downgrade(&promise.0),
        unlocked: Arc::clone(&unlocked),
    }));
    assert_eq!(
        Pin::new(&mut promise).poll(&mut Context::from_waker(&first)),
        Poll::Pending,
    );
    drop(first);

    let current = Arc::new(CountWake(AtomicUsize::new(0)));
    let next = Waker::from(Arc::clone(&current));
    let mut context = Context::from_waker(&next);
    assert_eq!(Pin::new(&mut promise).poll(&mut context), Poll::Pending);
    assert!(unlocked.load(Ordering::Relaxed), "waker dropped under the resource mutex");
    complete.complete(42);
    assert_eq!(current.0.load(Ordering::Relaxed), 1);
    assert_eq!(Pin::new(&mut promise).poll(&mut context), Poll::Ready(42));
}

#[test]
fn completion_before_registration_is_visible_on_first_poll() {
    let (complete, mut promise) = completion_pair();
    complete.complete(42);
    let mut context = Context::from_waker(Waker::noop());
    assert_eq!(Pin::new(&mut promise).poll(&mut context), Poll::Ready(42));
}
