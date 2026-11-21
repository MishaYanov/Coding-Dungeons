# Offline Rust reference

The Rust GM searches a selection of standard-library functions and methods. Each card combines a declaration, the first paragraph of its official rustdoc description, its stability version, and game-authored notes about when to use it. The edition matches the desktop Rust compiler, 1.99.1. The “stable since” label describes ordinary stable use of the API. A function’s availability during const evaluation can have a different stabilization date.

The question is searched locally. Each source link is fixed when the pack is built, so opening the full manual sends no search text. Reference terms are available under **Documentation license** on each card. The upstream notice is the MIT text from the Rust distribution.

## Reproduce the extracts

Use Python 3.11 or later. Download the official archive into the ignored `out` directory. The generator compares its SHA-256 with the pinned value from the 1.99.1 release manifest before reading any HTML. It reads selected files directly from the archive.

```powershell
New-Item -ItemType Directory -Force out | Out-Null
$archive = 'out/rust-docs-1.99.1-windows-x64.tar.xz'
Invoke-WebRequest 'https://static.rust-lang.org/dist/2026-10-15/rust-docs-1.99.1-x86_64-pc-windows-msvc.tar.xz' -OutFile $archive
python work/scripts/build-rust-docs.py $archive --check
node --test test/rust-docs-content.test.mjs test/rust-docs-search.test.mjs
```

To add topics, extend the edition’s method or function list in `work/scripts/build-rust-docs.py`. Run the generator without `--check` to update `data/rust-docs-reference.json`, then add the corresponding summary, ownership notes, and everyday search phrases to `data/rust-docs.mjs`. Check the source paragraph and declaration for every new topic. If changing editions, update the date, version and SHA-256 together using the target platform’s `rust-docs` entry in that release’s toolchain manifest. [Rust 1.99.1 distribution manifest](https://static.rust-lang.org/dist/channel-rust-1.99.1.toml)
