---
name: security-review
description: Audit Coding Dungeons code, save handling, runner boundaries, dependencies, or packaged desktop/mobile artifacts and validate concrete security fixes.
---

# Security Review

Start with the [repository map](../../references/repository-map.md), the relevant current entries in `docs/SECURITY-REVIEW.md`, and the [validation matrix](../../references/validation-matrix.md). Historical findings and hashes are evidence for their named builds, not automatic findings against the current artifact.

## Define the evidence

Record the source commit, artifact version, platform, and boundaries actually inspected. Distinguish installed copies, unpacked packages, installers, APKs, hosted PWA responses, and source tests. A clean source tree does not establish the safety of an older installation.

For each finding, identify the entry point, required attacker capability, reachable consequence, and reproducible evidence. Separate a demonstrated vulnerability from a hardening opportunity, availability limitation, or missing device coverage. Do not force a finding or promise that an installation is impossible to compromise.

## Review the relevant surfaces

- Local HTTP: exact host/origin checks, bounded JSON, valid hero sessions, desktop token handling, private-file denial, and public campaign sanitization.
- Desktop: renderer isolation, preload/IPC validation, allowed documentation links, request partitioning, utility-process environment, and save transfer.
- Mobile: WebView origin/frame checks, asset/network fallback denial, native bridge messages, document snapshots and limits, IndexedDB isolation, and offline cache integrity.
- Saves: schema and nested payload validation, SQLite triggers or hostile structures, committed WAL size, hero membership, atomic imports, and preservation of occupied worlds.
- Game logic: replay-safe damage/spending/rewards, stale results, cross-world IDs, current-answer/rubric binding, and Hard Mode aid authorization.
- Execution: compiler/harness separation, LPAC/WASI/QuickJS boundaries, forged diagnostics/verdicts, resource limits, cancellation, and fresh execution state.

Choose surfaces from the actual change or requested audit scope rather than treating every edit as a full security project.

## Dependencies and artifacts

Use npm advisories as one input. Inspect the selected embedded engine, native executables, DLLs, model assets, source provenance, and licenses when relevant; an npm audit with no findings does not validate those binaries.

Preserve pinned action/dependency sources and verify the artifact actually contains the patched variant. Check the final ASAR/APK, signatures, permissions, debuggability, asset hashes, and installer payload for the release being assessed. A build log alone is not a package inventory.

Do not relax sandbox gates, certificate checks, CSP, signature policy, or request validation to make an audit test pass. Reproduce with bounded authored fixtures and temporary profiles or the separate Android test application. Preserve the user's real heroes and signing identity.

## Fixes and reporting

For a concrete fix, retain a regression that failed before it and checks the relevant consequence or rejection. Recheck the affected artifact boundary if packaging or runtime content changed. Keep learner text and raw compiler/model output out of diagnostic reports unless the task requires a bounded, reviewed excerpt.

Report findings with severity, preconditions, evidence, affected version, and recommended change. For corrected findings, include the regression and artifact verification. Explicitly distinguish untested physical devices, unsigned private builds, experimental compiler support, and distribution/provenance constraints when those limits affect the requested conclusion.

The kit does not authorize public publication or changes to Windows/phone security settings. Follow the user's current task and the repository's actual release requirements.
