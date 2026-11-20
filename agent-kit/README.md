# Coding Dungeons agent kit

Reusable skills and role briefs extracted from building, reviewing, testing, and packaging this project. The kit contains instructions and a small validator, not model weights, compilers, signing keys, or installed agent configuration.

## Use it

Give an agent a concrete task, a role brief from `agents/`, and the matching `SKILL.md` files from `skills/`. The [catalog](catalog.json) maps every role to its skills. Read shared references only as the task needs them.

For example:

> Use `agent-kit/agents/book-editor.md` and its listed skills to review the Rust wakeup chapter. Return findings with source evidence; do not edit the book yet.

> Use `agent-kit/agents/qa-release-engineer.md` to validate the Windows and Android artifacts built from this branch. Report which checks exercised source code and which exercised the installed packages.

These are portable Markdown role briefs. They are not automatically registered Codex agents or globally installed skills. A host can load the files directly; an installation into that host's discovery directory is a separate configuration task. Paths in this kit are relative to the repository, not to a particular developer's PC.

## Roles

| Role | Responsibility |
| --- | --- |
| [Project coordinator](agents/project-coordinator.md) | Scope, ownership, integration, release evidence and handoffs |
| [Book editor](agents/book-editor.md) | Technical prose, learning progression, examples and gamebook framing |
| [Language validator](agents/language-validator.md) | Primary-source fact checking, compiler versions and discriminating fixtures |
| [Game engine engineer](agents/game-engine-engineer.md) | Progression, combat, grading, saves and platform parity |
| [Runner/security reviewer](agents/runner-security-reviewer.md) | Untrusted code boundaries, failure classification and exploit-focused review |
| [Mobile/desktop engineer](agents/mobile-desktop-engineer.md) | Shared reader, platform bridges, offline assets and packaging |
| [QA/release engineer](agents/qa-release-engineer.md) | Tests, actual package validation, hashes and update identity |
| [CI maintainer](agents/ci-maintainer.md) | Build & Test jobs, compiler matrix, required gate and workflow validation |

Roles are responsibilities, not a mandatory headcount. Combine roles for small tasks. Parallelize independent work with explicit file ownership, then have someone other than the author review the risky changes.

## References and validation

- [Repository map](references/repository-map.md): source ownership, generated artifacts, runtime boundaries and project constraints.
- [Validation matrix](references/validation-matrix.md): choose checks by change scope and distinguish their evidence.
- Run `node agent-kit/scripts/validate.mjs` to validate the catalog, skill frontmatter, relative links and repository targets. This validates the kit's structure; it does not prove the quality of its guidance.

When reusing the kit in another project, update the repository map and command references first. The kit does not grant permission to push, publish, install software, or modify a user's saves.
