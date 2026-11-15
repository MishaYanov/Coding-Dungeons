#!/usr/bin/env python3
"""Build the pinned, patched QuickJS release-sync npm package on Linux.

Requires Python 3.10+, GNU make/patch, and emcc 5.0.1 on PATH (source the
emsdk_env.sh from an emsdk 5.0.1 installation). No npm/Yarn install is needed.
--work-dir must not exist and its absolute path must contain no whitespace.
Optional --archives supplies wrapper.tar.gz, 841dd03.patch, 68caa5f.patch, and
quickjs-wasmfile-release-sync-0.32.0.tgz; missing remote inputs are downloaded.
The pinned local vendor/quickjs/proxy-ownkeys-overflow.patch is also required;
it can alternatively be preloaded in --archives under the same basename.
Every input is authenticated before extraction or application. This script
does not install software, edit the application, or remove any directory.
"""

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request


WRAPPER_COMMIT = "df4efb9ef2cb25c417ecb57986da462d11b244ed"
PATCH_COMMIT = "841dd034c2fac02f9ee3c605d8b96a8f8b49c945"
CONSTRUCTOR_PATCH_COMMIT = "68caa5f226401a7e148fb8f7358d4688c71372aa"
VERSION = "0.32.0-coding-dungeons.1"
EMSDK_VERSION = "5.0.1"
EMSDK_RELEASE = "bf32ae8b61ac8efeb7eca01b54c8307f992724f7"
SOURCE_BEFORE = "4f15a9e33819635474a9e43aa523f42ea3a6b452bfd8467223fcfbf6e447cc43"
SOURCE_AFTER = "2582f9088effc1ed16969977e02d6f926eff547426e69cd03c9f59560555c1d9"
PACKAGE_NAME = "@jitl/quickjs-wasmfile-release-sync"
PACKAGE_ARCHIVE = "quickjs-wasmfile-release-sync-0.32.0.tgz"
INPUTS = (
    {
        "filename": "wrapper.tar.gz",
        "url": "https://codeload.github.com/justjake/quickjs-emscripten/tar.gz/" + WRAPPER_COMMIT,
        "algorithm": "sha256",
        "digest": "b6f342ad8e18bcff29ab4e78467d6e33c53c9e1a47986e58b91a1462beb31a8e",
    },
    {
        "filename": "841dd03.patch",
        "url": "https://github.com/bellard/quickjs/commit/" + PATCH_COMMIT + ".patch",
        "algorithm": "sha256",
        "digest": "73ffcfdf77f71d6a554bd6dc05aa3e3061926fb96d1e4c6096c068b67ef9cf52",
    },
    {
        "filename": "68caa5f.patch",
        "url": "https://github.com/bellard/quickjs/commit/" + CONSTRUCTOR_PATCH_COMMIT + ".patch",
        "algorithm": "sha256",
        "digest": "4cded7d64f93f9830b94ef565eba1c2938b960b2cb47fe960c46a388377b4b13",
    },
    {
        "filename": "proxy-ownkeys-overflow.patch",
        "localPath": "vendor/quickjs/proxy-ownkeys-overflow.patch",
        "algorithm": "sha256",
        "digest": "c6053a3f1ff6eaa6772bfc3ea2ce71868aad60b166b453c899d3fecd6c13645e",
    },
    {
        "filename": PACKAGE_ARCHIVE,
        "url": "https://registry.npmjs.org/@jitl/quickjs-wasmfile-release-sync/-/quickjs-wasmfile-release-sync-0.32.0.tgz",
        "algorithm": "sha512",
        "digest": base64.b64decode("BKNDI/TPBfGlLNGYpLrhcDGXmIk4xHm4MRAisOBnOzpXVn9HZWsfmMAc9WMBrAHjvvds6HOikKeaOBKdPdpVrg==").hex(),
    },
)
GLUES = (
    ("CJS", "emscripten-module.cjs"),
    ("MJS", "emscripten-module.mjs"),
    ("BROWSER", "emscripten-module.browser.mjs"),
    ("CLOUDFLARE", "emscripten-module.cloudflare.cjs"),
)
MAKE_FLAGS = ["-j1", "CFLAGS_ESM=-s EXPORT_ES6=1 -s ENVIRONMENT=node"]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run(argv, cwd=None, capture=False):
    print("+ " + " ".join(str(part) for part in argv), flush=True)
    result = subprocess.run(argv, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.STDOUT if capture else None)
    return result.stdout if capture else None


def get_input(spec, destination, archives):
    target = destination / spec["filename"]
    preloaded = archives / spec["filename"] if archives else None
    if preloaded is not None and preloaded.is_file():
        data = preloaded.read_bytes()
    elif "localPath" in spec:
        data = (Path(__file__).resolve().parent.parent / spec["localPath"]).read_bytes()
    else:
        print("Downloading " + spec["url"], flush=True)
        request = urllib.request.Request(spec["url"], headers={"User-Agent": "Coding-Dungeons-reproducible-build/1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            if not response.geturl().startswith("https://"):
                raise RuntimeError("An input download redirected away from HTTPS")
            data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise RuntimeError("Oversized input: " + spec["filename"])
    digest = hashlib.new(spec["algorithm"], data).hexdigest()
    if digest != spec["digest"]:
        raise RuntimeError("Input digest mismatch: " + spec["filename"])
    target.write_bytes(data)
    return {**spec, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def quickjs_only_patch(full_patch, destination):
    """Extract exactly the quickjs.c diff from an already authenticated patch."""
    data = full_patch.read_bytes()
    marker = b"diff --git a/quickjs.c b/quickjs.c\n"
    if data.count(marker) != 1:
        raise RuntimeError("Expected exactly one quickjs.c diff in " + full_patch.name)
    start = data.index(marker)
    end = data.find(b"\ndiff --git ", start + len(marker))
    derived = data[start:] if end == -1 else data[start:end + 1]
    destination.write_bytes(derived)
    return destination


def apply_patch(quickjs, patch, identity):
    before = sha256(quickjs)
    argv = ["patch", "--batch", "--forward", "--fuzz=0", "-p1", "-i", str(patch)]
    run(argv + ["--dry-run"], cwd=quickjs.parent)
    run(argv, cwd=quickjs.parent)
    after = sha256(quickjs)
    if before == after:
        raise RuntimeError("The security patch did not change quickjs.c: " + patch.name)
    return {**identity, "appliedPatchSha256": sha256(patch),
            "sourceSha256Before": before, "sourceSha256After": after}


def extract_regular(archive, destination, expected_root):
    """Extract only bounded regular files/directories inside the expected root."""
    destination.mkdir(parents=True)
    total = 0
    seen = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or not path.parts or path.parts[0] != expected_root
                    or not (member.isdir() or member.isfile())):
                raise RuntimeError("Unsafe archive entry: " + member.name)
            if member.name in seen:
                raise RuntimeError("Duplicate archive entry: " + member.name)
            seen.add(member.name)
            total += member.size
            if total > 256 * 1024 * 1024:
                raise RuntimeError("Expanded archive exceeds the size limit")
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as payload, target.open("xb") as output:
                    shutil.copyfileobj(payload, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    return destination / expected_root


def generate_symbols(source, package, variant):
    interface = (source / "c/interface.c").read_text(encoding="utf-8")
    declarations = re.findall(r"^([\w()* ]+[\s*]+)(QTS_\w+)(\((.*?)\)) ?{$", interface, re.M)
    available = [(ret, name) for ret, name, _, _ in declarations
                 if "AsyncifyOnly" not in ret and "DebugOnly" not in ret]
    names = [name for _, name in available]
    ffi = (package / "dist/ffi.mjs").read_text(encoding="utf-8")
    ffi_names = re.findall(r'cwrap\("(QTS_\w+)"', ffi)
    if len(names) != 68 or len(set(names)) != 68 or sorted(names) != sorted(ffi_names):
        raise RuntimeError("Generated symbols do not match the pinned package FFI")
    callback_declarations = re.findall(r"^\s*EM_JS\((.+), ?{$", interface, re.M)
    callbacks = []
    for declaration in callback_declarations:
        ret, name, *_ = re.split(r"\s*,", declaration)
        if "MaybeAsync" in ret:
            callbacks.append(name.strip())
    symbols = {
        "symbols.json": ["_" + name for name in names] + ["_malloc", "_free"],
        "asyncify-remove.json": [name for ret, name in available if "MaybeAsync" not in ret],
        "asyncify-imports.json": callbacks,
    }
    generated = variant / "build/wrapper"
    generated.mkdir(parents=True)
    for filename, value in symbols.items():
        write_json(generated / filename, value)
    return symbols


def deterministic_tar(package, output):
    """Fix ordering, timestamps, owner names, permissions, and gzip metadata."""
    with output.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as archive:
                entries = [package] + sorted(package.rglob("*"), key=lambda path: path.relative_to(package).as_posix())
                for path in entries:
                    if path.is_symlink() or not (path.is_dir() or path.is_file()):
                        raise RuntimeError("Unsafe packaged entry: " + str(path))
                    relative = path.relative_to(package).as_posix()
                    name = "package" if relative == "." else "package/" + relative
                    info = tarfile.TarInfo(name)
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ""
                    if path.is_dir():
                        info.type, info.mode = tarfile.DIRTYPE, 0o755
                        archive.addfile(info)
                    else:
                        data = path.read_bytes()
                        info.mode, info.size = 0o644, len(data)
                        archive.addfile(info, io.BytesIO(data))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--archives", type=Path)
    args = parser.parse_args()
    work, output = args.work_dir.resolve(), args.output.resolve()
    sidecar = output.with_name(output.name + ".provenance.json")
    if os.name != "posix":
        parser.error("Run inside Linux/WSL with the pinned Emscripten SDK activated")
    if work.exists() or any(char.isspace() for char in str(work)):
        parser.error("--work-dir must be a new path with no whitespace")
    if output.exists() or sidecar.exists():
        parser.error("Output/provenance already exists; choose new output filenames")
    if args.archives is not None and not args.archives.is_dir():
        parser.error("--archives must be an existing directory")
    for tool in ("emcc", "make", "patch"):
        if shutil.which(tool) is None:
            parser.error("Missing build tool on PATH: " + tool)
    compiler_version = run(["emcc", "--version"], capture=True)
    # A fresh SDK may print a sanity-check notice before its version banner.
    version_lines = compiler_version.splitlines()
    banner = next((index for index, line in enumerate(version_lines) if line.startswith("emcc ")), None)
    if banner is None:
        parser.error("The compiler did not identify itself as emcc")
    compiler_version = "\n".join(version_lines[banner:])
    if not re.search(r"\b5\.0\.1\b", compiler_version.splitlines()[0]):
        parser.error("Expected emcc 5.0.1; got " + compiler_version.splitlines()[0])
    work.mkdir(parents=True)
    inputs_dir = work / "inputs"
    inputs_dir.mkdir()
    inputs = [get_input(spec, inputs_dir, args.archives) for spec in INPUTS]
    source = extract_regular(inputs_dir / "wrapper.tar.gz", work / "source", "quickjs-emscripten-" + WRAPPER_COMMIT)
    package = extract_regular(inputs_dir / PACKAGE_ARCHIVE, work / "npm", "package")
    quickjs = source / "vendor/quickjs/quickjs.c"
    if sha256(quickjs) != SOURCE_BEFORE:
        raise RuntimeError("Pinned vendor/quickjs/quickjs.c does not match the expected baseline")
    fixes = [apply_patch(quickjs, inputs_dir / "841dd03.patch", {
        "issue": "https://github.com/bellard/quickjs/issues/492",
        "commit": PATCH_COMMIT, "kind": "upstream",
    })]
    constructor_patch = quickjs_only_patch(inputs_dir / "68caa5f.patch", inputs_dir / "68caa5f-quickjs-only.patch")
    fixes.append(apply_patch(quickjs, constructor_patch, {
        "issue": "https://github.com/bellard/quickjs/issues/478",
        "commit": CONSTRUCTOR_PATCH_COMMIT, "kind": "upstream-quickjs-only",
        "fullPatchSha256": sha256(inputs_dir / "68caa5f.patch"),
    }))
    fixes.append(apply_patch(quickjs, inputs_dir / "proxy-ownkeys-overflow.patch", {
        "issue": "https://github.com/bellard/quickjs/issues/535",
        "kind": "local-hardening",
        "description": "Reject ownKeys lengths exceeding SIZE_MAX / sizeof(tab[0]) before allocation",
    }))
    if sha256(quickjs) != SOURCE_AFTER:
        raise RuntimeError("Patched quickjs.c differs from the reviewed source")
    metadata_path = package / "package.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("name") != PACKAGE_NAME or metadata.get("version") != "0.32.0":
        raise RuntimeError("Unexpected base npm package identity")
    if not (package / "LICENSE").is_file():
        raise RuntimeError("The base package is missing its license")
    original_ffi = {path.name: sha256(path) for path in (package / "dist").glob("ffi*")}
    variant = source / "packages/variant-quickjs-wasmfile-release-sync"
    symbols = generate_symbols(source, package, variant)
    wasm_hashes = {}
    for target, glue in GLUES:
        run(["make", *MAKE_FLAGS, target], cwd=variant)
        wasm_hashes[target] = sha256(variant / "dist/emscripten-module.wasm")
        if not (variant / "dist" / glue).is_file():
            raise RuntimeError("The expected generated glue is missing: " + glue)
    if len(set(wasm_hashes.values())) != 1:
        raise RuntimeError("Node/browser/cloudflare glue builds produced different WASM; do not package a mismatched module")
    for filename in [glue for _, glue in GLUES] + ["emscripten-module.wasm"]:
        shutil.copyfile(variant / "dist" / filename, package / "dist" / filename)
    if original_ffi != {path.name: sha256(path) for path in (package / "dist").glob("ffi*")}:
        raise RuntimeError("The package FFI was unexpectedly changed")
    metadata["version"] = VERSION
    metadata.pop("scripts", None)
    metadata["files"] = sorted(set(metadata.get("files", []) + ["PROVENANCE.json"]))
    write_json(metadata_path, metadata)
    readme = package / "README.md"
    with readme.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write("\n\n## Coding Dungeons security build\n\n"
                     "Version: " + VERSION + ". Base: " + PACKAGE_NAME + "@0.32.0.\n\n"
                     "Rebuilt from quickjs-emscripten " + WRAPPER_COMMIT + " with Bellard QuickJS fixes " + PATCH_COMMIT + " and " + CONSTRUCTOR_PATCH_COMMIT + ". "
                     "These fix the TypedArray.prototype.with buffer overflow (#492) and TypedArray constructor reentrancy (#478). "
                     "A narrowly scoped local patch also rejects overflowing Proxy ownKeys allocations on WASM32 (#535). "
                     "The FFI and package entry points are unchanged. Built with Emscripten " + EMSDK_VERSION + ". "
                     "See PROVENANCE.json for verified inputs, build configuration and output hashes. "
                     "The upstream MIT license is retained.\n")
    provenance = {
        "schemaVersion": 1, "package": PACKAGE_NAME, "version": VERSION,
        "wrapperCommit": WRAPPER_COMMIT, "quickjsBase": "2025-09-13+f1139494",
        "quickjsPatchCommit": PATCH_COMMIT,
        "fixes": fixes,
        "quickjsSourceSha256Before": SOURCE_BEFORE,
        "quickjsSourceSha256After": sha256(quickjs),
        "inputs": inputs,
        "build": {
            "emscriptenVersion": EMSDK_VERSION, "emsdkReleaseHash": EMSDK_RELEASE,
            "emccVersionOutput": compiler_version.strip(),
            "makeArguments": MAKE_FLAGS, "targets": [target for target, _ in GLUES],
            "makefileSha256": sha256(variant / "Makefile"),
            "exportedRuntimeMethods": json.loads((source / "exportedRuntimeMethods.json").read_text()),
            "generatedSymbols": symbols,
        },
        "wasmSha256ByTarget": wasm_hashes,
        "artifacts": {path.relative_to(package).as_posix(): sha256(path)
                      for path in sorted(package.rglob("*")) if path.is_file()},
    }
    write_json(package / "PROVENANCE.json", provenance)
    output.parent.mkdir(parents=True, exist_ok=True)
    deterministic_tar(package, output)
    write_json(sidecar, {**provenance, "npmTarball": {
        "sha256": sha256(output),
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(output.read_bytes()).digest()).decode("ascii"),
        "bytes": output.stat().st_size,
    }})
    print("Built " + str(output), flush=True)
    print("SHA256 " + sha256(output), flush=True)
    print("Provenance " + str(sidecar), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print("Build failed: " + str(error), file=sys.stderr)
        sys.exit(1)
