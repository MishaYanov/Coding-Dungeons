# Rebuild the Ferrum books

The Windows rebuild uses Python 3, Poppler's `pdftoppm` on `PATH`, and the Georgia, Calibri, and Consolas fonts from Windows. The reader uses the existing PDFs and page images directly.

Run these commands from the project folder to rebuild JavaScript, TypeScript, and Go.

```powershell
python -m pip install -r requirements-book.txt
python build-worlds.py
```

Edit `data/worlds/<world>/source.json` to change a campaign. Pass `javascript`, `typescript`, or `go` to rebuild only that world. The script generates its campaign and page data beside the source, then writes the PDF, WebP pages, and field kit under `public/book/<world>`. Each PDF also embeds its field kit.

The Rust rebuild also requires Node.js 24 or newer, Rust 1.99.1, and a host linker.

```powershell
python -m pip install -r requirements-book.txt
python work/scripts/build_campaign.py
npm run test:book
python work/scripts/package_examples.py
python work/scripts/package_campaign.py
python work/scripts/verify_campaign.py
python work/scripts/qa_campaign_layout.py final
python build-book.py
npm test
```

The technical manuscript lives in `work/manuscript`. Quest and route material live in `work/gamebook`. Edit multiple-choice checkpoint text in `data/checkpoints.json`. The exercise authoring script `work/ferrum-exercise-author.py` generates `data/exercises.json` with starters, reference implementations and tests. `build-book.py` maps these inputs onto the rebuilt PDF and regenerates `data/campaign.json`, `data/pages.json`, and `public/book`.

The packaging scripts build the field kit from the checked listings and attach it to the PDF. The PDF checks validate the attachment, navigation targets, listing labels, and fillable progress fields. The layout check flags empty pages and out-of-bounds text, renders the pages, and creates contact sheets in `work/qa/campaign/final`. Review edited pages there before publishing an updated reader. Keep prompt IDs and page anchors stable when editing a released campaign, since saved answers use both.

Run `python verify-worlds.py` against the finished reader. It checks every PDF page, page image, book link, and prompt binding, and compares the attached field kits with the downloaded copies. Pass a world ID to check just that world.
