# Coding Dungeons

Play through four programming books in a local game reader. Read the book on the left, then use the Game Master on the right for quizzes, coding challenges, hints, and debriefs. Your character sheet tracks XP, skill levels, and path progress.

Open **Code Workbench** on a graded challenge. Run Examples to practice, then Submit solution to run the required suite. Passing the full suite defeats the creature and saves Forge progress. Choose Hard Mode to lock hints, suggestions, and example answers for the encounter and earn an unaided clear. Project review pages keep the book's design work alongside the executable drills.

In a code editor, **Tab** inserts four spaces. Press **Escape**, then **Tab** to move focus forward. On selected Guided challenges, **Show code suggestion** offers an authored snippet you can apply or undo.

The World Map also links to special encounters. Break the Ironbound Scarab's three locks in Rust Level 3, or diagnose, reproduce, and repair a stale-request bug in JavaScript Level 12. Each step is saved for your hero.

Watch the book for a hidden diamond. It can turn up on any kind of page. Click it to face the Diamond Goblin, then beat a coding challenge and a multiple-choice question to claim its bag of three diamonds. Your character sheet shows the loot. Each hero can clear the ambush once per world.

Choose **One Life** when creating a hero to start with 100 HP and one healing potion. A wrong scored answer, failed trial, or failed full code submission costs 5 HP. Practice runs, saved drafts, and runner outages are safe. Open **Trials** to attempt your world's two-question challenge. The first trial clear, Forge clear, or special encounter win earns a potion. Each potion restores up to 20 HP. A hero who reaches zero HP can still read and save drafts. Create or load another hero to submit again.

| World | Levels | What you practice |
| --- | ---: | --- |
| 1 · JavaScript | 14 | Language foundations, data validation, state, and asynchronous work |
| 2 · TypeScript | 14 | Types, runtime boundaries, generics, and typed APIs |
| 3 · Rust | 42 | Ownership, API design, concurrency, unsafe Rust, and systems design |
| 4 · Go | 14 | Foundations, interfaces, error handling, cancellation, and worker pools |

## Windows desktop

Run `CodingDungeonsSetup.exe` and open **Coding Dungeons** from Start. The packaged app opens its own window and keeps SQLite saves in per-user app data. The Help menu provides runtime diagnostics and save import and export. The desktop build includes the local GM model and can grade written questions with reviewed rubrics. The Go and Rust runners become available after the Windows isolation probe passes.

**Rust runner offline** means the app cannot use its local Rust compiler and sandbox to grade code. You can still read, save drafts, and answer multiple-choice questions. Runner outages cost no HP. In the desktop app, **Help → Runtime diagnostics** shows whether the compiler files are included and why the runner could not start.

### Security and offline use

The full Windows installer contains the game, books, programming tools, and Game Master model. Once you have the installer, installation, reading, and grading work offline. The installer copies the Qwen3-0.6B Q8_0 model into the game’s runtime folder. The model file is about 639 MB (610 MiB). The local GM opens it with llama.cpp when it evaluates a written answer. External book links open in your browser when selected. Building a release requires obtaining the pinned runtime files and development packages.

Setup writes the program to your local AppData and registers its shortcuts and uninstall entry for your Windows account. The game stores progress and drafts in per-user AppData. The Rust and Go runners create temporary AppContainer profiles and temporary access rules for their own tools and scratch folders. The runner cleans up on normal completion. An abrupt termination can leave temporary entries or files behind.

Running code carries risk. The Windows sandbox and WebAssembly limits reduce what submitted code can access. Bugs in the OS, toolchain, or runner can still affect isolation. The app includes this notice under **Help → Security and offline use**. See the [security review](docs/SECURITY-REVIEW.md) for details about the controls and their limits.

## Browser development

The browser and desktop builds share the React reader in `src/renderer`. Install Node.js 24 or newer, then run these commands from the project folder.

```sh
npm ci
npm start
```

Open [the reader](http://127.0.0.1:4173/), choose a world, and create or load a hero. Use **A** and **D** or the arrow keys to turn pages. The **World map** links to levels, the PDF, and the field kit for the current world.

Heroes and answers are saved in local SQLite databases under `state/`. The reader includes built book assets, so starting it requires no PDF build.

JavaScript and TypeScript grade locally in the browser build's Node engine. Rust can also use a local Linux Docker engine and the `rust:1.99.1-slim-bookworm` image in that build. Go uses the staged Windows sandbox. For optional developer model paths, see [.env.example](.env.example).

## Develop

```sh
npm test
npx playwright-core install chromium
npm run test:browser
npm run test:book
```

The book test uses the pinned Rust toolchain, Python 3, and a host linker. Go reference checks use Go 1.25.1. See the [standalone app PRD](docs/CODING-DUNGEONS-PRD.md) for the release test matrix.

On Windows x64, stage the local model with `pwsh -File desktop/stage-gm-runtime.ps1` and follow the [native runner build instructions](native/README.md) if `desktop/runtime` is missing. Keep those staged files for later builds. Install dependencies with `npm.cmd ci` on a fresh checkout.

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

Close the installed app and run `out\make\squirrel.windows\x64\CodingDungeonsSetup.exe`. Use a version higher than the installed one and keep the same app identity. The installer replaces the application files and uses the existing saves in `%APPDATA%\Coding Dungeons\state`. Build outputs and staged runtimes stay outside Git.

See [book sources and rebuild instructions](docs/BOOK-BUILD.md), [the four-world audit](docs/BOOK-AUDIT.md), and [findings from the follow-up review](docs/REVIEW-FINDINGS.md).
