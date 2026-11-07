THE FERRUM EXPEDITION
Interactive JavaScript, TypeScript, Rust, and Go campaigns

Start on Windows

1. Use Node.js 24 or newer.
2. Open Start_Ferrum.cmd and visit the local address it prints.
   The default is http://127.0.0.1:4173.
3. Choose World 1 JavaScript, World 2 TypeScript, World 3 Rust, or World 4 Go, then
   create or load a hero. Use Worlds in the header to switch languages.
   Add ?world=rust to the address to open the Rust campaign directly.
4. Press A and D to turn the book pages. The arrow keys also work.
   The page keys pause while you type in an editor or use a form or dialog.
   Open the World Map to jump to a level.

On macOS or Linux, run npm start from this project folder.

The book is on the left and the interactive guide is on the right. Choose
an answer for immediate checkpoint feedback, or save a written answer or
code draft. The guide also provides hints, review criteria, and debriefs.
Each world keeps its own heroes, reading positions, drafts, and quest logs.
Open Character sheet to see your hero level, path progress, skills, and
quest log. Each Scout, Forge, or Explain checkpoint gives 1 XP. Complete
all three to finish a level. Skill levels track marks in each subject area.
The printable Rust quest journal uses its own tabletop XP rules.

Code challenges and saved progress

In JavaScript, TypeScript, and Go, save your boss encounter with Save code
notes. Compare your draft with the debrief, then mark
Forge self-review in the Level checkpoint. The field kit includes examples
and starters you can try with Node.js, the TypeScript compiler, or Go.

For automated Rust grading, start Docker Desktop in Linux container mode
or start a local Linux Docker engine, then obtain the compiler image.

  docker pull rust:1.99.1-slim-bookworm

Reload the reader to refresh the runner status. The book, choices, and
draft saving work while the Rust runner is offline.

Pages with runnable exercises show the test names and Run Rust tests.
Keep the starter's public signature, fill in the implementation, and run
the tests. Compiler diagnostics, failed assertions, and pass counts appear
beside the code. A successful run awards Forge for that level. Other code
cards are scratchpads. On a Rust level without tests, use Forge self-review.

Each grading attempt runs in a short-lived local Docker container with
networking disabled and bounded resources. The app listens on loopback.
The GM is designed for personal practice on this device. Written answers
are saved with reference feedback for your own review.

The state folder contains separate SQLite files for JavaScript, TypeScript,
Rust, and Go. Existing Rust heroes use state/ferrum.sqlite. Keep the folder
with the project to retain your progress. Stop the reader with Ctrl+C.

Download the current world's PDF and field kit from its World Map. Each kit
contains code examples and an editable quest journal. It is also available
in the PDF viewer's attachments panel. The local copies are in public/book.

Development and tests

  npm ci
  npm test
  npm run test:browser
  npm run test:book

npm test covers the HTTP API, SQLite, book data, grading protocol and Rust
exercises. It runs the exercises when rustc and a host linker are installed.
Set FERRUM_REQUIRE_RUSTC=1 to require that coverage. The live grading test
runs when the local Linux Docker engine and compiler image are available.
Set FERRUM_REQUIRE_DOCKER=1 to require the Docker check.

The browser tests use installed Chrome or Edge on Windows. Set
FERRUM_BROWSER to choose another Chromium executable, or install a test
browser with npx playwright-core install chromium. The HTTP and browser
suites use throwaway SQLite files and ephemeral loopback ports.

The Rust book suite needs Python 3, Rust 1.99.1 and a host linker. Rustup selects
the pinned version for this project. You can point FERRUM_TEST_RUSTC at
a specific rustc executable for both Rust test suites.

See docs/BOOK-AUDIT.md for the four-world audit and sources, and docs/BOOK-BUILD.md
for rebuilding the PDFs, page images, and GM data from the editable sources.
