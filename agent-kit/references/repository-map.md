# Repository map

All paths below are relative to the Coding Dungeons repository root. Treat source/configuration files as authoritative; versions and counts in historical release notes describe those releases.

## Books and authored content

- Rust technical text: `work/manuscript/ch*.txt`, both appendices, and `lab_*.txt`. Campaign material: `work/gamebook/`. Checkpoints: `data/checkpoints.json`. Authored coding suites: `data/exercises.json` and `data/workbench/*.mjs`.
- Other worlds: `data/worlds/<language>/source.json`; `build-worlds.py` generates their campaign/page data and book assets.
- The current world order is JavaScript, TypeScript, C#, Rust, Go. Save identity uses stable IDs `javascript`, `typescript`, `csharp`, `rust`, `go`, not display numbers.
- Published PDFs, page images, field kits and text editions: `public/book/`. Rebuild instructions: [BOOK-BUILD](../../docs/BOOK-BUILD.md). Rust compatibility/history: [RUST-BOOK-REVISIONS](../../docs/RUST-BOOK-REVISIONS.md).
- Preserve prompt and listing identities across editorial changes. Rust reflow aliases live in `data/reading-revisions.json`; named answers/drafts move, while generic page notes and saved reading positions retain their numeric page identity.

## Game and saves

- React reader: `src/renderer/`; shared page/path/editor behavior belongs here rather than in separate platform implementations.
- Desktop/local HTTP engine: `server.mjs`, SQLite persistence in `lib/store.mjs`.
- Mobile engine: `lib/mobile/engine.mjs`, IndexedDB repository and platform-local backup helpers. World stores are separate.
- Encounters, side quests, trials and merchant rules: `lib/encounters.mjs`, `lib/side-quests.mjs`, `lib/trials.mjs`, `lib/merchant.mjs` and their authored catalogs.
- The desktop GM uses the bundled model through bounded authored rubrics. Mobile uses authored review rules. GM feedback is fallible and does not replace executable test verdicts.
- C# currently has authored questions, saved code drafts and guided self-review, not an in-game compiler. Do not present it as an executable Workbench world.

## Execution boundaries

- JS/TS: patched QuickJS variant under `vendor/quickjs/`, selected through shared runner modules. TypeScript contracts and executable examples have distinct grading roles.
- Windows Rust/Go: `lib/standalone-runner.mjs`, trusted harness generation, `native/`, LPAC broker and Wasmtime guest. Readiness requires the actual isolation probe.
- Browser/mobile Rust/Go: worker-based WASM compiler/guest paths under `lib/mobile/`. Host-thread examples are not evidence that the WASI/mobile guest supports OS threads.
- Runtime manifests and toolchain pins are authoritative. Consult [MOBILE-RUST](../../docs/MOBILE-RUST.md), [SECURITY-REVIEW](../../docs/SECURITY-REVIEW.md) and [QuickJS provenance](../../vendor/quickjs/README.md) for their current limits.

## Delivery and CI

- Electron main/preload, save transfer and package allowlist: `desktop/`. Android WebView shell and document bridge: `android/`. Mobile bundling/service worker: `work/scripts/mobile-build.mjs` and `src/mobile/`.
- `package.json` supplies the app version; Android derives its update version from it. Preserve the existing signing identity rather than generating a new one for each update.
- Local installers and downloadable book outputs go in ignored `outputs/`; build products go in `out/` and `dist/`; detailed release evidence goes in ignored `work/qa/`.
- Runtime packs, model weights, signing keys and saves are not source files to copy into the kit or publish with a branch. The experimental mobile Rust pack has unresolved redistribution/provenance conditions documented above.
- Workflow: `.github/workflows/verify.yml`, displayed as Build & Test. See [CI](../../docs/CI.md) for application tests, the Rust compiler matrix and the retained `verify` gate.
