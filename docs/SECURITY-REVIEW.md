# Coding Dungeons security review

Reviewed the Windows desktop build, the local browser development server, the save format, and the JavaScript, TypeScript, Rust, and Go grading paths on November 8, 2026.

| Finding | Impact | Change |
| --- | --- | --- |
| The installer toolchain used an affected archive extractor. | Upstream advisories cover extraction in the build environment. The extractor is a build dependency. | Updated Electron Forge and its archive and glob dependencies. The updated npm lockfile returned zero advisories at review time. |
| Save import accepted a database based on the presence of a table name. | A selected file could install unexpected SQLite triggers or an incompatible schema and affect later saves. | Validate a private copy against the supported schemas before changing any live save. Migrate legacy saves in the private copy. Disable SQLite trusted schema. |
| A hint URL changed hero progress on GET. | A page on a sibling localhost origin could mark the active hero as assisted without going through the mutation guard. | Require POST, the local mutation header, a valid hero, and the expected origin for browser requests. |
| Packaging copied most untracked files in the project folder. | A local backup or signing file placed in the project could be included in the distributed app. | Allow only the required application paths and check the separately bundled runtime for unexpected root entries, private files, and links. |
| Go's generated verdict used a Boolean name shared with the submission's package. | The submission's package scope could change how the fixture recorded failure. | Use a numeric failure marker and dispatch cases by index without using submission-visible names for bounds checks. |

The archive advisory applies to build tooling. The installed desktop package also includes Electron and native runtimes, which the npm audit alone does not cover. The reviewed pins are Electron 45.2.3, Wasmtime 50.0.1, and .NET 8.0.33. Keep their upstream security releases under review. [Node tar advisory](https://github.com/advisories/GHSA-r292-9mhp-454m) · [Electron releases](https://github.com/electron/electron/releases/tag/v45.2.3) · [Wasmtime releases](https://github.com/bytecodealliance/wasmtime/releases/tag/v50.0.1) · [.NET security update](https://github.com/dotnet/announcements/issues/496)

The browser development server is for local single-user use. A process that can reach its loopback port can use the development API. The desktop app uses a per-launch secret, a sandboxed renderer, and a fixed local origin. Local challenge grades are practice feedback. A user who controls the installation can inspect the bundled tests and edit local saves.

The installed 1.0.4 app reported the same process launch failure for Rust and Go. This happens in their shared Windows isolation probe before either compiler starts. The updated broker preserves the Windows error number and the editor shows the status detail. The complete broker and compiler path still needs a successful check from a regular Windows session. The Codex environment already runs inside an AppContainer and cannot validate that host path. [Windows AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)

Save export covers the four world databases. Device-only drafts in the separate reader database are outside that export. Windows installer signing depends on the release owner's signing certificate.
