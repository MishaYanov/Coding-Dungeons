# Coding Dungeons 1.1.0

This release combines the goblin dismissal fix, diamond merchant, 1.1.0 hotfixes, path guidance, TypeScript and Go side quests, reflowable reader, C# world, and Rust/Go microservice repair stories. The release branch includes the current GitHub main history; merges into main remain a separate review step.

## Playable changes

- Five worlds: JavaScript, TypeScript, C# and .NET, Rust, and Go. Existing saves use stable language IDs, so inserting World 3 does not move Rust or Go saves.
- C# and .NET has 18 beginner levels, a 61-page book and field kit, quizzes, trials, character progression, and guided code drafts/self-review. It does not provide an in-game C# compiler. Field-kit programs target the .NET 10 SDK.
- The merchant sells healing potions, cosmetics, a title, and a world-specific vault key. Purchases, equipment, and vault completion persist per hero/world.
- Paths explain their coverage and continue in their authored order. Text reading mode preserves page numbers, navigation, book links, and hidden diamonds.
- TypeScript's Harbor Signal Board and Go's Recall at the Relay add ordered, tested repairs.
- The Runaway Dispatch opens from the World Map at Rust Level 28 and Go Level 14. Each version has eight stages: five design decisions and three independently tested code repairs covering idempotency, bounded retries, and admission/shutdown or goroutine ownership. Examples are practice; full suites advance the story. Progress and its once-only potion reward are separate from the book's Forge checkpoints.

## Correctness and review

Review covered server/renderer routing, world isolation, SQLite/IndexedDB transactions, receipts and rewards, merchant accounting, hero deletion, save import/export validation, native execution boundaries, offline caching, Android access controls, and all 18 new C# lessons. Two integration issues were corrected: mobile practice/unavailable results returned an old view without the newly saved draft, and a browser test assumed an empty hero list despite an earlier test creating a hero. The Rust retry exercises also avoid operations unsupported by the experimental mobile compiler while preserving their contracts.

Concurrency examples distinguish synchronization from shared ownership and cancellation from joining. The in-memory ledger is a single-process teaching component: production replicas need a shared transactional store and a scoped unique key. A timeout does not prove a remote effect failed. Retrying an ambiguous operation requires receiver idempotency or reconciliation; an outbox does not provide exactly-once delivery. RAII drain permits do not guarantee cleanup on abort, process exit, or a deliberately leaked permit.

Primary references checked include [Rust Mutex](https://doc.rust-lang.org/std/sync/struct.Mutex.html), [Arc](https://doc.rust-lang.org/std/sync/struct.Arc.html), [destructors](https://doc.rust-lang.org/reference/destructors.html), the [Go memory model](https://go.dev/ref/mem), [sync](https://pkg.go.dev/sync), [context cancellation](https://pkg.go.dev/context#CancelFunc), [.NET support](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), [file-based C# applications](https://learn.microsoft.com/dotnet/core/sdk/file-based-apps), and [record semantics](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/record).

## Verified locally

| Check | Result |
| --- | --- |
| Source application suite | 344 passed; eight optional integrations exercised separately below |
| Desktop browser journeys | 29 passed |
| JS/TS/Go browser runtime suite | 14 passed; reference/starter runs, all supported side quests, QuickJS regression and runner boundary checks |
| Rust browser runtime suite | 41 passed; 31 references and starters, 105 authored case slots, compiler/guest boundary checks |
| PWA phone-layout/offline journeys | 2 passed |
| Native broker suites | 10 passed, including all six repair references and their broken starters |
| Additional native boundary suites | 5 passed: LPAC/job isolation, Wasmtime termination/fuel, Go and Rust WASI catalogs |
| Bundled local GM integration | Passed partial-credit, unrelated-answer, misconception, and prompt-override checks |
| Rust book | 156 snippets checked (144 accepted, 12 intentionally rejected); 122 complete examples and regression probes passed |
| Other books and assets | All five books, 779 pages and field kits verified; 14 TypeScript exports and all 18 C# examples plus 18 starters ran |
| Reflowable text editions | All five match their PDF/source edition |
| Production Windows app | World picker, request/renderer boundaries, four executable worlds, C# drafts/self-review, QuickJS regressions, goblin dismissal, both full repair stories and reload persistence passed |
| Android | Debug/release builds, seven Java policy tests and lint passed; three installed test-APK journeys passed, including all five worlds and QuickJS regressions |
| Artifact contents | Windows contains five text editions, 779 page images and both repair catalogs; Android's 916 game assets match the mobile build; patched QuickJS hash verified in both |
| npm audit | Zero reported vulnerabilities |

The Android emulator's WebView updated during the first run, causing Android to terminate the WebView and test app. Logcat identifies `killDueToPackageUpdate`; the complete rerun passed after that update. This is retained in the local test evidence.

## Build status and limits

The Windows installer is an unsigned private build. Android retains the existing local signing identity, requests no Internet or storage permissions, and is not debuggable. Installer checksums are written alongside the two current installers in `outputs/SHA256SUMS.txt`; detailed logs and artifact inventories are retained locally under `work/qa/release-1.1.0/` and excluded from Git.

The Android Rust compiler remains an experimental older backend. Public redistribution of its binary pack is blocked pending complete component notices and verified source provenance; source branches do not include the pack. See [mobile Rust](MOBILE-RUST.md) and the [security review](SECURITY-REVIEW.md). These tests do not establish that arbitrary submitted code is risk-free. Existing Windows runtime-integrity and signing limits remain documented in the security review.

Android verification used an emulator with approximately 4 GiB reported RAM. Physical phone performance and 2 GiB device support remain unverified. An unresponsive document provider selected by the user can stall the current import/export operation; it does not gain access to the app's private saves. The mobile GM uses authored rules rather than the desktop model.
