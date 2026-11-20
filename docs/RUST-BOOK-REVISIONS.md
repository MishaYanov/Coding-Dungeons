# Rust book revision — November 20, 2026

The 1.1.1 edition addresses the structured book review and the subsequent editorial pass.

| Finding | Revision |
| --- | --- |
| Dense or awkward sentences | Copyedited all 42 chapters and both appendices, preserving the technical meaning and existing exercise questions. Corrected the malformed RAII definition. |
| Executor demo completed immediately | Chapter 25 now runs a deterministic future through Pending, a wake before waiting, and Ready; it asserts the poll count. |
| Missing worked visual models | Added a Cursor ownership/borrow graph, variance substitution comparison, pinning handle/pointee sketch, and wakeup timeline. |
| Thematic paths skip useful background | PDF loadouts open prerequisite manuals. The reader offers optional background links at level entries and before the next path step; cleared levels are omitted. |
| Components did not have a worked bridge | Added a complete async ownership/shutdown lab and a finite request-to-reconciliation dispatch lab. The final boss remains a reader-built variation. |
| Schedule exploration stayed abstract | Added an executable bounded interleaving model that finds the broken admission/close history and checks the repaired model. Its limits are explicit; it is not a proof of all Rust executions. |
| Naming overstated guarantees | Renamed CommitQueue to DeferredActions. |
| Chapter 42 promised the wrong number of designs | Corrected its count and linked the complementary integration lab. |
| Latest compiler had not been checked | Checked 159 Rust units and ran 127 complete examples/regression programs on both Rust 1.99.1 and 1.100.0, including the authored game suites. CI now checks the newer toolchain as well. |

The book has 571 pages. Three worked labs follow the topic index and are linked from the app's World Map and relevant manual headers. The labs use only the standard library and run on a host Rust toolchain. The async lab uses controlled checkpoints and a logical clock; it does not present itself as a production I/O runtime. The dispatch lab is process-local and does not claim durability or exactly-once delivery.

The field kit contains the new programs, source index, and both compiler validation records. Twelve listings remain intentionally rejected. Every existing Rust listing identity and exercise question is preserved.

## Saved work after pagination changes

Named prompts and dynamic Rust repair stages have explicit aliases from previous pages to their current location. Saved responses, written assessments, and unsent drafts follow those identities. Current-page data takes priority, including deliberately empty replacements. If more than one historical edition exists, the most recent historical page is preferred. Aliases terminate directly at the current page.

This is a read-only compatibility layer: old records are retained. Hero IDs, level progress, HP, rewards, encounter completions, and exercise clears keep their existing identities. Generic page notes retain their numeric page identity, because they have no unique authored prompt to relocate. Reading positions also retain their saved page number.

Regression tests cover desktop SQLite and mobile record lookups, Hard Mode assessment gates, self-review drafts, side-quest carry-forward, current-answer priority, and generated alias targets. The Rust special encounter follows its campaign boss anchor rather than a fixed page number.

## Verification evidence

Detailed compiler, test, layout, and visual-review evidence is retained locally under `work/qa/rust-book-review/` and the campaign QA directory. The PDF checks verify navigation, field-kit attachment, all 171 canonical form fields and widgets, round-trip values, and current listing labels. Visual review covers the contact sheets, representative full-resolution pages, both filled save rooms, and all new diagrams and labs.

The book's 1.100.0 validation does not replace the bundled desktop compiler or experimental mobile compiler. The desktop retains its tested 1.99.1 runtime; mobile retains its separately documented compatibility limits.
