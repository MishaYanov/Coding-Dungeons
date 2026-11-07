# Windows Native Coding Runner

The app runs Rust and Go through a local Windows broker. The Rust compiler builds the learner library before the app stages the trusted tests. The Go compiler builds a reactor with a fixed case export. Each case runs in a fresh Wasmtime process with bounded memory, fuel, and wall time. The host requires a normal return from the chosen test. A guest exit request or stdout message cannot grant credit.

## Windows isolation check

The probe creates a temporary Windows AppContainer profile and launches a trusted test child with a capability-free LPAC token. Windows assigns the suspended child to a Job Object before it runs. The broker verifies the token, identity, and job membership before resuming the child.

Run this on a Windows 11 x64 machine as a standard user from a regular desktop PowerShell session.

```powershell
$env:DUNGEONS_TEST_NATIVE_BROKER = '1'
node --test test/standalone-runner-broker.test.mjs
```

The test builds the helper with the Windows .NET Framework compiler into a fresh temporary directory. The restricted child must read its granted input, rename a file in its compiler scratch directory, and write to the explicit output handle. The child must be denied access to a private file, loopback, and child process creation. A second child sleeps until the job deadline. The test requires both children to finish and removes the temporary directory. The probe refuses to launch from an existing AppContainer, which is the current limitation inside the Codex shell. [AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer) · [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

## Packaged checks

The runner expects `native-runner.json`, `broker.exe`, and `wasm-worker/wasm-worker.exe` in the bundle. The compiler directories are `rust/` with the Windows x64 Rust compiler and `wasm32-wasip1` target and `go/` with the Windows x64 Go toolchain. Publish the Wasmtime worker as a self-contained Windows x64 directory. The manifest identifies the available languages and SHA-256 hashes of their fixed executable paths.

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
