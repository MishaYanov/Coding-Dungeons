---
name: book-authoring
description: Author or revise Coding Dungeons lessons, campaigns, examples, and published book assets while keeping field kits and saved learning progress aligned.
---

# Book Authoring

Read the relevant [repository map](../../references/repository-map.md) and [validation matrix](../../references/validation-matrix.md), then use `docs/BOOK-BUILD.md` for the current build commands.

## Edit the authored source

- Rust: technical chapters, appendices, and host labs live in `work/manuscript`; campaign scenes and route material live in `work/gamebook`. Checkpoints live in `data/checkpoints.json`. The exercise authoring script is `work/ferrum-exercise-author.py`.
- JavaScript, TypeScript, C#, and Go: edit `data/worlds/<world>/source.json`, then rebuild that world. Generated campaign/page JSON, PDFs, WebP pages, and text editions are not independent manuscripts.
- Match the specified audience. State an invariant, demonstrate the mechanism, challenge it with a failure, and explain the remaining obligations. Avoid adding syntax tutorials to an advanced lesson merely to increase page count.
- Use primary sources for precise language rules and current API claims. Keep compiler release, language edition, and runtime target distinct.

## Preserve identities and promises

- Keep existing prompt IDs, exercise IDs, and Rust listing indices stable when revising a released book. Adding an earlier code fence can renumber later listings, including intentionally rejected ones.
- Preserve the meaning of saved assessment questions unless their rubric and answer revision handling are deliberately updated.
- Pagination may change. The Rust reader's generated `data/reading-revisions.json` aliases named prompts and dynamic repair stages to current pages. Check that aliases terminate directly, prefer current answers, and retain newer empty replacements.
- Generic page notes and reading positions retain numeric page identity. Do not promise semantic relocation for them.
- Keep loadouts advisory where authored. Provide prerequisite/manual links without silently turning thematic paths into locked progression.

## Build useful evidence

- Classify listings as complete Rust units, expected rejections, or sketches. Label host-thread and runtime-dependent programs honestly; WASI guests do not supply ordinary OS threads or networking.
- Give new executable lessons assertions that exercise their advertised behavior. Use deterministic synchronization or controlled clocks for races, deadlines, and shutdown; avoid timing-only demonstrations.
- Check a reference, its broken starter, and a plausible faulty variant where a challenge is meant to discriminate. Keep public examples distinct from the full required suite.
- `work/scripts/check_book_toolchains.py` validates authored Rust units, runnable programs, and game challenge suites against selected toolchains. Read its current defaults rather than copying a version number into instructions indefinitely.
- These host validation scripts run trusted repository-authored programs. Do not route learner submissions through them; learner execution belongs to the isolated runners.

## Publish a coherent edition

Follow the documented build sequence for the affected world. For Rust, package the checked examples and campaign kit before copying the final PDF into the reader. The kit's validation record must match the edited sources.

After the PDF is final:

1. Verify navigation, field-kit attachment, form fields, prompt bindings, and expected listing labels.
2. Render and inspect changed pages, diagrams, code continuations, and filled forms; text extraction alone cannot reveal clipping or orphaned cues.
3. Regenerate WebP pages and `reader-text.json`, then verify that both refer to the current PDF revision.
4. Check the affected API/mobile notebooks, path links, and saved-work compatibility. A new host lab must not acquire a fake in-game test clear.

Handoff the source edits, generated artifacts, preserved identities, validation results, visual evidence, and any target-specific limitations. Coordinate rebuilding after parallel editors freeze their files.
