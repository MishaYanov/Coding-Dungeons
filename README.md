# Coding Dungeons

Play through five programming books in a local game reader. Read the book on the left, then use the Game Master on the right for quizzes, coding challenges, hints, and debriefs. Your character sheet tracks XP, skill levels, and path progress.

Open **Code Workbench** on a graded challenge. Run Examples to practice, then Submit solution to run the required suite. Passing the full suite defeats the creature and saves Forge progress. Choose Hard Mode to lock hints, suggestions, and example answers for the encounter and earn an unaided clear. Project review pages keep the book's design work alongside the executable drills.

In a code editor, **Tab** inserts four spaces. Press **Escape**, then **Tab** to move focus forward. On selected Guided challenges, **Show code suggestion** offers an authored snippet you can apply or undo.

The World Map also links to special encounters. Break the Ironbound Scarab's three locks in Rust Level 3, or diagnose, reproduce, and repair a stale-request bug in JavaScript Level 12. Each step is saved for your hero.

Rust Level 28 and Go Level 14 include **The Runaway Dispatch**, a microservice incident and refactoring story. Repair the service's concurrency controls, idempotency records, retry policy, and shutdown behavior through ordered design decisions and tested code changes. Use the World Map to open the quest. Examples are practice, full suite passes advance the repair, and finishing the story earns one potion for a One Life hero. Progress and rewards are saved independently of the core book's Forge checkpoints.

Under **World Map → Side quests**, open **The Harbor Signal Board** in TypeScript Level 11 to validate unknown data and route typed notices, or **Recall at the Relay** in Go Level 12 to stop on cancellation and resume deliveries safely.

Watch the book for a hidden diamond. It can turn up on any kind of page. Click it to face the Diamond Goblin, then beat a coding challenge and a multiple-choice question to claim its bag of three diamonds. Your character sheet shows the loot. Each hero can clear the ambush once per world. After victory, choose **Continue adventure** to dismiss the result. Turning a page or reopening the game also hides the completed encounter while keeping your rewards; unfinished fights remain available.

Visit the **Merchant** from the campaign menu or the goblin victory screen. Healing potions for One Life heroes, the Emerald Cloak skin, and the Gemkeeper title each cost one diamond. Buy a Vault Key for two diamonds to open your world's optional two-question challenge. Vault attempts cost no HP and can be retried. Your balance, equipped cosmetics, and vault clear are saved separately for each hero and world.

Choose **One Life** when creating a hero to start with 100 HP and one healing potion. A wrong multiple-choice answer, failed trial, or rejected full code submission costs 5 HP. Written GM reviews, practice runs, saved drafts, and runner outages are safe. Open **Trials** to attempt your world's two-question challenge. The first trial clear, Forge clear, or special encounter win earns a potion. Each potion restores up to 20 HP. A hero who reaches zero HP can still read and save drafts. Create or load another hero to submit again.

| World | Levels | What you practice |
| --- | ---: | --- |
| 1 · JavaScript | 14 | Language foundations, data validation, state, and asynchronous work |
| 2 · TypeScript | 14 | Types, runtime boundaries, generics, and typed APIs |
| 3 · C# and .NET | 18 | Console apps, validation, models, LINQ, JSON, async, and a tested capstone |
| 4 · Rust | 42 | Ownership, API design, concurrency, unsafe Rust, and systems design |
| 5 · Go | 14 | Foundations, interfaces, error handling, cancellation, and worker pools |

**C# and .NET for Beginners** targets the .NET 10 LTS SDK. Use the Lantern Workshop's GM checkpoints, trials, goblin questions, and Vault to practice. The game saves C# code drafts for Forge self-review. Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0), then extract the field kit from the World Map. The kit includes expected output and starter files. Run the first example from the extracted directory with the following command.

```powershell
dotnet run --file examples/level-01.cs --property:PublishAot=false
```

With this option the example uses the installed SDK without restoring native publishing tools.

## Windows desktop

Run `CodingDungeonsSetup.exe` and open **Coding Dungeons** from Start. The packaged app opens its own window and keeps SQLite saves in per-user app data. The Help menu provides runtime diagnostics and save import and export. Desktop backups include hero progress, unsent drafts, and reading positions. Import restores into empty worlds and keeps existing heroes intact. The desktop build includes the local GM model and can grade written questions with reviewed rubrics. The Go and Rust runners become available after the Windows isolation probe passes.

**Rust runner offline** means the app cannot use its local Rust compiler and sandbox to grade code. You can still read, save drafts, and answer multiple-choice questions. Runner outages cost no HP. In the desktop app, **Help → Runtime diagnostics** shows whether the compiler files are included and why the runner could not start.

### Security and offline use

The full Windows installer contains the game, books, programming tools, and Game Master model. Once you have the installer, installation, reading, and grading work offline. The installer copies the Qwen3-0.6B Q8_0 model into the game’s runtime folder. The model file is about 639 MB (610 MiB). The local GM opens it with llama.cpp when it evaluates a written answer. External book links open in your browser when selected. Building a release requires obtaining the pinned runtime files and development packages.

Setup writes the program to your local AppData and registers its shortcuts and uninstall entry for your Windows account. The game stores progress and drafts in per-user AppData. The Rust and Go runners create temporary AppContainer profiles and temporary access rules for their own tools and scratch folders. The runner cleans up on normal completion. An abrupt termination can leave temporary entries or files behind.

Running code carries risk. The Windows sandbox and WebAssembly limits reduce what submitted code can access. Bugs in the OS, toolchain, or runner can still affect isolation. The app includes this notice under **Help → Security and offline use**. See the [security review](docs/SECURITY-REVIEW.md) for details about the controls and their limits.

Version 1.0.16 replaces the embedded QuickJS runtime used for JavaScript and TypeScript in the desktop, PWA, and Android editions. The rebuild includes upstream fixes for resizable-buffer issues #492 and #478, plus a local guard against a 32-bit allocation overflow reported in #535. The patched runtime is included in the application; it is not downloaded during play. See the [pinned sources, build instructions, and provenance](vendor/quickjs/README.md). These fixes address the identified defects; they do not remove the need to keep the operating system and browser/WebView updated.

## Browser development

The browser and desktop builds share the React reader in `src/renderer`. Install Node.js 24 or newer, then run these commands from the project folder.

```sh
npm ci
npm start
```

Open [the reader](http://127.0.0.1:4173/), choose a world, and create or load a hero. Use **A** and **D** or the arrow keys to turn pages. The **World map** links to levels, the PDF, and the field kit for the current world.

Heroes and answers are saved in local SQLite databases under `state/`. The reader includes built book assets, so starting it requires no PDF build.

JavaScript and TypeScript grade locally in the browser build's Node engine. Rust and Go use the staged Windows sandbox. To enable both in the browser build, set `DUNGEONS_NATIVE_RUNNER_DIR` to the `desktop/runtime/standalone-runner` directory after staging it. For optional developer model paths, see [.env.example](.env.example).

## Develop

```sh
npm test
npx playwright-core install chromium
npm run test:browser
npm run test:book
```

The book test uses the pinned Rust toolchain, Python 3, and a host linker. Go reference checks use Go 1.27.4. See the [standalone app PRD](docs/CODING-DUNGEONS-PRD.md) for the release test matrix.

The GitHub Actions **Build & Test** workflow runs on pushes to `main` and `release/**`, on pull requests, and through manual dispatch. **Application Tests** checks advisories, app/browser behavior, a lightweight Windows package, and book assets. **Rust Book Compatibility** checks the examples, labs, and challenge suites independently on Rust 1.99.1 and 1.100.0. The existing `verify` check now requires both jobs to pass. See [CI jobs and required checks](docs/CI.md).

### Project agent kit

The [agent kit](agent-kit/README.md) contains reusable project skills, eight agent role briefs, a repository map, and a validation matrix. Start with its catalog and assign only the roles needed for the task. Run `node agent-kit/scripts/validate.mjs` to check its structure and links. The kit is stored in the repository; it does not change global agent configuration.

### Mobile edition

The optional mobile Rust compiler is a local experimental prototype. Public distribution of a Rust-enabled build is blocked on matching component notices and exact compiler source provenance; see [mobile Rust status and validation](docs/MOBILE-RUST.md).

The installable web app includes JavaScript, TypeScript, C#, Rust, and Go. Use **Change world** from the hero picker or campaign menu. Download each world you want to read offline. Heroes, progress, and drafts stay on the device and are separate for each world. Use **Save backup** to export a world's saves or import them into an empty save for that same world.

```powershell
npm.cmd ci
npm.cmd run mobile:build
npm.cmd run mobile:preview
```

Open `http://127.0.0.1:4174/` in a PC browser. For Android Studio, start an Android virtual device, keep the preview running, and run the following in a second PowerShell window.

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
& $adb -e reverse tcp:4174 tcp:4174
& $adb -e shell am start -a android.intent.action.VIEW -d http://localhost:4174/
```

In Android Chrome, choose **Download World 1** and wait for **World 1 ready offline**. Chrome's menu can add the app to the home screen. Use **World** to read and **GM** to submit answers. The bottom bar turns pages, and the three-dot menu holds the map, hero actions, zoom, and saves. Once the download finishes, disconnect and reopen the same address to test offline play.

For a physical phone, serve `dist/mobile/` at the root of an HTTPS origin. Open the installed Home Screen app before downloading worlds or creating heroes, especially on iPhone where the installed app has its own storage. Download each world before going offline. Browser storage can be cleared by the user or the operating system, so export a backup if you want to keep your hero. To pick up a new build, close the installed app and any open tabs at that address, then reopen it online.

| Mobile workbench | How it runs |
| --- | --- |
| JavaScript | QuickJS runs the supplied tests inside a Web Worker. |
| TypeScript | The pinned TypeScript compiler checks the submission and type contracts. QuickJS runs the emitted JavaScript against the suite. |
| C# | Authored choice grading, code drafts, and Forge self-review work offline. Run code from the field kit with a separate .NET 10 SDK. |
| Rust | With the optional experimental pack, Rust 1.96.0-dev compiles submissions and tests locally to WebAssembly. Each test uses a fresh WASI instance. The book and desktop target remain Rust 1.99.1; newer features may be unavailable on mobile. Without the pack, books, prompts and drafts remain available. |
| Go | With the optional pack, the pinned Go 1.27.4 compiler and linker run as WebAssembly in a worker. The linked program runs against the suite with a fresh WASI instance for each test. |

On the build machine, install Go 1.27.4 or point the `GO` environment variable at that release's executable. Stage the Go pack before building the mobile edition.

```powershell
npm.cmd run mobile:stage-go
npm.cmd run mobile:build
```

The Go compiler pack adds about 92 MiB before HTTP compression. In the build that includes it, **Download World 5** saves the complete pack alongside the book. Go challenges use the bundled standard-library subset. The mobile GM reviews written responses with authored rules. Submissions and feedback stay on the device.

Stage the experimental browser Rust toolchain before building:

```powershell
npm.cmd run mobile:stage-rust
npm.cmd run mobile:build
```

The staging command downloads checksum-pinned compiler artifacts from GitHub on the build machine. The pack adds about 152 MiB before HTTP compression. **Download World 4** then saves that pack and the book for offline use. Learner code stays on the device. No Cargo packages, compiler updates or remote grading services are fetched at runtime. See [mobile Rust implementation and limitations](docs/MOBILE-RUST.md), including compiler compatibility and memory measurements. This experimental pack is not a guarantee of support on 2 GB phones or iPhone.

Run `npm.cmd run test:mobile` for the phone-size Chromium regression test. It uses the real browser grader, service worker, and IndexedDB.

Run `npm.cmd run test:mobile:rust` for all Rust exercise references and starters plus compiler and sandbox checks. Set `FERRUM_MOBILE_REQUIRE_RUST=1` to require the staged pack rather than explicitly skip when it is missing.

To run the same test in emulator Chrome, finish Chrome's welcome screens first and set `FERRUM_ADB` to the adb path above and `FERRUM_ANDROID_EMULATOR` to the emulator ID shown by `adb devices`. The test uses a temporary local port and save origin.

### Android app

The private Android APK bundles all five books and the four available Workbench runtimes. Install it and open **Coding Dungeons**, then choose a world and create a hero. Worlds show **included offline**: reading, saving drafts, and supported grading run without a server, world download, or Internet connection. The Android GM uses the mobile edition's authored rules. External documentation links can open your browser, which may need an Internet connection.

The wrapper uses Android System WebView and requests neither Internet nor storage permissions. Heroes and drafts stay in the app's private storage. **Save backup** uses Android's document picker to export a world or import into an empty world. Export important saves before uninstalling or clearing app storage; browser/PWA saves and APK saves are separate. The app targets Android 8.0 and later with a compatible WebView. Support on 2 GB phones is not verified.

Version 1.1.1 is a private local build. Its experimental Rust compiler has the same compatibility and redistribution limits as the browser edition: public distribution remains blocked pending complete component notices and verified source provenance. See [mobile Rust limitations](docs/MOBILE-RUST.md).

On Windows, install Android Studio with SDK Platform 37.0 and Build-Tools 36.0.0. The build script uses Android Studio's bundled JDK and the default SDK location; set `JAVA_HOME` and `ANDROID_HOME` if yours differ. Stage both compiler packs, then build:

```powershell
npm.cmd run mobile:stage-go
npm.cmd run mobile:stage-rust
npm.cmd run android:build
```

The command rebuilds the mobile assets, runs Android unit tests and lint, and creates `android/app/build/outputs/apk/release/app-release.apk`. Initial dependency and compiler downloads require Internet on the build machine. The local signing key lives outside the repository at `%LOCALAPPDATA%\CodingDungeonsBuild\android\local-release.p12`, with password metadata protected by Windows DPAPI for the current account. Preserve that signing identity for future updates; it is not a disposable build output. Install later versions over the existing app using the same key to retain saves.

For emulator tests, build and install the separate debug package, then run the actual WebView journeys:

```powershell
$env:FERRUM_ADB = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$env:FERRUM_ANDROID_EMULATOR = 'emulator-5554' # Use the serial from adb devices.
npm.cmd run android:build:test
& $env:FERRUM_ADB -s $env:FERRUM_ANDROID_EMULATOR install -r android/app/build/outputs/apk/debug/app-debug.apk
npm.cmd run test:android
```

The test package is `com.codingdungeons.app.test`, separate from the normal app. Tests exercise the packaged worlds, correct and wrong submissions, HP, saved progress, and request boundaries. They stop only that test app and remove their own debugger forwarding port; they do not clear saves or use a host web server.

The native document tests use a provider included only in the instrumentation APK. They exercise saved bytes, cancellation, retries, concurrent operations, oversized imports, read-only snapshots, and actual WebView file-input reads. Run them on an emulator with:

```powershell
$env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
& ./android/gradlew.bat -p android :app:connectedDebugAndroidTest
```

### Windows build

On Windows x64, stage the local model with `pwsh -File desktop/stage-gm-runtime.ps1` and follow the [native runner build instructions](native/README.md) if `desktop/runtime` is missing. Keep those staged files for later builds. Install dependencies with `npm.cmd ci` on a fresh checkout.

For the desktop smoke test, set `FERRUM_DESKTOP_TEST_PACKAGE=1` before running `npm.cmd run desktop:package` and `npm.cmd run test:desktop`. With the full runtime staged, set `FERRUM_DESKTOP_REQUIRE_NATIVE=1` and `FERRUM_DESKTOP_REQUIRE_GM=1` to exercise all four runners and the offline GM. Clear the test-package variable before making an installer.

To build a new update from an already released version, bump the version and make a Windows installer. Run the following in PowerShell from the project folder.

```powershell
$installerTemp = Join-Path $env:USERPROFILE 'cdtmp'
New-Item -ItemType Directory -Path $installerTemp -Force | Out-Null
$env:TEMP = $installerTemp
$env:TMP = $installerTemp
$env:SQUIRREL_TEMP = $installerTemp
npm.cmd version patch --no-git-tag-version
npm.cmd run desktop:make
```

The release build requires a trusted Authenticode signing identity and access to an RFC 3161 timestamp server at build time. Set `FERRUM_WINDOWS_CERTIFICATE_THUMBPRINT` for a code-signing certificate in the current user's certificate store, or set `FERRUM_WINDOWS_CERTIFICATE_FILE` and, when needed, `FERRUM_WINDOWS_CERTIFICATE_PASSWORD` for an external PFX. Set `FERRUM_WINDOWS_SIGNTOOL` to the Windows SDK SignTool path if it is outside `PATH`. Keep signing credentials outside the project. For a private test build, set `FERRUM_ALLOW_UNSIGNED_INSTALLER=1` before running the maker. Its output is named `CodingDungeonsSetup-local.exe`. Installed copies use the bundled runtimes and work offline.

Close the installed app and run `out\make\squirrel.windows\x64\CodingDungeonsSetup.exe`. Use a version higher than the installed one and keep the same app identity. The installer replaces the application files and uses the existing saves in `%APPDATA%\Coding Dungeons\state`. Build outputs and staged runtimes stay outside Git.

See [book sources and rebuild instructions](docs/BOOK-BUILD.md), [the four-world audit](docs/BOOK-AUDIT.md), and [findings from the follow-up review](docs/REVIEW-FINDINGS.md).
