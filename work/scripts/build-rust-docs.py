"""Build the inert GM reference extracts from the official 1.99.1 rust-docs archive."""

import argparse
import hashlib
import json
import re
import tarfile
from html import unescape
from pathlib import Path


VERSION = "1.99.1"
ARCHIVE = f"rust-docs-{VERSION}-x86_64-pc-windows-msvc"
SHA256 = "c4db27f2be81ea3df3672ae0211f12c47b9e0676e18d38d797f802bc4d77cb0c"
UPSTREAM = f"https://static.rust-lang.org/dist/2026-10-15/{ARCHIVE}.tar.xz"
OUTPUT = Path(__file__).resolve().parents[2] / "data" / "rust-docs-reference.json"

# Canonical rustdoc topics for this edition. Duplicated methods on deref and
# blanket impl sections use different anchors and are deliberately excluded.
METHODS = {
    "std/vec/struct.Vec.html": ("std::vec::Vec", "retain push pop remove swap_remove drain split_off with_capacity len dedup"),
    "std/primitive.slice.html": ("std::primitive::slice", "get get_mut split_at_mut chunks iter iter_mut sort_by_key len"),
    "std/string/struct.String.html": ("std::string::String", "retain push_str into_bytes pop len"),
    "std/primitive.str.html": ("std::primitive::str", "trim split split_whitespace parse chars get len"),
    "std/collections/struct.HashMap.html": ("std::collections::HashMap", "entry get insert"),
    "std/collections/hash_map/enum.Entry.html": ("std::collections::hash_map::Entry", "or_insert_with or_insert"),
    "std/iter/trait.Iterator.html": ("std::iter::Iterator", "map filter collect filter_map fold find enumerate"),
    "std/option/enum.Option.html": ("std::option::Option", "map as_ref take and_then ok_or_else unwrap_or_else"),
    "std/result/enum.Result.html": ("std::result::Result", "map as_ref map_err and_then"),
    "std/sync/struct.Arc.html": ("std::sync::Arc", "make_mut new"),
    "std/sync/struct.Mutex.html": ("std::sync::Mutex", "lock try_lock"),
    "std/sync/struct.OnceLock.html": ("std::sync::OnceLock", "get_or_init"),
    "std/cell/struct.RefCell.html": ("std::cell::RefCell", "try_borrow_mut"),
}
FUNCTIONS = {
    "std/mem/fn.take.html": "std::mem::take",
    "std/mem/fn.replace.html": "std::mem::replace",
    "std/thread/fn.spawn.html": "std::thread::spawn",
    "std/thread/fn.scope.html": "std::thread::scope",
    "std/sync/mpsc/fn.channel.html": "std::sync::mpsc::channel",
}


def plain(fragment):
    # Rustdoc adds a clickable "notable traits" glyph inside signatures.
    fragment = re.sub(r'<a\b[^>]*class="tooltip"[^>]*>.*?</a>', "", fragment, flags=re.S)
    fragment = fragment.replace('<div class="where">', " ")
    return " ".join(unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def match(pattern, page):
    found = re.search(pattern, page, flags=re.S)
    if not found:
        raise ValueError(f"Rustdoc markup did not contain {pattern!r}")
    return found.group(1)


def reference(page, path, item, method=None):
    if method:
        anchor = f"method.{method}"
        area = page.split(f'<section id="{anchor}"', 1)[1]
        heading, docs = area.split("</section>", 1)
        signature = match(r'<h4 class="code-header">(.*?)</h4>', heading)
        url_suffix = f"{path}#{anchor}"
        receiver = item.rsplit("::", 1)[-1]
        title = f"{receiver}::{method}"
        canonical = f"{item}::{method}"
    else:
        heading, docs = page.split('<pre class="rust item-decl">', 1)
        signature = match(r"<code>(.*?)</code></pre>", docs)
        url_suffix = path
        receiver, name = item.split("::")[-2:]
        title = f"{receiver}::{name}"
        canonical = item
    since = match(r'title="Stable since Rust version (\d+\.\d+\.\d+)', heading)
    excerpt = plain(match(r'<div class="docblock">\s*<p>(.*?)</p>', docs))
    declaration = plain(signature).removesuffix(",")
    declaration = declaration.replace("( ", "(").replace(", )", ")")
    return {
        "id": canonical,
        "title": title,
        "receiver": receiver,
        "signature": declaration,
        "since": since,
        "excerpt": excerpt,
        "url": f"https://doc.rust-lang.org/{VERSION}/{url_suffix}",
    }


def generate(archive):
    with archive.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != SHA256:
            raise ValueError(f"Expected the pinned release archive {UPSTREAM}")
    items = []
    license_text = None
    remaining = set(METHODS) | set(FUNCTIONS)
    prefix = f"{ARCHIVE}/rust-docs/share/doc/rust/html/"
    # Stream only the selected files. No archive paths are written to disk.
    with tarfile.open(archive, "r|xz") as bundle:
        for entry in bundle:
            if not entry.isfile():
                continue
            if entry.name == f"{ARCHIVE}/LICENSE-MIT":
                license_text = bundle.extractfile(entry).read().decode().strip()
                continue
            path = entry.name.removeprefix(prefix)
            if path not in remaining:
                continue
            remaining.remove(path)
            page = bundle.extractfile(entry).read().decode("utf-8")
            if path in FUNCTIONS:
                items.append(reference(page, path, FUNCTIONS[path]))
            else:
                item, methods = METHODS[path]
                items.extend(reference(page, path, item, method) for method in methods.split())
    if remaining or not license_text:
        raise ValueError(f"Incomplete Rust documentation archive. Missing topics: {remaining}")
    return {
        "version": VERSION,
        "indexUrl": f"https://doc.rust-lang.org/{VERSION}/std/",
        "sourceArchive": UPSTREAM,
        "sha256": SHA256,
        "license": license_text,
        "items": sorted(items, key=lambda entry: entry["id"]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--check", action="store_true", help="Compare checked-in extracts without writing.")
    args = parser.parse_args()
    pack = generate(args.archive)
    if args.check:
        if pack != json.loads(OUTPUT.read_text(encoding="utf-8")):
            raise SystemExit("Offline Rust reference differs from pinned documentation.")
    else:
        OUTPUT.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Verified {len(pack['items'])} Rust {VERSION} reference entries.")
