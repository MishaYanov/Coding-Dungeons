# Validation by change scope

Run commands from the repository root. Read current scripts/configuration before using optional runtime flags. Choose checks that can contradict the changed behavior; do not repeat a full release build for an instruction-only edit.

| Change | Evidence to collect |
| --- | --- |
| Technical book content | Primary-source claim checks; compiler and executed examples; rejected examples fail for the intended reason; starter/reference/mutant discrimination for new challenges |
| Book layout or reflow | PDF navigation/attachments/forms, image/text-edition revision match, visual inspection, stable prompt/listing IDs, saved-answer and draft compatibility |
| Game or storage behavior | Focused regression before/after, full app suite, desktop/mobile parity, retries/replays/concurrent submissions, rewards and HP, backup round trips |
| Runner or sandbox | Real passing/failing suites through the affected runtime; isolation probe; limits, cancellation, early-exit and spoofing checks; fail-closed infrastructure behavior |
| Reader/platform bridge | Browser journeys, mobile layout/focus, offline operation, world isolation; installed Android or packaged desktop tests for platform-specific behavior |
| Release artifact | Exact package version/content, runtime integrity, patched QuickJS hash, save/signing identity, full installer payload and actual package smoke tests |
| CI | Workflow lint/structure, every aggregate gate result including failed/skipped/canceled dependencies, selected job commands, actual remote run status when accessible |
| Skill/role instructions | Catalog/frontmatter/link validation and an independent realistic task using the kit; no app rebuild needed |

## Core commands

```powershell
npm test
npm run test:browser
python work/scripts/check_book_toolchains.py
python verify-worlds.py --check-typescript
python work/scripts/build-reader-text.py --check
```

The book toolchain script checks the baseline/current versions defined in it; a targeted version can be passed explicitly. See [book build dependencies](../../docs/BOOK-BUILD.md), including fonts, Python packages and C# field-kit checks. A type check alone is not a run, and a successful run is not a soundness proof.

## Runtime and package checks

- `browser/mobile-runtime.test.mjs`: actual JS/TS/Go browser workers. Require staged Go explicitly when its execution is part of the claim.
- `browser/mobile-rust.test.mjs`: actual experimental Rust browser compiler/guest. `FERRUM_MOBILE_REQUIRE_RUST=1` prevents a missing pack from becoming a skip; remove any smoke-only filter for a full catalog claim.
- `test/standalone-runner.test.mjs`: set `DUNGEONS_TEST_NATIVE_BUNDLE` to the absolute canonical staged runner directory to exercise the packaged broker checks. Other native boundary tests document their own required worker/compiler flags.
- `test/written-gm-live.test.mjs`: live bundled GM requires explicit staged CLI/model paths and `FERRUM_REQUIRE_LIVE_GM=1`.
- `npm run test:desktop:production`: actual packaged Windows app; `npm run test:android`: installed test APK. These require their built artifacts. Use a disposable profile/emulator and the separate test app identity.

Do not describe default-skipped integration tests as passed. Record which environment, source revision and artifact each result covers.

## Release sequencing

Use the existing build scripts rather than rebuilding sandbox binaries or interpreter variants ad hoc. Preserve the model/runtime licenses and durable signing identity. Verify new copied artifacts and checksums before removing explicitly selected older installers. Verify cleanup targets resolve inside the intended build/output directory; keep saves, keys, staged runtime packs and SDKs out of cleanup lists.

Source pushes do not publish installers. Local unsigned Windows builds, experimental mobile Rust redistribution, and 2 GiB phone support have different limits; read the current security/mobile documentation before making release claims.
