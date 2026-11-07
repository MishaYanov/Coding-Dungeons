# Coding Dungeons

Play through four programming books in a local game reader. Read the book on the left, then use the Game Master on the right for quizzes, coding challenges, hints, and debriefs. Your character sheet tracks XP, skill levels, and path progress.

| World | Levels | What you practice |
| --- | ---: | --- |
| 1 · JavaScript | 14 | Language foundations, data validation, state, and asynchronous work |
| 2 · TypeScript | 14 | Types, runtime boundaries, generics, and typed APIs |
| 3 · Rust | 42 | Ownership, API design, concurrency, unsafe Rust, and systems design |
| 4 · Go | 14 | Foundations, interfaces, error handling, cancellation, and worker pools |

## Play locally

Install Node.js 24 or newer, then run these commands from the project folder.

```sh
npm ci
npm start
```

Open [the reader](http://127.0.0.1:4173/), choose a world, and create or load a hero. Use **A** and **D** or the arrow keys to turn pages. The **World map** links to levels, the PDF, and the field kit for the current world.

Heroes and answers are saved in local SQLite databases under `state/`. The reader includes built book assets, so starting it requires no PDF build.

JavaScript, TypeScript, and Go challenges use guided review. Rust also offers automated grading with a local Linux Docker engine and the `rust:1.99.1-slim-bookworm` image. See [the local setup guide](README.txt) for details.

## Develop

```sh
npm test
npx playwright-core install chromium
npm run test:browser
npm run test:book
```

The book test runs the Rust examples with the toolchain pinned in `rust-toolchain.toml`. It needs Python 3 and a host linker. GitHub Actions runs the test suites and validates the book assets on Windows.

See [book sources and rebuild instructions](docs/BOOK-BUILD.md), [the four-world audit](docs/BOOK-AUDIT.md), and [findings from the follow-up review](docs/REVIEW-FINDINGS.md).
