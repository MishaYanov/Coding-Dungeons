"""Audit installed book artifacts against the reader manifest and editable lessons."""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
from shutil import which
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from zipfile import ZipFile

from PIL import Image
import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
WORLDS = ("javascript", "typescript", "csharp", "rust", "go")


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verify_typescript_examples(kit, levels):
    compiler = ROOT / "node_modules/typescript/bin/tsc"
    if not compiler.is_file():
        raise SystemExit("Run npm ci to install the pinned TypeScript compiler.")
    with TemporaryDirectory(prefix="ferrum-typescript-book-") as tmp:
        for level in levels:
            example = f"level-{level:02}.ts"
            Path(tmp, example).write_bytes(kit.read(f"examples/{example}"))
            subprocess.run(
                ["node", str(compiler), "--strict", "--target", "ES2022", "--noEmit", example],
                cwd=tmp, check=True, timeout=30,
            )
    print(f"TypeScript: {len(levels)} exported examples pass the documented compiler command.", flush=True)


def verify_csharp_examples(kit, lessons):
    dotnet = os.environ.get("DUNGEONS_DOTNET") or which("dotnet")
    if not dotnet:
        raise SystemExit("Install the .NET 10 SDK to check the C# examples.")
    dotnet = str(Path(dotnet).resolve())
    with TemporaryDirectory(prefix="ferrum-csharp-book-") as tmp:
        directory = Path(tmp)
        (directory / "global.json").write_text(json.dumps({"sdk": {
            "version": "10.0.100", "rollForward": "latestFeature", "allowPrerelease": False,
        }}), encoding="utf-8")
        (directory / "NuGet.Config").write_text(
            '<configuration><packageSources><clear /></packageSources></configuration>', encoding="utf-8")
        env = {
            **os.environ, "DOTNET_ROOT": str(Path(dotnet).parent), "DOTNET_CLI_HOME": tmp,
            "DOTNET_CLI_TELEMETRY_OPTOUT": "1", "DOTNET_NOLOGO": "1", "NuGetAudit": "false",
        }
        sdk = subprocess.check_output([dotnet, "--version"], cwd=tmp, env=env, text=True, timeout=30).strip()
        if not sdk.startswith("10."):
            raise SystemExit(f"Use the .NET 10 SDK for the book checks (found {sdk}).")
        for index, lesson in enumerate(lessons, 1):
            for folder in ("examples", "starters"):
                filename = f"{folder}-{index:02}.cs"
                (directory / filename).write_bytes(kit.read(f"{folder}/level-{index:02}.cs"))
                result = subprocess.run([dotnet, "run", "--file", filename, "--property:PublishAot=false"], cwd=tmp, env=env,
                                        encoding="utf-8", capture_output=True, timeout=60)
                if result.returncode:
                    raise ValueError(f"C# {filename} failed with .NET SDK {sdk}:\n{result.stdout}\n{result.stderr}")
                output = result.stdout.strip().splitlines()
                if folder == "examples" and (not output or output[-1] != lesson["expectedOutput"]):
                    raise ValueError(f"Unexpected C# output from {filename}: {result.stdout}")
    print(f"C#: {len(lessons)} exported examples and {len(lessons)} starters ran on .NET SDK {sdk}.", flush=True)


def audit(world, check_typescript=False, check_csharp=False):
    rust = world == "rust"
    data = ROOT / "data" if rust else ROOT / "data/worlds" / world
    book = ROOT / "public/book" if rust else ROOT / "public/book" / world
    pdf_path = book / ("ferrum-expedition.pdf" if rust else "book.pdf")
    kit_path = book / ("ferrum-field-kit.zip" if rust else "field-kit.zip")
    pages = load(data / "pages.json")
    campaign = load(data / "campaign.json")
    quests = campaign["quests"]
    source = None if rust else load(data / "source.json")
    reader = PdfReader(pdf_path)
    revision = hashlib.sha256(pdf_path.read_bytes()).hexdigest()[:16]
    total = len(pages)
    assert len(reader.pages) == total
    assert len(quests) == (42 if rust else len(source["lessons"]))
    assert len(list((book / "pages").glob("*.webp"))) == total
    assert kit_path.read_bytes() in [blob for blobs in reader.attachments.values() for blob in blobs]
    levels = {q["level"] for q in quests}
    assert levels == set(range(1, len(quests) + 1))
    assert all(path["levels"] and set(path["levels"]) <= levels for path in campaign["paths"])
    if not rust:
        assert campaign["paths"] == source["paths"] and campaign["zones"] == source["zones"]
        assert campaign["world"]["number"] == WORLDS.index(world) + 1
    exercises = {e["id"]: e["level"] for e in load(data / "exercises.json")}
    seen_exercises = set()
    prompts = {}
    targets = {p.indirect_reference.idnum: i for i, p in enumerate(reader.pages, 1)}
    link_count = 0

    with ZipFile(kit_path) as kit, pdfplumber.open(pdf_path) as layout:
        assert kit.testzip() is None
        for n, (page, printed, inspected) in enumerate(zip(pages, reader.pages, layout.pages), 1):
            here = (world, n)
            assert (page["page"], page["total"]) == (n, total), here
            image = urlsplit(page["image"])
            assert image.query == f"v={revision}", here
            assert ROOT / "public" / image.path.lstrip("/") == book / "pages" / f"{n}.webp", here
            with Image.open(ROOT / "public" / image.path.lstrip("/")) as raster:
                assert raster.format == "WEBP" and min(raster.size) >= 500, here
                raster.load()

            assert any(42 <= c["top"] <= 606 for c in inspected.chars), (here, "blank body")
            outside = [c for c in inspected.chars if c["x0"] < (40 if rust and n == 1 else 42)
                       or c["x1"] > 391 or c["top"] < 15 or c["bottom"] > 632]
            assert not outside, (here, "text outside bounds", "".join(c["text"] for c in outside))

            destinations = []
            for ref in printed.get("/Annots", []):
                annotation = ref.get_object()
                if annotation.get("/Subtype") != "/Link":
                    continue
                dest = annotation.get("/Dest")
                if dest:
                    destinations.append(targets[dest.get_object()[0].idnum])
                else:
                    url = str(annotation.get("/A", {}).get("/URI", ""))
                    if url.startswith("https://"):
                        destinations.append(url)
            assert Counter(destinations) == Counter(
                link.get("page", link.get("url")) for link in page["links"]
            ), (here, "PDF and reader links differ")
            for link in page["links"]:
                x, y, w, h = (link[key] for key in ("x", "y", "w", "h"))
                assert x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 100.002 and y + h <= 100.002, (here, link)
            link_count += len(destinations)
            assert page["prompts"], here
            ids = set()
            for prompt in page["prompts"]:
                ident = prompt["id"]
                assert ident not in ids, (here, ident)
                ids.add(ident)
                if ident != "notes":
                    assert ident not in prompts, (here, ident)
                    prompts[ident] = (n, prompt)
                if prompt["type"] == "choice":
                    options = [option["id"] for option in prompt["options"]]
                    assert len(set(options)) == len(options) >= 2 and prompt["correctOption"] in options, here
                if exercise := prompt.get("exerciseId"):
                    assert exercises[exercise] == page["level"] and exercise not in seen_exercises, here
                    seen_exercises.add(exercise)
            inspected.close()

        assert seen_exercises == set(exercises)
        for quest in quests:
            level = quest["level"]
            assert all(pages[quest[key] - 1]["level"] == level for key in ("page", "manualPage", "bossPage", "sidePage"))
            assert prompts[f"boss-{level}"][0] == quest["bossPage"]
            assert prompts[f"side-{level}"][0] == quest["sidePage"]
            choice_page, choice = prompts[f"checkpoint-{level}"]
            assert choice_page == quest["manualPage" if rust else "bossPage"]
            if source:
                lesson = source["lessons"][level - 1]
                extension = {"javascript": "js", "typescript": "ts", "csharp": "cs", "go": "go"}[world]
                listing = prompts[f"listing-{level}-1"][1]
                boss = prompts[f"boss-{level}"][1]
                assert choice["body"] == lesson["question"] and choice["feedback"] == lesson["feedback"]
                assert [option["text"] for option in choice["options"]] == lesson["options"]
                assert choice["correctOption"] == str(lesson["correct"] + 1)
                assert boss["body"] == lesson["challenge"] and boss["starter"] == lesson["starter"]
                assert listing["starter"] == lesson["code"]
                for folder, key in (("examples", "code"), ("starters", "starter")):
                    exported = kit.read(f"{folder}/level-{level:02}.{extension}").decode("utf-8")
                    assert exported == lesson[key].rstrip() + "\n", (world, level, folder)
        if rust:
            assert len(reader.get_fields()) == 171
        if world == "typescript" and check_typescript:
            verify_typescript_examples(kit, sorted(levels))
        if world == "csharp" and check_csharp:
            verify_csharp_examples(kit, source["lessons"])
    print(f"{world}: {total} pages, {len(quests)} levels, {link_count} links, "
          f"{sum(len(p['prompts']) for p in pages)} GM cards, verified field kit", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", nargs="*", metavar="WORLD")
    parser.add_argument("--check-typescript", action="store_true",
                        help="compile the TypeScript kit examples using the documented command")
    parser.add_argument("--check-csharp", action="store_true",
                        help="run the C# kit programs with the .NET 10 SDK")
    args = parser.parse_args()
    for selected in args.world or WORLDS:
        if selected not in WORLDS:
            parser.error(f"Unknown world: {selected}")
        audit(selected, args.check_typescript, args.check_csharp)
