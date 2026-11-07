"""Audit installed book artifacts against the reader manifest and editable lessons."""

from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit
from zipfile import ZipFile

from PIL import Image
import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
WORLDS = ("javascript", "typescript", "rust", "go")


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def audit(world):
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
                extension = {"javascript": "js", "typescript": "ts", "go": "go"}[world]
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
    print(f"{world}: {total} pages, {len(quests)} levels, {link_count} links, "
          f"{sum(len(p['prompts']) for p in pages)} GM cards, verified field kit", flush=True)


if __name__ == "__main__":
    for selected in sys.argv[1:] or WORLDS:
        if selected not in WORLDS:
            raise SystemExit(f"Unknown world: {selected}")
        audit(selected)
