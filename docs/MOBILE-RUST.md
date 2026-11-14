# Experimental offline Rust Workbench

The optional World 3 pack runs real Rust compilation and challenge tests on the device. It preserves the existing books, heroes, drafts, examples, full submissions, monster fights, hard clears, HP and rewards. Infrastructure failures and cancellation preserve drafts without charging HP or consuming a submission ID.

## Toolchain and compatibility

The pinned candidate is Weblings' `artifacts-test-7` toolchain: **Rust 1.96.0-dev**, Cranelift 0.130.0 and the integrated riwl WebAssembly linker. This is an experimental third-party compiler port. The book and Windows edition remain on Rust 1.99.1. The mobile UI identifies its experimental compiler version. Newer features and some valid Rust operations are unsupported by this backend; such compiler failures must not be graded as incorrect submissions.

Sources: [compiler artifacts](https://github.com/AngelOnFira/wasm-rustc/releases/tag/artifacts-test-7), [compiler fork](https://github.com/AngelOnFira/rust/tree/riw-wasm20), [Weblings](https://github.com/AngelOnFira/weblings). Exact artifact and extracted-file hashes live in `lib/mobile/rust-toolchain.mjs`; no floating upstream download is used by the app.

**Local experimental testing only; public distribution is blocked.** The release archives provide binaries without matching generated `COPYRIGHT.html` / `COPYRIGHT-library.html` notices. The top-level Rust license texts, COPYRIGHT overview and Weblings license are included, but complete component notices and the exact compiler source revision are not verified. Obtain those notices and provenance, including the added backend, linker and WASI components, before publishing a Rust-enabled PWA or redistributing its pack. Checksums establish which binary was tested; they do not establish its full source provenance. The CI check does not publish the runtime.

The matching WASIp1 standard library supports the course's portable tests. Network connections, process creation and ordinary OS threads are not supplied to guest programs. External Cargo dependencies, procedural macro plugins and build scripts are not enabled. [Rust WASIp1 support](https://doc.rust-lang.org/stable/rustc/platform-support/wasm32-wasip1.html)

The dense-atlas trusted test uses the equivalent typed constant `255_u16` in place of `u16::from(u8::MAX)`, because this backend cannot emit that conversion. The generation range, value type, case IDs and assertions are unchanged. The test still rejects an implementation that wraps its generation at 256. The desktop fixture retains its original source. The existing portable admission fixture remains sequential and checks the same capacity and permit invariants plus Send bounds.

## Build and use

```powershell
npm.cmd run mobile:stage-rust
npm.cmd run mobile:build
npm.cmd run mobile:preview
```

Staging downloads the two fixed GitHub release archives, validates their hashes and sizes, extracts only the named regular files, validates the resulting binaries, adds license notices and atomically replaces `out/mobile-rust-pack`. A failed stage preserves the prior pack. To stage without downloading, pass `--archives` pointing to a directory containing the two pinned `.tar.zst` archives.

The installed pack is approximately 151.8 MiB before HTTP compression. World 3's book is additional. Open the built app, choose World 3 and complete **Download World 3** while online. The same edition then grades supported code offline. Runtime integrity checks reject mismatched or redirected compiler assets. Nothing from GitHub or crates.io is fetched while grading.

Builds without the pack retain the existing reader and draft-only Rust mode. Merely setting an environment flag cannot enable a missing or mismatched runtime.

## Execution boundary

One Rust job is active at a time. A shared immutable compiled WebAssembly module avoids recompiling and retaining multiple copies of the compiler's machine code. Verified standard-library bytes are cached in the page and copied into each worker. Each job still receives a fresh worker and compiler instances. Canceled or timed-out pending downloads are aborted and removed from the cache so retries can recover. The submission compiles to an rlib in a virtual directory without the test harness or reference answer. A second compilation links that library with the trusted harness. Each selected test receives a fresh WASI guest with empty environment and no preopened directories.

Compiler linear memory is capped at 256 MiB, guest linear memory at 64 MiB, individual compiler output files at 16 MiB and cumulative compiler writes at 64 MiB. Compile/link deadlines and the total job deadline are infrastructure errors. A running guest has a separate two-second limit. Guest exit, traps and forged duplicate verdict exports cannot create a pass.

These limits do not by themselves cap total browser RAM. Compiler code, downloaded assets, caches, JavaScript objects, graphics and shared browser processes require additional memory. The compiled module is reused only within the current app page; no submission state is reused.

Browser compilation of the compiler module itself cannot be interrupted. That operation retains its queue slot after cancellation until it settles; a retry cannot start a second compiler download or compilation in parallel. A browser-level initialization hang requires reloading the app. User-code workers remain terminable on cancellation and deadlines.

## Verification

```powershell
$env:FERRUM_MOBILE_REQUIRE_RUST = '1'
npm.cmd run test:mobile:rust
npm.cmd run test:mobile
```

The dedicated test checks all **27 Rust exercises plus the goblin: 28 suites and 89 reference cases**, rejects starter answers, and checks selected examples, invalid borrows/moves/lifetimes, inaccessible test source, forged verdict exports, no file/network capabilities, early exit, fresh guest state, memory exhaustion, cancellation and timeout recovery. The production mobile journey covers the first Rust boss and goblin, saved clears and offline reloads. `FERRUM_MOBILE_RUST_SMOKE=1` selects only the first boss and goblin catalog cases; it retains the boundary tests.

Final local validation: **283 app tests passed, 7 optional environment-dependent tests skipped; 38 real Rust browser tests passed; both complete Android journeys passed.** The desktop Rust WASI reference catalog was separately run with the existing packaged compiler, linker and worker and passed. The final Rust sweep's first answer took 1,679 ms and median 365 ms on the test PC; the following memory measurement was a separate full sweep.

Measurements on November 14, 2026 found repeated compiler modules could push the summed process working sets above 3 GB. Caching the compiled module and verified library bytes reduced the measured peak to **1,711,190,016 bytes** (about 1.59 GiB). The full reference sweep's first answer took 1,538 ms and the median took 312 ms on that PC. This diagnostic sum can count shared pages twice; it is not Android proportional memory. Compiler/guest linear memory peaked at 116,129,792 bytes.

The Android emulator passed both complete mobile journeys, including offline Rust examples, a boss clear, a goblin fight and saved-progress reloads. In the final measured run, across 48 one-second samples, all Chrome processes peaked at **1,447.6 MiB PSS** and **1,562.9 MiB PSS plus swap**, from a 600.9 MiB PSS baseline. No samples failed. The emulator reported 3.82 GiB usable RAM; the baseline includes existing preview tabs. These results do **not** establish support for physical 2 GB phones. iPhone Safari and physical low-memory devices remain unverified, and sampling can miss short peaks.

Repeat the emulator measurement with a running Android emulator and Chrome:

```powershell
$env:FERRUM_ANDROID_EMULATOR = 'emulator-5554'
$env:FERRUM_ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
node work/scripts/measure-android-mobile.mjs
```

The report is written to `out/android-mobile-memory.json`; the test closes its own tabs and clears only its temporary origin's service workers, caches, IndexedDB and local storage. Existing tabs, other origins and cookies are preserved. GitHub verification is configured to stage the pinned compiler and run the real offline Rust catalog before mobile game journeys; that remote workflow has not been run as part of this local-only change. No native APK or replacement Windows installer is produced by this feature.
