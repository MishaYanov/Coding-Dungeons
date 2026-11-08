# Windows Native Coding Runner

The app runs Rust and Go through a local Windows broker. The Rust compiler builds the learner library before the app stages the trusted tests. The Go compiler builds a reactor with a fixed case export. Each case runs in a fresh Wasmtime process with bounded memory, fuel, and wall time. The host requires a normal return from the chosen test. A guest exit request or stdout message cannot grant credit.

## Windows isolation check

The probe creates a temporary Windows AppContainer profile and launches a trusted test child with a capability-free LPAC token. Windows assigns the suspended child to a Job Object before it runs. The broker verifies the package identity and job membership, then uses an in-memory [Windows access check](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-accesscheck) to verify that the token receives access via the restricted packages group only. An ordinary AppContainer token fails this check. This follows the [Chromium sandbox test](https://chromium.googlesource.com/chromium/src/+/2a4d05dea58d1a561f880e523abff7188095d69e/sandbox/win/src/app_container_test.cc#124) and avoids relying on a token information class rejected by some Windows builds.

Run this on a Windows 11 x64 machine as a standard user from a regular desktop PowerShell session.

```powershell
$env:DUNGEONS_TEST_NATIVE_BROKER = '1'
node --test test/standalone-runner-broker.test.mjs
```

The test builds the broker with the Windows .NET Framework compiler and its native child with the Visual Studio C++ tools and Windows SDK. The child does not load .NET Framework inside the AppContainer. It must read its granted input, rename a file in its compiler scratch directory, and write to the explicit output handle. The child must be denied access to a private file, loopback, and child process creation. A second child sleeps until the job deadline. The test requires both children to finish and removes the temporary directory. The probe refuses to launch from an existing AppContainer, which is the current limitation inside the Codex shell. [AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer) · [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

The broker first connects to the test listener itself. On Windows installations where the restricted child cannot initialize Winsock and receives error 10107, the broker also checks that Windows has not granted the verified capability-free profile a [loopback exemption](https://learn.microsoft.com/en-us/windows/win32/api/networkisolation/nf-networkisolation-networkisolationgetappcontainerconfig). A successful connection from the child, an exemption, or a failure to read the exemption policy still fails the probe.

## Packaged checks

The runner expects `native-runner.json`, `broker.exe`, `sandbox-probe.exe`, and `wasm-worker/wasm-worker.exe` in the bundle. The compiler directories are `rust/` with the Windows x64 Rust compiler and `wasm32-wasip1` target and `go/` with the Windows x64 Go toolchain. Publish the Wasmtime worker as a self-contained Windows x64 directory. The manifest identifies the available languages and SHA-256 hashes of their fixed executable paths.

The staging script builds the broker, native probe, and self-contained worker, then copies the required toolchains into `desktop/runtime/standalone-runner`. Use Windows x64, PowerShell 7, Visual Studio C++ Build Tools with the Windows SDK, a .NET SDK, Rust 1.99.1 with the WASI target, and Go 1.25.1. Provide a local folder with the pinned Wasmtime and .NET NuGet packages and the Wasmtime license listed in the script. It verifies the file hashes before building. [Native staging script](../desktop/stage-native-runtime.ps1)

```powershell
rustup target add --toolchain 1.99.1 wasm32-wasip1
$rustBin = Split-Path (rustup which --toolchain 1.99.1 rustc)
pwsh -File desktop/stage-native-runtime.ps1 -RustToolchain (Split-Path $rustBin) -ArtifactSource 'C:\path\to\runtime-artifacts'
```

After staging the package, run both the boundary and actual compiler smoke as a standard user on a clean Windows machine with networking off.

```powershell
$env:DUNGEONS_TEST_NATIVE_BUNDLE = (Resolve-Path 'desktop/runtime/standalone-runner').Path
node --test test/standalone-runner.test.mjs
```

The app enables the bundle only after its hashes and the live Windows probe pass. Treat candidate assets as unverified until the packaged test passes for each language. The reference tests also support a developer check of trusted Go and Rust solutions through Wasmtime without invoking the Windows compiler broker.

```powershell
$env:DUNGEONS_TEST_WASM_WORKER = 'C:\path\to\wasm-worker.exe'
$env:DUNGEONS_TEST_GO_WASM = '1'
$env:DUNGEONS_TEST_RUSTC_WASM = 'C:\path\to\rustc.exe'
node --test test/standalone-runner-wasm.test.mjs
```
