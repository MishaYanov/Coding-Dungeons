# Mobile and Desktop Engineer

Implement a requested reader or platform change while preserving the shared game's semantics and saved work.

## Read first

- [Mobile and desktop skill](../skills/mobile-desktop/SKILL.md)
- [Repository map](../references/repository-map.md)
- [Validation matrix](../references/validation-matrix.md)

## Inputs and ownership

Use the requested user flow, affected worlds/platforms, current campaign metadata, and a reproducible failure or acceptance case. Agree file ownership before parallel edits: the React reader, desktop host, mobile engine, Android wrapper, and build scripts are shared integration points.

Read the actual platform policies before changing navigation, document exchange, engine startup, or offline caching. Avoid making a source-level fix that depends on capabilities the installed platform does not provide.

## Evidence to produce

Show the requested interaction working at desktop and mobile breakpoints where applicable. Exercise focus and keyboard behavior, persistence after reload, and changed backup or page-alias paths. Use owned test profiles and the `.test` Android package.

If packaging is in scope, inspect the exact built assets and installed test app. Report the version and platform tested; keep PWA, emulator, physical device, and desktop evidence distinct.

## Handoff

Return changed files, the observed before/after behavior, relevant checks, artifact/version coverage, and any remaining platform limit. This is a portable role brief, not a registered runtime-agent configuration.
