# Coding Dungeons

Play through four programming books in a local game reader. Read the book on the left, then use the Game Master on the right for quizzes, coding challenges, hints, and debriefs. Your character sheet tracks XP, skill levels, and path progress.

Open **Code Workbench** on a graded challenge. Run Examples to practice, then Submit solution to run the required suite. Passing the full suite defeats the creature and saves Forge progress. Choose Hard Mode to lock hints, suggestions, and example answers for the encounter and earn an unaided clear. Project review pages keep the book's design work alongside the executable drills.

The World Map also links to special encounters. Break the Ironbound Scarab's three locks in Rust Level 3, or diagnose, reproduce, and repair a stale-request bug in JavaScript Level 12. Each step is saved for your hero.

| World | Levels | What you practice |
| --- | ---: | --- |
| 1 · JavaScript | 14 | Language foundations, data validation, state, and asynchronous work |
| 2 · TypeScript | 14 | Types, runtime boundaries, generics, and typed APIs |
| 3 · Rust | 42 | Ownership, API design, concurrency, unsafe Rust, and systems design |
| 4 · Go | 14 | Foundations, interfaces, error handling, cancellation, and worker pools |

## Windows desktop

Run `CodingDungeonsSetup.exe` and open **Coding Dungeons** from Start. The packaged app opens its own window and keeps SQLite saves in per-user app data. The Help menu provides runtime diagnostics and save import and export. The desktop build includes the local GM model and can grade written questions with reviewed rubrics. The Go and Rust runners become available after the Windows isolation probe passes.

## Browser development

Install Node.js 24 or newer, then run these commands from the project folder.

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

On Windows x64, stage the local model with `pwsh -File desktop/stage-gm-runtime.ps1`. Stage the native toolchains using [the native runner build instructions](native/README.md). Then run `npm run desktop:make`. The setup is under `out/make/squirrel.windows/x64/`. Runtime files and generated installers stay outside Git.

If the Squirrel maker reports `PathTooLongException`, point `TEMP`, `TMP`, and `SQUIRREL_TEMP` at a short writable folder in the build shell. To make the installer from an existing app package, run the maker with `--skip-package`.

```powershell
$installerTemp = Join-Path $env:USERPROFILE 'cdtmp'
New-Item -ItemType Directory -Path $installerTemp -Force | Out-Null
$env:TEMP = $installerTemp
$env:TMP = $installerTemp
$env:SQUIRREL_TEMP = $installerTemp
.\node_modules\.bin\electron-forge.cmd make --skip-package --platform=win32 --arch=x64
```

See [book sources and rebuild instructions](docs/BOOK-BUILD.md), [the four-world audit](docs/BOOK-AUDIT.md), and [findings from the follow-up review](docs/REVIEW-FINDINGS.md).
