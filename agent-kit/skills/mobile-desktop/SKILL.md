---
name: mobile-desktop
description: Implement or review Coding Dungeons reader behavior across Electron, the offline PWA, and the Android wrapper, including responsive navigation and save transfer.
---

# Mobile and Desktop Reader

Use the [repository map](../../references/repository-map.md) to locate the shared reader and platform adapters. Select checks from the [validation matrix](../../references/validation-matrix.md); a source browser pass and an installed APK pass are different evidence.

## Establish the affected surface

- `src/renderer` is the shared React interface. `server.mjs` provides the desktop/browser API; `lib/mobile` supplies the offline engine. Keep the same question, draft, progression, and grading meanings across those adapters.
- Desktop saves belong in per-user application data, not beside the executable. Preserve the utility process's restricted environment, exact loopback origin/token policy, renderer isolation, and approved external-link allowlist.
- Mobile worlds use stable language IDs and separate IndexedDB stores. A world's display number can change without moving its saves. Preserve the established JavaScript database name.
- Android serves bundled assets through its reserved WebView origin. Keep file/content access, network fallback, unrelated navigation, and broad JavaScript bridges disabled. Save exchange uses the document picker and bounded snapshots.

## Reader behavior

- A/D navigation must respect editor focus, composition, dialogs, and other input controls. Tab inserts four spaces in code; Escape then Tab releases focus.
- At the mobile breakpoint, keep World/GM tabs aligned, page controls at the bottom, and other controls in the full-page menu drawer. Preserve keyboard and screen-reader access.
- Reflowable text is derived from the published PDF and keeps that edition's page coordinates. New book links or supplementary labs need both desktop and mobile campaign metadata.
- Preserve named prompt IDs and listing identities. If pages move, retain authored revision aliases, current-answer priority, and unfinished quest drafts. Generic page notes have numeric page identity; do not guess a semantic relocation.

## Offline and save changes

Service-worker upgrades must keep the previous downloaded edition usable if the new download fails. Verify pinned asset bytes and reject redirects before reporting readiness. Do not treat a cache name alone as integrity evidence.

Validate a backup fully before changing live saves. Preserve occupied worlds, unsent drafts, reading position, combat receipts, and per-world hero membership. Exercise malformed and older backups when changing these paths.

For Android builds, use the repository script rather than inventing a signing flow. The update identity lives outside disposable build outputs. Test the `.test` package with an owned emulator/profile so normal installations and saves remain intact.

## Completion evidence

Report the affected platforms, behavioral checks, and exact artifact tested. Keep host-thread labs distinct from WASI guest capabilities and guided C# drafts distinct from executable grading. Performance on an emulator does not establish support for a physical 2 GB phone.
