"""Export the selectable layer of a published book, using its existing pagination."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import statistics

import pdfplumber


ROOT = Path(__file__).resolve().parents[2]
BOOKS = {
    'javascript': ('public/book/javascript/book.pdf', 'data/worlds/javascript/pages.json'),
    'typescript': ('public/book/typescript/book.pdf', 'data/worlds/typescript/pages.json'),
    'rust': ('public/book/ferrum-expedition.pdf', 'data/pages.json'),
    'go': ('public/book/go/book.pdf', 'data/worlds/go/pages.json'),
}


def plain_line(chars):
    parts = []
    right = None
    for char in chars:
        # Separate independently positioned words, including columns in maps.
        if right is not None and char['x0'] - right > 1.6:
            parts.append(' ')
        parts.append(char['text'])
        right = char['x1']
    return ''.join(parts).strip()


def page_blocks(page):
    baselines = defaultdict(list)
    for glyph in page.chars:
        y = round(glyph['matrix'][5], 1)
        # The recurring page furniture appears at y=23..28 and y=620..622.
        if 38 < y < page.height - 36:
            baselines[y].append(glyph)

    blocks = []
    code = []
    previous_y = None
    prose_font = None
    code_baseline = None

    def flush_code():
        if code:
            # Blank source lines appear as baseline gaps. Infer the line
            # height using the same font metrics as the listing renderer.
            gaps = [left[0] - right[0] for left, right in zip(code, code[1:])]
            expected = code[0][2] * 1.32
            singles = [gap for gap in gaps if expected * .78 < gap < expected * 1.22]
            leading = statistics.median(singles) if singles else expected
            lines = [code[0][1]]
            for gap, (_, line, _) in zip(gaps, code[1:]):
                lines.extend([''] * max(0, round(gap / leading) - 1))
                lines.append(line)
            blocks.append(['code', '\n'.join(lines)])
            code.clear()

    for y, glyphs in sorted(baselines.items(), reverse=True):
        glyphs.sort(key=lambda char: char['x0'])
        if not any(char['text'].strip() for char in glyphs):
            continue
        font = glyphs[0]['fontname'].split('+')[-1]
        size = glyphs[0]['size']
        is_code = all('Consolas' in char['fontname'] and char['size'] < 8.6 for char in glyphs)
        if is_code:
            if code_baseline is not None and code_baseline - y > 45:
                flush_code()
            code.append((y, ''.join(char['text'] for char in glyphs).rstrip(), size))
            code_baseline = y
            previous_y = None
            continue
        flush_code()
        code_baseline = None
        line = plain_line(glyphs)
        is_heading = 'Calibri-Bold' in font and size >= 11.4
        families = {char['fontname'].split('+')[-1].split('-')[0] for char in glyphs}
        # An inline Consolas fragment can start a wrapped body line.
        family = next((body for body in ('Georgia', 'Calibri') if body in families), font.split('-')[0])
        if is_heading:
            blocks.append(['h', line])
        elif (blocks and blocks[-1][0] == 'p' and previous_y is not None
              and 11 < previous_y - y < 15.2 and family == prose_font):
            blocks[-1][1] += ' ' + line
        else:
            blocks.append(['p', line])
        previous_y = y
        prose_font = family
    flush_code()
    return blocks


def build(world, check):
    pdf_path, page_index = (ROOT / name for name in BOOKS[world])
    metadata = json.loads(page_index.read_text(encoding='utf-8-sig'))
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != len(metadata):
            raise ValueError(f'{world} PDF and page index disagree.')
        pages = []
        for page in pdf.pages:
            blocks = page_blocks(page)
            if not blocks or any('\ufffd' in value or '(cid:' in value for _, value in blocks):
                raise ValueError(f'{world} page {page.page_number} has no reliable text layer.')
            pages.append(blocks)
            page.close()
    document = {'version':1, 'world':world, 'pdfSha256':hashlib.sha256(pdf_path.read_bytes()).hexdigest(), 'pages':pages}
    output = pdf_path.with_name('reader-text.json')
    text = json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n'
    if check:
        if not output.is_file() or output.read_text(encoding='utf-8') != text:
            raise ValueError(f'Regenerate the text for {world}.')
    else:
        output.write_text(text, encoding='utf-8', newline='\n')
    print(f'{world}: {len(pages)} text pages, {sum(len(page) for page in pages)} blocks')


if __name__ == '__main__':
    options = argparse.ArgumentParser(description=__doc__)
    options.add_argument('world', nargs='?', choices=BOOKS)
    options.add_argument('--check', action='store_true')
    args = options.parse_args()
    for id in [args.world] if args.world else BOOKS:
        build(id, args.check)
