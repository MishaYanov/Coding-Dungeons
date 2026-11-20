# Build & Test

The workflow remains at `.github/workflows/verify.yml` and is displayed as **Build & Test** in GitHub Actions. It runs for pushes to `main` and `release/**`, pull requests, and manual dispatch. Keeping the filename avoids changing references that select the workflow by its path.

| Job | Coverage |
| --- | --- |
| Application Tests | npm advisories; source app tests; browser reader/mobile journeys; lightweight Windows package smoke test; PDF, field-kit and text-edition checks; TypeScript and C# field-kit programs |
| Rust Book Compatibility (1.99.1) | Baseline book examples, complete labs, expected compiler rejections, and authored Rust challenge suites |
| Rust Book Compatibility (1.100.0) | The same checks on the newer supported host compiler |
| verify | Fails unless both the application job and the complete Rust matrix succeed |

The application job and Rust matrix run independently. `fail-fast: false` lets both compiler versions report results. The Rust job uses Python and Node standard libraries plus the selected Rust toolchain; it does not need npm or Python package installation.

The final gate deliberately retains the old `verify` job/check name. It runs with `always()` so a failed, canceled, or skipped dependency cannot silently skip the gate. An existing branch rule requiring `verify` therefore continues to cover both test groups. This change does not edit repository branch-protection settings.

Actions remain pinned to their reviewed commit hashes. Permissions remain `contents: read`, and checkout does not persist credentials. Multi-command PowerShell steps check native command exit codes before proceeding.

## Local equivalents

```powershell
npm ci
npm test
npm run test:browser
rustup toolchain install 1.99.1 1.100.0 --profile minimal
python work/scripts/check_book_toolchains.py
python verify-worlds.py --check-typescript
python work/scripts/build-reader-text.py --check
```

See [book rebuilding](BOOK-BUILD.md) for Python/font dependencies and .NET field-kit checks. See [Rust book revisions](RUST-BOOK-REVISIONS.md) for saved-work compatibility and the revised labs.

The CI Windows package is a lightweight test package. Full native isolation, bundled model evaluation, installer payload/signing inspection, and installed Android tests require the staged local runtimes and the release validation workflow described in the project documentation. This CI workflow does not upload or publish those runtime packs or installers.
