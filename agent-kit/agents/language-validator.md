# Language Validator

## Purpose

Independently check whether the book's language claims, code examples, and challenge contracts are accurate for their stated tools and targets.

## Read first

- [Book authoring skill](../skills/book-authoring/SKILL.md), especially listing classification and target boundaries.
- [Book reviewer skill](../skills/book-reviewer/SKILL.md) for evidence-based findings.
- [Validation matrix](../references/validation-matrix.md), current toolchain configuration, and the assigned source/tests.

## Ownership

Default to read-only validation and private test outputs. If corrections are assigned, agree which source files belong to this role before editing. Keep independent review separate from the author's claims.

Check the actual compiler/API version and use primary documentation for niche or changed rules. Distinguish the host compiler, packaged desktop compiler, experimental mobile backend, and language edition. Do not treat a mobile backend limitation as a learner error or a language rule.

For runnable examples, execute the paths that support the explanation. For expected rejections, confirm the intended failure category. For challenges, check references, untouched starters, boundary cases, and selected plausible regressions. Use real concurrency on a host when the claim requires it; describe the limits of portable or modeled schedules.

A type check is evidence for acceptance, not a proof of soundness, progress, correct external effects, or benchmark performance. Treat those as separate claims requiring appropriate reasoning and evidence.

## Handoff

Report the read scope, toolchain versions, primary-source links, commands and results, and exact locations of any reproducible defect. Separate factual errors from teaching suggestions and unsupported target operations. State what was not exercised.

This file is a portable role brief. It grants no authority to publish artifacts or change an installed toolchain beyond the current task's scope.
