# Coding Dungeons security review

Audit dated November 14, 2026, against source commit `b04c53d`, the mobile production build generated from it, and the existing Windows 1.0.14 package and local installer. The two mobile fixes below are committed in `570c4c0`; the complete app suite and rebuilt mobile browser journeys were rerun against that code. No replacement Windows installer was produced during this audit.

The exercised sandbox boundaries held. The review did not establish a path from a learner submission to the PC or phone filesystem or network. There are unresolved dependency and distribution concerns below. Personal testing should use the locally built artifact or a trusted HTTPS origin. Public release needs the remaining fixes and platform validation.

The PC currently has unsigned `%LOCALAPPDATA%/CodingDungeons/app-1.0.13`, with Go 1.25.1 and .NET 8.0.33. Both release lines are now out of support. Replace that installed build before grading unknown code; the newer source's verification does not establish safety of the older installation. The available installer is 1.0.14, built November 13. The current Git source contains additional November 14 mobile changes. Source tests, package tests, and the currently installed app have different version coverage. [Go support policy](https://go.dev/doc/devel/release#policy) · [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)

| Priority | Finding and precondition | Recommended action |
| --- | --- | --- |
| Medium, both editions | The pinned QuickJS WebAssembly variant identifies its interpreter as `2025-09-13+f1139494`. Upstream reports a source-triggered heap over-read in that revision and fixed it in `841dd03`. The npm wrapper remains at 0.32.0. The WebAssembly memory boundary limits the established impact to the embedded runtime. An OS escape has not been demonstrated. | Rebuild or adopt a verified patched QuickJS variant and run the complete JS/TS suite before distributing another build. Track the embedded interpreter revision separately from npm advisories. |
| Release trust, Windows | `CodingDungeonsSetup-local.exe` 1.0.14 and the packaged app executable are unsigned. A checksum identifies the file but does not authenticate its publisher. | Produce the public installer through the existing signed release path and publish its hash through a trusted channel. |
| Medium, Windows defense in depth | The native manifest covers selected executables, while GM binaries/model and companion DLLs have incomplete verification at launch. The manifest itself sits beside the writable runtime. Exploitation requires prior ability to replace files under the installation directory. | Anchor a complete runtime inventory in the protected application and verify it before execution. Sign the release and retain the existing isolated native runner. |
| Medium, build environment | The installer build helper is 7-Zip 21.07 from `7zip-bin@5.2.0`. Upstream has shipped security fixes since then. The inspected package contains no standalone `7z.exe`, and the observed helper use processes the project's own archive. | Replace and pin the build helper to a maintained version, then repeat installer payload verification. |
| Deployment hardening, mobile | The static build supplies a page CSP meta tag. The build does not supply worker response CSP headers, and framing protection needs an HTTP header. No production HTTPS deployment was available to inspect. | Serve from a dedicated HTTPS origin with response CSP, worker policies and `frame-ancestors 'none'`. Verify those headers at the actual hosting provider. |
| Integrity hardening, mobile | Cache names use build hashes, while downloaded assets are accepted by HTTP success and path. Executable runtime files are not individually verified against trusted expected digests. A mixed deployment or runtime-asset replacement can cause incorrect/offline failures or altered grading. | Deploy atomically, reject unexpected redirects and verify executable assets against the current build's digests. Trust in the original HTTPS app remains necessary. |

The interpreter finding is supported by the installed dependency README, the upstream issue and fix, and a bounded local reproduction. In a disposable 8 MiB QuickJS runtime with a one-second deadline, shrinking a resizable buffer during `TypedArray.with` left nonzero copied values beyond the shrunken source. Only a Boolean was logged; no heap contents were printed. This confirms the interpreter over-read and does not demonstrate a browser or OS escape. The release comparison used official Electron, Go and 7-Zip release sources. [QuickJS issue 492](https://github.com/bellard/quickjs/issues/492) · [QuickJS fix](https://github.com/bellard/quickjs/commit/841dd03) · [Electron releases](https://releases.electronjs.org/?channel=stable) · [Go releases](https://go.dev/doc/devel/release) · [7-Zip history](https://www.7-zip.org/history.txt)

Two reproducible mobile issues were fixed during this audit:

- An otherwise valid selected backup containing `groups: [null]` in a saved attempt passed import and could crash the results screen. Nested report and receipt fields now receive validation before any hero or reader data is written. Regression checks reject malformed groups, case IDs, output and receipt feedback and preserve valid version-1 round trips.
- The Go outer watchdog covers asset loading and compilation as well as execution. Its timeout previously recorded a graded attempt and receipt, with zero HP damage, even when the cause was infrastructure delay. It now reports an infrastructure error, preserves the draft and releases the runner for retry. A stalled-worker regression failed before the change and passes afterward.

Validation evidence is stored under the project's ignored `out/verification-*.log` paths.

| Check | Observed result |
| --- | --- |
| Full source app suite | 248 passed after the fixes, zero failed. Seven integration checks initially skipped by default were exercised separately using the local runtimes. |
| Local browser journeys | All 23 passed. |
| Packaged Windows UI | Passed through Chromium's debugging protocol with the production sandbox and integrity protections enabled: world picker, denial of unauthenticated engine requests, no renderer Node globals, first JS/TS/Rust/Go full Workbench suites, Forge and reload persistence. The original Node-inspector-based Electron harness timed out after 20 seconds. |
| Mobile browser journeys | Both passed, covering four worlds, distinct saves, offline downloads, JS/TS/Go grading and Rust draft preservation. |
| Complete mobile runtime catalog | All 49 references passed and all 49 starters were rejected offline through real browser workers: 14 challenges plus a goblin per language for JS, TS and Go, and four code stages across the refactoring and system-design side quests. Cancellation, timeout recovery, guest file/network denial and early-exit rejection passed. |
| Android emulator Chrome | Both offline mobile journeys passed again after rebuilding with the fixes. |
| Windows isolation probe | LPAC token, file access, loopback denial and Job Object cleanup passed. |
| Packaged broker | Rust and Go each passed isolation, expected pass/fail fixtures and the three sack-lock cases. |
| Real Wasmtime and compilers | Four tests passed, covering traps, early exit, fuel exhaustion, authored Go reference cases and the Rust WASI catalog. |
| Local GM model | The real bundled model passed authored partial-credit, irrelevant-answer and misconception checks. |
| Rust book code | 156 blocks matched expected acceptance/rejection, with zero unexpected results. Also ran 122 complete examples, the Chapter 25 regression suite and the Rust feature probe. |
| All world assets | Verified 718 pages, PDFs, field kits and reader links across all four worlds. |
| Dependency advisory scan | `npm audit` returned zero known advisories. The embedded QuickJS finding above is outside that result. |
| Windows Defender | Scan-only custom scan of the resolved installer path finished successfully with no threats found. Definitions were dated November 14. |

The audited installer SHA-256 is `ADEF6D5D6998CE8F7D873BDB97E7555D8B976BB7FD549E95E3C73E7C598B0D74`. The scan applies to that file. Defender's initial attempt using a forward-slash path returned error `0x80508023`; retrying with the resolved Windows path completed successfully.

Repeat the runtime catalog check with `npm run test:mobile:runtime`. Stage the Go pack first with `npm run mobile:stage-go` and set `FERRUM_MOBILE_REQUIRE_GO=1` to require Go coverage instead of allowing an explicit skip. The measured medians on this PC were 23 ms for JavaScript, 114 ms for TypeScript and 800 ms for Go. These are host-browser measurements, not phone performance claims.

Use `npm run test:desktop:production` for the protected Windows package. It launches only a temporary profile with a random Chromium debugging port and closes it afterward; it does not enable the Node inspector or disable the sandbox. The older `test:desktop` harness relies on the Electron Node inspector and timed out with this production package.

The mobile edition is a browser-installed PWA. An APK or iOS native package was not produced or audited. iPhone Safari, real low-memory phones and the total 2 GB process-memory target remain unverified. Rust compilation was unavailable in the mobile build assessed above. The subsequent optional experimental Rust pack and its separate validation are documented in [MOBILE-RUST.md](MOBILE-RUST.md); this does not change the installer hash or the outstanding QuickJS finding in this audit. The mobile GM uses authored rules, while Windows uses the bundled local model.

The Windows runner creates temporary AppContainer profiles, tool access rules and scratch files and removes them after normal completion. The app stores local saves in the user's application data. On mobile, downloaded worlds, saves and drafts use browser storage, and exported backups contain plaintext progress and answers. The isolation probe and successful scan establish specific checks, while future compiler, browser and operating-system vulnerabilities still require maintenance.

Reviewed the Windows desktop build, the local browser development server, the save format, and the JavaScript, TypeScript, Rust, and Go grading paths on November 8 and 13, 2026.

| Finding | Impact | Change |
| --- | --- | --- |
| The installer toolchain used an affected archive extractor. | Upstream advisories cover extraction in the build environment. The extractor is a build dependency. | Updated Electron Forge and its archive and glob dependencies. The updated npm lockfile returned zero advisories at review time. |
| Save import accepted a database based on the presence of a table name. | A selected file could install unexpected SQLite triggers or an incompatible schema and affect later saves. | Validate a private copy against the supported schemas before changing any live save. Migrate legacy saves in the private copy. Disable SQLite trusted schema. |
| Save import accepted unbounded databases and progress data. | A selected backup could consume disk space or stall later progress reads. | Check database and journal sizes before staging and validate hero records and progress payloads before installation. |
| A hint URL changed hero progress on GET. | A page on a sibling localhost origin could mark the active hero as assisted without going through the mutation guard. | Require POST, the local mutation header, a valid hero, and the expected origin for browser requests. |
| Packaging copied most untracked files in the project folder. | A local backup or signing file placed in the project could be included in the distributed app. | Allow only the required application paths and check the separately bundled runtime for unexpected root entries, private files, and links. |
| Go's generated verdict used a Boolean name shared with the submission's package. | The submission's package scope could change how the fixture recorded failure. | Use a numeric failure marker and dispatch cases by index without using submission-visible names for bounds checks. |

The installed desktop package includes Electron and native runtimes outside the npm advisory scan. The Windows package pins Electron 45.3.2 and verifies its archive hash. The installer build requires Go 1.27.4 and .NET 10.0.15. The packaged app enforces ASAR integrity and disables Node startup flags. [Electron release](https://github.com/electron/electron/releases/tag/v45.3.2) · [Go releases](https://go.dev/doc/devel/release) · [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)

The browser development server is for local single-user use. A process that can reach its loopback port can use the development API. The desktop app uses a per-launch secret, a sandboxed renderer, and a fixed local origin. Local challenge grades are practice feedback. A user who controls the installation can inspect the bundled tests and edit local saves.

Rust and Go grading require the Windows broker to pass its isolation probe. The browser development build also uses that broker. The legacy Docker grader was removed because the test result shared a writable environment with the submission. [Windows AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)

Save export covers the four world databases and the supported reader drafts and positions. Release builds verify the application's signature inside the Squirrel payload and the final installer signature and timestamp. A local test installer can be built under a separate filename. [Windows release instructions](../README.md#develop)
