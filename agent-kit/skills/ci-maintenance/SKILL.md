---
name: ci-maintenance
description: Maintain Coding Dungeons GitHub Actions testing jobs, Rust compatibility coverage, release triggers, and the required-check gate without weakening failure handling.
---

# CI Maintenance

Read `.github/workflows/verify.yml`, the relevant package scripts, and the [validation matrix](../../references/validation-matrix.md). Use the [repository map](../../references/repository-map.md) for scripts and test ownership. Derive compiler versions and action pins from the current workflow rather than copying old values.

## Preserve the testing contract

The workflow is displayed as **Build & Test**. Its file remains `verify.yml`. `application` runs the application/browser/lightweight desktop and book-asset checks. `rust_book` independently checks each configured Rust toolchain. The final `verify` job retains the earlier required-check name.

Keep the final gate dependent on both testing jobs and evaluated with `always()`. It must fail unless both job results equal `success`; failure, cancellation, and skipping must not become a green required check. Pass result values through environment variables rather than interpolating data into executable shell text.

Preserve the current push coverage for main and release branches, pull requests, and manual dispatch unless the task changes that contract. Workflow display names, job names, file paths, and required-check contexts are distinct; inspect their callers before renaming them.

## Change jobs deliberately

- Use the existing immutable action SHA pins, read-only repository permissions, and checkout without persisted credentials. Update pins with verified upstream metadata when a change is needed.
- The Rust book matrix runs `work/scripts/check_book_toolchains.py` with the selected explicit toolchain. Its Python and Node paths use standard libraries; this job does not need `npm ci`, pip packages, Go, PDF fonts, or mobile runtime downloads.
- Use `fail-fast: false` when both compatibility results are useful. Keep the selected toolchain explicit so the repository's Rust override cannot accidentally collapse the matrix to one compiler.
- Keep application dependency/audit, browser, packaged desktop, C# field-kit, PDF/image, and text-edition checks in the appropriate job. Avoid claiming that lightweight desktop CI exercises the full native runtime or installed Android app.
- PowerShell does not automatically throw for every failed native executable. Guard intermediate `$LASTEXITCODE` values in multiline scripts so a later successful command cannot hide an earlier failure.

## Validate before pushing

Lint the YAML and GitHub expressions with an available workflow-aware validator. Exercise the final gate for all combinations of success/failure/cancelled/skipped results. Run changed job commands locally when their environment is available, and inspect hosted results after a triggered run when the task requires CI completion.

Report local validation separately from GitHub-hosted execution. Do not interpret source test success or an unstarted workflow as a completed hosted pipeline.
