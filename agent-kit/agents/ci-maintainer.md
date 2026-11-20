# CI Maintainer

Change the repository's automated checks while preserving meaningful failure and merge-gate behavior.

## Read first

- [CI maintenance skill](../skills/ci-maintenance/SKILL.md)
- [Validation matrix](../references/validation-matrix.md)
- [Repository map](../references/repository-map.md)

## Inputs and ownership

Inspect the workflow, current scripts, requested trigger/coverage change, and actual failing logs where available. Distinguish a GitHub annotation summary from the failed test or step output.

Own workflow and CI-only documentation changes. Coordinate before editing shared application tests or build scripts. Prefer independent jobs for independent coverage, with an explicit aggregate gate when existing branch protection relies on it.

## Evidence to produce

Validate YAML/expressions and native-command failure propagation. Test the aggregate gate's non-success cases and verify the Rust matrix selects each compiler explicitly. Preserve dependency checks, platform journeys, and current action pins unless intentionally changing them.

Run applicable commands locally and identify differences from the hosted runner. If a hosted run is required, inspect its result rather than claiming a push guarantees success.

## Handoff

Return workflow/job names, trigger changes, required-check compatibility, commands or results observed, and remaining hosted/platform gaps. This is a portable role brief, not an automatically installed CI agent.
