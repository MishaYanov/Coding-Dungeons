---
name: offline-runners
description: Diagnose or change Coding Dungeons code execution, compiler staging, sandbox readiness, worker lifecycles, and executable challenge suites.
---

# Offline Runners

Read the [repository map](../../references/repository-map.md) for adapter locations and the [validation matrix](../../references/validation-matrix.md) for real-runtime checks. Consult `docs/MOBILE-RUST.md` when Rust browser compatibility or distribution is involved.

## Select the actual execution boundary

Distinguish host book validation, the bundled Windows compiler, the WASI guest, and the experimental browser compiler. A new book toolchain does not automatically replace either packaged runtime. Read active pins and manifests rather than copying an old version from a report.

JavaScript/TypeScript use the patched QuickJS variant; wrapper package versions alone do not identify the embedded interpreter. Desktop Rust/Go compilation uses the Windows broker and isolated WASI execution. Mobile adapters use their own workers and staged compiler packs. C# currently provides guided drafts, not an in-game compiler; do not manufacture a successful grade for an unsupported language.

## Maintain the trust split

- Learner code must not choose executable paths, shell commands, fixture files, or arbitrary imports outside the supported contract.
- Preserve separate compilation/staging of learner Rust before trusted harness linkage. Keep source/compiler directives from reaching hidden harnesses or broker controls.
- Trusted case IDs and expected suite structure come from authored metadata, not learner output. Reject missing, duplicate, contradictory, or unknown verdicts.
- Preserve fresh guest execution state at each adapter's case boundary. Shared immutable compiler modules or verified library bytes must not become shared learner state.
- Normal return, guest early exit, traps, and resource exhaustion remain distinct. A process exit of zero is not sufficient evidence of a test pass.

Guest execution does not receive ordinary filesystem preopens, network access, or process creation. WASI does not supply ordinary OS threads here. External Cargo dependencies, procedural macro plugins, and build scripts are outside the supported learner contract.

## Windows readiness and failure

Readiness requires the expected canonical regular files, manifest checks, and successful isolation probe. Keep the LPAC, file-access, loopback, and Job Object checks intact. Never work around a launch failure by executing learner code directly on the host or weakening isolation.

Identify the failing stage before proposing a fix: discovery, hash, broker launch, token/probe, compiler, linker, or guest. Keep diagnostics bounded and sanitized. Preserve the broker's restricted environment and shell-free process invocation.

An infrastructure failure preserves the draft and stays HP-neutral. Do not convert a compiler panic, unsupported experimental backend operation, canceled load, or watchdog failure into a learner's compile error. Conversely, a learner-supplied diagnostic-looking string must not impersonate infrastructure failure.

## Browser lifecycle

Validate source limits and selected cases before worker launch. Cover asset fetch, integrity verification, compiler initialization, compilation, and guest execution with the appropriate deadlines. Cancellation must settle once, release owned resources, and permit retry.

The Rust compiler module's noncancelable compilation retains its queue slot until settlement; canceling a UI request must not start another simultaneous compiler initialization. Preserve the existing distinction between compiler/infrastructure deadlines and a running guest's execution limit.

Keep pinned asset digests, redirect rules, cache repair, and offline loading behavior aligned. A successful HTTP response alone does not establish a valid runtime pack.

## Validate the changed boundary

Run references and broken starters through the real affected adapter. Add targeted wrong answers or hostile cases when changing harnesses, result parsing, limits, or isolation. Check cancellation, recovery, forged verdicts, early exit, and unavailable capabilities as relevant.

Default source tests can skip native or model integrations when assets are absent. Report that absence; do not describe skipped checks as successful isolation tests. Compare actual packaged runtime bytes when shipping a fix.

Keep executable blobs, models, SDKs, private probes, and signing material out of the agent kit and source commits. Runtime redistribution remains subject to the current component notices and provenance recorded in the project documentation.
