# Patched QuickJS runtime

Coding Dungeons 1.0.16 uses `@jitl/quickjs-wasmfile-release-sync@0.32.0-coding-dungeons.1` for JavaScript and emitted TypeScript in the desktop, PWA, and Android editions. This is a local rebuild of upstream 0.32.0, not a new upstream release. The app uses `quickjs-emscripten-core` with this single patched variant.

The rebuild starts from quickjs-emscripten commit `df4efb9ef2cb25c417ecb57986da462d11b244ed`, whose embedded interpreter identifies itself as `2025-09-13+f1139494`, and applies:

| Issue | Change |
| --- | --- |
| [QuickJS #492](https://github.com/bellard/quickjs/issues/492) | Upstream commit [`841dd034c2fac02f9ee3c605d8b96a8f8b49c945`](https://github.com/bellard/quickjs/commit/841dd034c2fac02f9ee3c605d8b96a8f8b49c945) bounds copying after a resizable buffer changes during `TypedArray.prototype.with`. |
| [QuickJS #478](https://github.com/bellard/quickjs/issues/478) | The `quickjs.c` changes from upstream commit [`68caa5f226401a7e148fb8f7358d4688c71372aa`](https://github.com/bellard/quickjs/commit/68caa5f226401a7e148fb8f7358d4688c71372aa) correct constructor ordering so reentrant code cannot invalidate earlier buffer checks. Unrelated upstream TODO/test262 status changes are omitted. |
| [QuickJS #535](https://github.com/bellard/quickjs/issues/535) | The local [allocation guard](proxy-ownkeys-overflow.patch) rejects a Proxy `ownKeys` length above `SIZE_MAX / sizeof(tab[0])` before multiplication and allocation on WASM32. This is an application-maintained fix, not an upstream commit. |

The original MIT license and compiled FFI are retained. Browser, Node ESM, Node CommonJS, and Cloudflare glue are rebuilt alongside the WebAssembly module; the build rejects differing WASM bytes between those targets. No install-time package scripts are included. These fixes address the identified interpreter defects and do not establish that the interpreter, browser, or operating system has no other vulnerabilities.

## Reproduce

Use Linux or WSL with Python 3.10+, GNU Make, GNU patch, and [Emscripten SDK 5.0.1](https://github.com/emscripten-core/emsdk/tree/5.0.1). Install and activate that SDK version, then source its `emsdk_env.sh`. The recorded toolchain release is `bf32ae8b61ac8efeb7eca01b54c8307f992724f7`, with emcc identifying commit `8c5f43157a3f069ade75876e23061330521eabde`. A preinstalled SDK avoids changing system-wide tools.

From the repository root, with the SDK active:

```sh
python3 work/scripts/build-quickjs.py \
  --work-dir "$HOME/.cache/coding-dungeons-build/quickjs-reproduce-1" \
  --output "$PWD/out/quickjs-reproduced.tgz"
```

The work directory must be new and its absolute path must contain no whitespace. The output and its provenance sidecar must not already exist. The script never removes a prior directory or output. It checks the compiler version, verifies pinned download hashes before extraction, applies all patches with zero fuzz, verifies the existing FFI exports, and writes deterministic tar/gzip metadata. Initial downloads require Internet on the build machine; the installed game does not download this runtime.

For an offline rebuild, add `--archives /path/to/verified-inputs` containing `wrapper.tar.gz`, `841dd03.patch`, `68caa5f.patch`, and `quickjs-wasmfile-release-sync-0.32.0.tgz`. The local `proxy-ownkeys-overflow.patch` is read from this directory or from the repository's `vendor/quickjs/` directory. Hash mismatches stop the build. The activated SDK must already be installed.

## Provenance

[PROVENANCE.json](PROVENANCE.json) records authenticated inputs, each patch and its before/after source hash, the emcc version, build arguments, generated exports, artifact hashes, and the npm tarball integrity. The package also embeds provenance without the enclosing tarball's hash. This makes the build inspectable; a checksum is not publisher authentication.

Recorded outputs for this build:

| Artifact | SHA-256 |
| --- | --- |
| `quickjs-wasmfile-release-sync-0.32.0-coding-dungeons.1.tgz` | `bb50b74cf0f0301388d74a0f1bd042658ea4213980056990cf2727f2682ca141` |
| `dist/emscripten-module.wasm` | `efc04d02385b05d42df7fe5d42025c65b66e236fb411f0da09685b2193e1c8fb` |
| Patched `quickjs.c` | `2582f9088effc1ed16969977e02d6f926eff547426e69cd03c9f59560555c1d9` |

An independent inspection verified all 23 packaged artifact hashes, embedded/sidecar provenance agreement, retained license, absent lifecycle scripts, and fixed archive metadata. A second complete compiler rebuild was not performed as part of that inspection. After changing the runtime, run the QuickJS security regressions and the desktop/mobile JavaScript and TypeScript suites before producing installations. See the [security review](../../docs/SECURITY-REVIEW.md) for the remaining release limitations.
