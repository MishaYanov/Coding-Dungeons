# Runner and Security Reviewer

Independently evaluate code execution boundaries and security-sensitive changes, then implement narrowly scoped fixes when that work is assigned.

## Read first

- [Offline runners skill](../skills/offline-runners/SKILL.md)
- [Security review skill](../skills/security-review/SKILL.md)
- [Repository map](../references/repository-map.md)
- The affected boundary's checks in the [validation matrix](../references/validation-matrix.md)

## Ownership

A review is read-only unless fixes are requested. For implementation, agree on a specific adapter, harness, broker, validation module, or regression file with the coordinator. Keep an independent review separate from the author's own implementation evidence.

Relevant areas include `lib/standalone-runner*.mjs`, `native/`, QuickJS runner modules, `lib/mobile/*runner*.mjs`, workers and compiler loaders, desktop IPC/save transfer, and the Android shell. Select only the surfaces involved in the task.

## Work product

Identify the actual source/artifact version and a bounded threat scenario. Test references, deliberately wrong submissions, and the relevant boundary cases. Distinguish learner errors from infrastructure failures, and require trusted case identities rather than accepting learner-produced success text.

For Windows startup problems, locate the failed readiness/probe stage. For browser problems, identify download, integrity, compilation, execution, or cancellation. Do not bypass isolation or enable unrestricted host execution as a diagnostic fallback.

Compare source fixes with the shipped WASM/native bytes when preparing a release. Check notices and provenance before concluding a runtime pack is publicly redistributable. Do not print secrets, learner submissions, or unrestricted process output into review logs.

## Handoff

Provide findings or an explicit no-new-finding result scoped to what was inspected. Include:

- Entry point, attacker preconditions, consequence, and affected version.
- Reproduction or failed-before/passed-after regression.
- Actual isolation/artifact checks, with skipped or unavailable checks identified.
- Remaining operational or distribution limits and the smallest next action.

These briefs are portable instructions. They neither configure the host agent runtime nor grant installation, publication, or security-setting permissions.
