---
name: game-engine
description: Implement or review Coding Dungeons encounters, grading outcomes, hero progression, and save behavior across the desktop and mobile engines.
---

# Game Engine

Use the [repository map](../../references/repository-map.md) to locate the authoritative catalog and adapters. Choose focused checks from the [validation matrix](../../references/validation-matrix.md).

## Establish the contract

Read the encounter's authored contract, runner adapter, settlement path, and existing tests before changing its behavior. The server and mobile engine share content and rules but use different persistence implementations. A server-only fix is incomplete when the same feature exists offline.

Use stable language IDs to scope saves; displayed world numbers can change. Keep hero IDs, prompt IDs, exercise IDs, stage IDs, and receipt identities stable unless the task includes a migration.

## Preserve progression semantics

- Examples are practice. They may save a draft but cannot award Forge or defeat a creature.
- A full suite pass can award a first clear. A replay cannot award it again.
- Core Workbench `fail` and `compile_error` results can damage a One Life hero; its timeout is HP-neutral. Do not infer chargeability from a generic error Boolean: inspect the specific encounter's evaluated-verdict and settlement policy.
- Runner unavailability, infrastructure failures, cancellation, and written GM assessments do not cost HP. Retryable infrastructure failures must not consume an attempt identity as a graded miss.
- Combat numbers come from `lib/combat-rules.mjs`. Fallen heroes retain reading and drafts while combat submissions and healing remain blocked.
- Ordered quests cannot skip stages. A practice pass cannot complete a code stage. Final rewards settle once and remain separate from core Forge progress.

Keep assessment, outcome, state mutation, and receipt handling distinct. A receipt binds a submission ID to its payload fingerprint. Repeating that ID returns its prior result without repeating damage, spending, or loot; changing the payload under the same ID is rejected.

Commit dependent writes together in SQLite or the mobile repository transaction. Do not add a nested store transaction from a settlement callback. Preserve cancellation and stale-hero guards so a late result cannot update another hero.

## Aids and written reviews

Hard Mode gates authored answers and suggestions at the correct encounter/exercise boundary. A prior Guided victory must not unlock an uncleared Hard encounter. Written-answer aid exceptions require the matching current rubric and submitted answer revision.

The desktop GM extracts bounded rubric evidence using a local model. Application code decides points and authored feedback; arbitrary model prose is not a trusted verdict. The mobile GM uses authored rules. Neither review awards a code-test clear or proves an answer correct merely because a percentage was returned.

## Saves and editions

Keep each world's heroes, drafts, and progress isolated. Use the existing book-revision helpers when an authored prompt moves. Current-page data, including an intentionally empty replacement, wins over historical aliases. Generic page notes retain numeric identity. Do not rewrite old records merely to display a compatible view.

Changes to save import must preserve validation of nested assessments, receipts, encounter state, limits, and hero membership before writing live data. Test both accepted round trips and rejection without partial writes.

## Validation and handoff

For behavioral work, reproduce the failing outcome first and test observable state: HP, reward counts, stage order, saved draft, Forge, or replay response. Include server/mobile parity when both adapters participate. Use actual runner integration when the adapter or fixture contract changes; a mocked pass does not establish runner compatibility.

Report the affected worlds and encounters, what settled differently, checks performed, and any runtime or device coverage that was unavailable. Keep implementation details out of player-facing flows unless they explain a meaningful limitation.
