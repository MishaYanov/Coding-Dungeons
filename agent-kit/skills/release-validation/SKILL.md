---
name: release-validation
description: Assemble and verify a Coding Dungeons release, including synchronized books, offline runtimes, Windows setup, Android APK, artifact checksums, and safe output cleanup.
---

# Release Validation

Start with the [repository map](../../references/repository-map.md) and [validation matrix](../../references/validation-matrix.md). Read the current package, Forge, Android, and runtime manifests for versions; old release notes are historical evidence.

## Assemble a reviewable release

Confirm the intended feature/hotfix branches and release destination. Inspect working trees and upstream changes before merging. Resolve conflicts around the final behavior, then record which commits the release includes. A source push, a GitHub Release, and public binary distribution are separate actions; follow the current task's authorized scope.

Regenerate book data, page images, embedded/downloaded field kits, and text editions together when their source changes. Preserve prompt/listing identity and verify page-revision aliases. Run the authored program checks on the configured baseline and compatibility toolchains.

## Build the requested artifacts

- Use the repository's desktop maker and Android build script. A lightweight desktop test package may omit optional runtimes; it is not proof that the full offline installer is complete.
- Production Electron packages must retain the pinned archive verification, renderer isolation, ASAR integrity, ASAR-only loading, and disabled Node environment/inspector entry points. Do not ship the desktop test-inspector variant.
- Verify the setup contains its full offline payload, not just a small bootstrap stub. Missing compiler/model files must fail readiness rather than silently enabling another execution path.
- Preserve the existing Android signing identity and its protected metadata outside cleanup targets. Verify certificate continuity for updates, version code/name, permissions, and release debuggability.
- Check current runtime notices and provenance before public redistribution. The experimental mobile Rust pack has a documented distribution blocker; a tested checksum does not resolve it.

## Validate the built result

Exercise the actual packaged application with private test saves. For executable worlds, distinguish examples from full clears and verify reload persistence; include guided worlds, hidden encounters, and changed save paths where relevant. Preserve the normal installed application's state.

Inspect package contents against the source/build outputs: current book PDF, field kit, text edition, page assets, campaign data, revision aliases, patched QuickJS bytes, and required native companions. Inspect the artifact rather than assuming a successful build copied everything.

Separate source tests, host compiler checks, real browser workers, native sandbox probes, packaged UI, and installed Android results in the evidence. A skipped environment-dependent test is not a pass. Record remaining platform or signing limits without claiming risk-free execution.

## Deliver and clean up

Copy installers to their final versioned names, verify both hashes against the built sources, then write `SHA256SUMS.txt`. On PowerShell, use terminating errors so a failed copy/hash cannot be mistaken for a successful comparison.

Only after verified replacements exist, remove superseded requested outputs and disposable build duplicates. Check resolved absolute targets remain inside the intended project/output directory; use native filesystem commands and refuse unexpected linked targets. Retain signing keys, saves, runtime packs needed for future builds, and useful verification evidence.

Handoff the release source commit, artifact paths/hashes, tested configurations, and material limitations. Installer availability does not mean an existing installation has been updated.
