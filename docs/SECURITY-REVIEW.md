# Coding Dungeons security review

Reviewed the Windows desktop build, the local browser development server, the save format, and the JavaScript, TypeScript, Rust, and Go grading paths on November 8, 2026.

| Finding | Impact | Change |
| --- | --- | --- |
| The installer toolchain used an affected archive extractor. | Upstream advisories cover extraction in the build environment. The extractor is a build dependency. | Updated Electron Forge and its archive and glob dependencies. The updated npm lockfile returned zero advisories at review time. |
| Save import accepted a database based on the presence of a table name. | A selected file could install unexpected SQLite triggers or an incompatible schema and affect later saves. | Validate a private copy against the supported schemas before changing any live save. Migrate legacy saves in the private copy. Disable SQLite trusted schema. |
| A hint URL changed hero progress on GET. | A page on a sibling localhost origin could mark the active hero as assisted without going through the mutation guard. | Require POST, the local mutation header, a valid hero, and the expected origin for browser requests. |
| Packaging copied most untracked files in the project folder. | A local backup or signing file placed in the project could be included in the distributed app. | Allow only the required application paths and check the separately bundled runtime for unexpected root entries, private files, and links. |
| Go's generated verdict used a Boolean name shared with the submission's package. | The submission's package scope could change how the fixture recorded failure. | Use a numeric failure marker and dispatch cases by index without using submission-visible names for bounds checks. |

The installed desktop package includes Electron and native runtimes outside the npm advisory scan. The Windows package pins Electron 45.3.2 and verifies its archive hash. The installer build requires Go 1.27.4 and .NET 10.0.15. The packaged app enforces ASAR integrity and disables Node startup flags. [Electron release](https://github.com/electron/electron/releases/tag/v45.3.2) · [Go releases](https://go.dev/doc/devel/release) · [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)

The browser development server is for local single-user use. A process that can reach its loopback port can use the development API. The desktop app uses a per-launch secret, a sandboxed renderer, and a fixed local origin. Local challenge grades are practice feedback. A user who controls the installation can inspect the bundled tests and edit local saves.

Rust and Go grading require the Windows broker to pass its isolation probe. The browser development build also uses that broker. The legacy Docker grader was removed because the test result shared a writable environment with the submission. [Windows AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)

Save export covers the four world databases and the supported reader drafts and positions. Release builds verify the application's signature inside the Squirrel payload and the final installer signature and timestamp. A local test installer can be built under a separate filename. [Windows release instructions](../README.md#develop)
