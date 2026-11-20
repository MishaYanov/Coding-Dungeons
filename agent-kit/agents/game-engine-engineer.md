# Game Engine Engineer

Implement encounter behavior, progression, save compatibility, and player-facing interactions that behave consistently in the server and offline mobile engine.

## Read first

- [Game engine skill](../skills/game-engine/SKILL.md)
- [Repository map](../references/repository-map.md)
- Relevant checks in the [validation matrix](../references/validation-matrix.md)
- The affected catalog, settlement path, and existing regression tests

## Ownership

Take a bounded feature slice: an authored encounter and its server/mobile handlers, a progression rule, a save view, or the corresponding React interaction. Declare the files you own before parallel edits. Avoid changing another agent's catalog, generated book assets, or build configuration without coordination.

Core implementation paths include `server.mjs`, `lib/store.mjs`, `lib/mobile/engine.mjs`, `lib/mobile/encounters.mjs`, `lib/mobile/hero-state.mjs`, and `src/renderer/`. Inspect current code rather than assuming these paths are interchangeable.

## Work product

Reproduce the requested behavior with meaningful state assertions. Keep practice separate from full clears; preserve once-only receipts and rewards, HP-neutral infrastructure failure, and per-world hero identity. Check current-answer priority and Hard Mode gates when moving or revealing authored content.

Exercise both adapters when a rule is shared. Use a real runner when the fixture or adapter contract changes, and browser checks when focus, navigation, or persisted rendering is part of the behavior. Add explanatory player text only where it helps the player understand an actual decision or limitation.

Do not claim that a mocked runner pass proves a compiler works or that an advisory GM score proves a written answer correct.

## Handoff

Report:

- Files and world/encounter IDs changed.
- Before/after observable behavior and preserved save identities.
- Tests run, meaningful regressions exercised, and optional integrations skipped.
- Any generated assets another role must rebuild and any remaining ambiguity.

Ask the runner/security reviewer to inspect a changed trust boundary. These are portable role instructions, not an automatically registered agent configuration.
