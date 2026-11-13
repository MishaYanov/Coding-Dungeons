# Coding Dungeons Windows Desktop Migration PRD

> The [standalone app PRD](CODING-DUNGEONS-PRD.md) sets the current release scope for Code Workbench, all four grading runtimes, Hard Mode, and the offline LLM GM. This note records the original desktop migration design.

**Status** · Draft for review  
**Date** · November 7, 2026

## Product goal

A player downloads one Windows installer, launches Coding Dungeons from Start, and chooses JavaScript, TypeScript, Rust, or Go. All four books, the Game Master, hero progression, creature encounters, and automated Rust grading work offline from the first launch. A player moving from the browser reader can bring their heroes and pick up where they left off.

The first desktop release uses **React with TypeScript and Vite** for the reader, **Electron** for the Windows app, and **Electron Forge with Squirrel.Windows** for a per-user installer. The proposed download is `CodingDungeonsSetup.exe`. It installs `Coding Dungeons.exe` and a Start menu shortcut named **Coding Dungeons**. [Vite guide](https://vite.dev/guide/) · [Electron Forge Windows installer](https://www.electronforge.io/config/makers/squirrel.windows)

## Starting point

The current app has 84 levels across four worlds. JavaScript, TypeScript, and Go have 14 each. Rust has 42. The built content includes 718 book page images, four PDFs, and four field-kit ZIPs. A local Node server serves the reader and stores progress in separate SQLite databases per world. The Canvas renderer animates the creatures. Rust grading uses the Windows sandbox. [Project README](../README.md) · [Book assets and build](BOOK-BUILD.md) · [Grader implementation](../lib/standalone-runner.mjs)

## Framework choice

| Option | Fit for Coding Dungeons |
| --- | --- |
| **React and Electron** | Keep the DOM book reader, CSS layout, and Canvas encounters. Electron bundles Chromium and Node, so the existing Node engine can run alongside the React UI. The tradeoff is a larger download and a recurring Electron patch cycle. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) |
| **React and Tauri** | Keep the React reader and use Windows WebView2. Preserving the current engine would require packaging and supervising a Node sidecar and validating offline WebView2 installation. Revisit if the first package misses its size or startup targets. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/) · [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/) |
| **React Native for Windows** | Native controls are an option if they become a product requirement. The current HTML book layout and Canvas encounters would need native equivalents or a WebView, and the Node engine would still need separate integration. [React Native Windows](https://microsoft.github.io/react-native-windows/) · [React Native components](https://reactnative.dev/docs/intro-react-native-components) |

## Player requirements

1. **Install and launch.** Target Windows 11 Home and Pro x64. A standard user can install from the single setup file with the network disconnected. Include the renderer, Node engine, all game and book assets, the private Rust grading runtime, app icon, and license notices. The installed app opens in its own window. Play and grading require no separate browser, toolchain, environment file, or account.
2. **Choose a world and hero.** A normal Start menu launch opens the picker with all four worlds visible in order. Within a world, create or load a local hero. Explain what each path covers and who it suits before the player commits. Resume the selected hero's saved page and keep world progress separate, even when heroes share a name.
3. **Read and turn pages.** Keep the book on the left and the GM on the right. Use a stacked layout when the window is too narrow for both panels. Support **A** and **D**, arrow keys, and visible page controls. Suspend page shortcuts while the player types, uses an input method, or works in a dialog. Keep the world map, chapter jumps, PDF, and field kit available offline. Use a Windows save dialog for PDFs and ZIPs.
4. **Play through the GM.** Show choices for multiple-choice questions and a code editor for coding challenges. Preserve drafts, hints, feedback, and guided review. Update the character sheet, skills, and XP after the save succeeds. Award completion once and play the creature defeat animation once per newly cleared challenge. Support reduced motion and a visible cleared state. Preserve the Rust Level 3 Ironbound Scarab and JavaScript Level 12 Stolen Signal, including mid-encounter resume.
5. **Run Rust tests offline.** Grade all 14 Rust exercises from the installed app. Show compilation diagnostics and per-case results in the GM. Only a passing run clears an automatically graded challenge. JavaScript, TypeScript, and Go use guided code review.
6. **Manage local progress.** Offer import at first run and from Settings, alongside save backup and recovery. Upgrading or uninstalling and reinstalling keeps the saved heroes. Show the app version and local save location in Settings so players can find support information and their data.

## Desktop architecture

Use React components for the world picker, hero and path flow, book reader, GM, map, and character sheet. Wrap the existing Canvas drawing code in a React component with an explicit animation lifecycle. Keep world definitions, books, grading rules, and persistence in shared modules. The React build also serves the browser edition through the existing `npm start` entry point during rollout. Preserve existing world URLs and legacy Rust bookmarks there.

Electron's main process owns the window, installer events, single-instance lock, and native dialogs. It supervises the Node engine in an Electron utility process. The engine serves the built React app and existing APIs on an OS-assigned port bound to `127.0.0.1`. A dedicated Electron session injects a per-launch secret only for the exact app origin. The server checks the secret and expected `Host` before serving app assets or APIs and rejects foreign origins on state-changing requests. On quit, the engine cancels active grading jobs and closes the databases before it exits. Book assets resolve from packaged resources, and game data resolves from a separate writable directory. [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)

Keep the renderer sandboxed with context isolation and Node integration disabled. Restrict navigation and popups to the intended window flow. Open approved external documentation links in the default browser after a user action. Use narrow, validated preload methods for file dialogs and similar desktop operations. Compile with a restrictive content security policy. Stage only release assets and the private runtime for grading. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

Pin a supported Electron release during implementation. The first packaged build must load `node:sqlite`, open and migrate each world database, and launch from a directory with spaces. Test the packaged build before committing to the React migration because it uses Electron's embedded runtime and resource layout. [Electron stable releases](https://releases.electronjs.org/?channel=stable) · [Node SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

## Save migration and recovery

- **Storage.** Use a stable app identity and put saves under Electron's `userData` directory, with databases in its `state` subfolder. Persist desktop drafts, reading position, and preferences through the engine so they survive relaunch on a different loopback port. Keep backups and migration metadata in per-user app data. [Electron application paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
- **Existing saves.** Accept the user's legacy `state` folder or let them select the Rust database if they used a custom `FERRUM_DB` path. Resolve its companion world files using the existing naming rule. Recognize the default `ferrum.sqlite`, `ferrum.javascript.sqlite`, `ferrum.typescript.sqlite`, and `ferrum.go.sqlite` names. Snapshot with SQLite's backup API so committed changes in write-ahead logs come across. Stage the snapshots, validate schema and integrity, and preserve hero IDs, progress, responses, attempts, and encounter checkpoints. Keep the source as a rollback copy. [Current database layout](../server.mjs) · [SQLite backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsource-db-path-options)
- **Browser-only changes.** Add a versioned export in the browser edition for drafts and reading positions that have yet to sync, using the browser profile and URL where they were written. The desktop import validates size, version, world, hero ID, and page before applying these records to matching imported heroes. If a draft differs on both sides, show the conflict and let the player choose. [Existing browser storage](../src/renderer/game.mjs)
- **Conflicts and recovery.** Preview the source and affected worlds before activation. Import into empty worlds and report any skipped worlds that already contain heroes. Repeating an import cannot duplicate heroes. Back up the destination before schema changes or an explicit restore. A corrupt input or interrupted migration leaves the last good save available. Settings can export a portable backup and restore it with an explicit confirmation and a preview of the worlds it replaces.

## Rust grading and the offline bundle

Bundle the pinned Rust compiler, linker, WASI standard library, tests, and Wasmtime runtime. A Windows broker confines the compiler and execution worker separately. The installed grader runs offline without Docker or other developer software. Level 20 keeps its admission and permit objectives, with an installed check for deterministic interleavings and a native thread test in developer CI. The full design defines the sandbox, compatibility gates, and installer contents. [Standalone Rust grader design](STANDALONE-RUST-GRADER-DESIGN.md)

## Installer and distribution

Use a stable Windows app identity across versions. Handle Squirrel installer events before starting the engine or opening saves. Install per user, add the Start menu shortcut, and register uninstall with Windows. A newer setup file upgrades the same installation. Keep save data by default on uninstall, and verify that reinstall picks it up. [Squirrel.Windows setup and lifecycle](https://www.electronforge.io/config/makers/squirrel.windows)

Build the Windows installer in CI from pinned dependencies. Publish a signed setup file, a SHA-256 checksum, and release notes to GitHub Releases once the release owner is selected. Include the project's Apache 2.0 license and the bundled dependencies' required notices in the package. Sign and timestamp the executables and installer before public release. SmartScreen can still warn on a newly distributed signed file, so document how a player can verify the publisher. For the first release, updates are installed by running the newer setup file. [Electron Forge signing](https://www.electronforge.io/guides/code-signing/code-signing-windows) · [Microsoft SmartScreen reputation](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

## Implementation milestones

1. **Package a working slice.** Package a React world picker, one book page, a creature, and one save operation. Prove embedded SQLite, offline setup, launch and shutdown, and resource paths on a clean Windows VM. In the same milestone, prove that the pinned compiler and Wasmtime can grade a submission under Windows isolation. Record installer size and startup time before expanding scope.
2. **Reach reader parity.** Move the hero and path flows, reader, GM, character sheet, and map to React in slices. Reuse the engine contracts. Run the browser regression suite as each flow moves, then verify all four worlds in the desktop window.
3. **Protect existing saves.** Add the import and recovery workflow, browser export, and stable desktop state. Test a prior-version fixture, a live legacy database with committed WAL data, a partially cleared encounter, and migration interruption.
4. **Build the release candidate.** Run the standalone grader release gates, including all 14 graded exercises and hostile submission tests. Validate signed manual upgrades, uninstall and reinstall, support instructions, and the distribution bundle. Record known compatibility limits in the release notes. [Grader release gates](STANDALONE-RUST-GRADER-DESIGN.md#implementation-and-release-gates)

## Release acceptance

Keep the existing unit, API, progression, browser, and book checks in CI using `npm test`, `npm run test:browser`, `npm run test:book`, and `python verify-worlds.py`. Add React interaction tests and desktop tests against the packaged build. Use a clean Windows 11 x64 VM for installer acceptance as a standard user. [Current verification workflow](../.github/workflows/verify.yml)

| Scenario | Pass condition |
| --- | --- |
| Offline first install | With the network disconnected and no developer tools or Docker installed, setup succeeds and the Start menu launch shows all four worlds. Every bundled page is present and each world's PDF and ZIP can be saved and opened. |
| Hero and navigation | Create and reload a hero in each world. Path descriptions appear before selection. Reopen the saved page and verify A/D, arrow keys, inputs, modals, reduced motion, and narrow window layout. |
| Gameplay parity | A choice question, guided review, and both special encounters persist across restart. Repeating a submission or reopening a cleared page cannot award extra XP or replay the defeat as a new clear. |
| Rust runner | On a clean Windows 11 Home or Pro x64 machine, all 14 graded exercises run on first use with the network disconnected and only the installer provided. Passing, failing, compilation errors, timeouts, and cancellation preserve the expected draft and progression state. |
| Save migration | Import all four worlds from fixtures containing overlapping hero names, WAL changes, a browser-only draft, and a partial encounter. Verify visible progress against the old reader. Repeat the import and test a corrupt input and interruption. |
| App lifecycle | A second launch focuses the current window. Closing the app during a Rust run terminates the compiler and execution jobs. A signed upgrade and an uninstall followed by reinstall preserve the save set and keep the shortcut working. |
| Security | A separate browser cannot use desktop APIs without the launch secret. Block foreign origins, unauthorized navigation, and arbitrary file paths through desktop dialogs. Verify the publisher signature and checksum. |

Proposed release targets with the bundled grader are a setup file under **500 MiB**, an installed app under **1.5 GiB** excluding saves and backups, and a median cold launch to the world picker under **5 seconds** over five launches on a Windows 11 x64 VM with 4 vCPUs, 8 GiB RAM, and SSD-backed storage. Record measurements from the first package and use them to confirm or revise the targets before release.

## Decisions before release

- **Distribution.** Choose the GitHub release audience and the signing provider or certificate owner. Start with Windows 11 x64. Windows on ARM, older Windows support, and store distribution each require a separate test plan.
- **Future platforms.** Keep mobile, macOS, Linux installers, cloud accounts, and new JavaScript, TypeScript, or Go execution engines outside this release.
