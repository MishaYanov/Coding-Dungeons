"""Build the JavaScript, TypeScript, and Go books and reader data."""

import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer

APP = Path(__file__).resolve().parent
ROOT = APP if (APP / 'work/scripts/build_book.py').is_file() else APP.parents[1]
sys.path.insert(0, str(ROOT / 'work/scripts'))
from build_book import CodeBlock, PAGE_H, PAGE_W, STYLES, WIDTH, HEIGHT, MARGIN_X, MARGIN_BOTTOM, inline


WORLDS = [
    (1, 'javascript', 'JavaScript', 'js', '#815718'),
    (2, 'typescript', 'TypeScript', 'ts', '#245795'),
    (4, 'go', 'Go', 'go', '#22665c'),
]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def paragraph(text, style='body'):
    return Paragraph(inline(text), STYLES[style])


def link(text, target):
    return f'<link href="#{target}" color="#214f78"><u>{inline(text)}</u></link>'


def nav(*items):
    return Paragraph(' &nbsp; · &nbsp; '.join(link(label, target) for label, target in items), STYLES['part'])


def heading(text, anchor, depth=0):
    flow = paragraph(text, 'h1')
    flow.bookmark = (anchor, text, depth)
    return flow


class CompactCodeBlock(CodeBlock):
    def wrap(self, available_width, available_height):
        super().wrap(available_width, available_height)
        self.leading = self.font_size * 1.17
        self.height = len(self.lines) * self.leading + self.top + 3
        return self.width, self.height


def listing(source, label, kind, language):
    lines = source.splitlines()
    if language == 'Go':
        lines = [line.expandtabs(4) for line in lines]
    block = CompactCodeBlock if language == 'Go' and len(lines) > 40 else CodeBlock
    return block(lines, label, kind=kind)


class WorldBook(BaseDocTemplate):
    def __init__(self, path, number, name, accent):
        self.world_name = f'World {number} / {name}'
        self.accent = colors.HexColor(accent)
        self.locations = {}
        super().__init__(str(path), pagesize=(PAGE_W, PAGE_H),
                         title=f'Ferrum - {self.world_name}', author='Ferrum Expeditions',
                         pageCompression=1, allowSplitting=1)
        frame = Frame(MARGIN_X, MARGIN_BOTTOM, WIDTH, HEIGHT, leftPadding=0,
                      rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate('world', [frame], onPage=self.decorate))

    def decorate(self, canvas, doc):
        canvas.setStrokeColor(self.accent)
        canvas.setLineWidth(1.2)
        canvas.line(MARGIN_X, PAGE_H - 37, PAGE_W - MARGIN_X, PAGE_H - 37)
        canvas.setFillColor(self.accent)
        canvas.setFont('HeadBold', 8.5)
        canvas.drawString(MARGIN_X, PAGE_H - 28, f'FERRUM EXPEDITIONS / {self.world_name.upper()}')
        canvas.setFont('Head', 9)
        canvas.drawString(MARGIN_X, 23, 'World map')
        canvas.linkRect('', 'map', (MARGIN_X, 21, MARGIN_X + 51, 35), relative=0, thickness=0)
        canvas.drawRightString(PAGE_W - MARGIN_X, 23, str(doc.page))

    def afterFlowable(self, flowable):
        if not hasattr(flowable, 'bookmark'):
            return
        key, title, depth = flowable.bookmark
        self.locations[key] = self.page
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title, key, depth)


def validate_world(source):
    levels = set(range(1, len(source['lessons']) + 1))
    covered = [n for zone in source['zones'] for n in range(zone['first'], zone['last'] + 1)]
    if covered != sorted(levels):
        raise ValueError('World zones must cover each level in order.')
    if len(source['paths']) < 2 or any(not path['levels'] or not set(path['levels']) <= levels for path in source['paths']):
        raise ValueError('Each world needs a beginner route and another route with valid levels.')
    for n, lesson in enumerate(source['lessons'], 1):
        if len(lesson['options']) < 2 or not 0 <= lesson['correct'] < len(lesson['options']):
            raise ValueError(f'Invalid checkpoint in level {n}.')
        if not lesson['body'] or not lesson['code'].strip() or not lesson['starter'].strip():
            raise ValueError(f'Incomplete instruction or challenge in level {n}.')


def book_story(source, number, name, accent):
    title = ParagraphStyle('World title', parent=STYLES['h1'], fontSize=34, leading=38,
                           spaceAfter=18, textColor=colors.HexColor(accent))
    map_item = ParagraphStyle('Map entry', parent=STYLES['reference'], leading=12, spaceAfter=1.8)
    manual_text = ParagraphStyle('Manual text', parent=STYLES['body'], leading=13.4, spaceAfter=5.5)
    lessons = source['lessons']
    story = [Spacer(1, 45), paragraph(f'WORLD {number} / {name.upper()}', 'part'),
             Paragraph(inline(source['title']), title), paragraph(source['subtitle'], 'h2')]
    story.extend(paragraph(line) for line in source['intro'])
    story.extend([paragraph('Start with the beginner route if these ideas are new to you. In the game, '
                            'choose a hero to save your checkpoint answers, code drafts, and quest log. '
                            'The attached field kit contains the worked examples, starter files, and a quest journal.'),
                  nav(('Explore the world map', 'map'), ('Begin Level 01', 'level-1')), PageBreak(),
                  heading('World map', 'map')])
    for path in source['paths']:
        start = path['levels'][0]
        story.extend([Paragraph(f'<b>{link(path["name"], f"level-{start}")}</b>', STYLES['h3']),
                      paragraph(path['description'])])
    for zone in source['zones']:
        story.append(paragraph(zone['name'], 'h3'))
        for n in range(zone['first'], zone['last'] + 1):
            story.append(Paragraph(link(f'{n:02d} / {lessons[n - 1]["title"]}', f'level-{n}'),
                                   map_item))
    for n, lesson in enumerate(lessons, 1):
        story.extend([PageBreak(), paragraph(f'LEVEL {n:02d} / FIELD MANUAL', 'part'),
                      heading(lesson['title'], f'level-{n}'), paragraph(lesson['objective'], 'part')])
        story.extend(Paragraph(inline(body), manual_text) for body in lesson['body'])
        example_title = paragraph(f'Worked example / Level {n:02d}', 'h2')
        example_title.bookmark = (f'example-{n}', 'Worked example', 1)
        story.extend([KeepTogether([
                          example_title,
                          listing(lesson['code'], f'Listing {n}.1', f'{name} example', name),
                          paragraph(f'**Remember.** {lesson["takeaway"]}'),
                          nav(('Try the encounter', f'encounter-{n}'))]),
                      PageBreak(), paragraph(f'LEVEL {n:02d} / FORGE', 'part'),
                      heading('The encounter', f'encounter-{n}', 1), paragraph('Checkpoint', 'h2'),
                      paragraph(lesson['question'])])
        story.extend(paragraph(f'{chr(65 + i)}. {option}') for i, option in enumerate(lesson['options']))
        story.extend([paragraph('Code challenge', 'h2'), paragraph(lesson['challenge']),
                      listing(lesson['starter'], f'Level {n}', 'starter', name),
                      nav(('Read the debrief', f'debrief-{n}'), ('Back to the field manual', f'level-{n}')),
                      PageBreak(), paragraph(f'LEVEL {n:02d} / EXPLAIN', 'part'),
                      heading('Debrief and side quest', f'debrief-{n}', 1),
                      paragraph(f'**Checkpoint.** {chr(65 + lesson["correct"])}. {lesson["feedback"]}'),
                      paragraph('Hint one', 'h2'), paragraph(lesson['hint1']),
                      paragraph('Hint two', 'h2'), paragraph(lesson['hint2']),
                      paragraph('Compare your solution', 'h2'), paragraph(lesson['debrief']),
                      paragraph('Side quest', 'h2'), paragraph(lesson['sideQuest'])])
        if n < len(lessons):
            story.append(nav((f'Continue to Level {n + 1:02d}', f'level-{n + 1}'), ('World map', 'map')))
        else:
            story.append(nav(('Revisit the world map', 'map'), ('Return to Level 01', 'level-1')))
    return story


def build_kit(path, source, number, name, extension):
    instructions = {
        'js': 'Run a worked example with node examples/level-01.js.',
        'ts': 'With TypeScript installed, check a worked example with '
              'tsc --strict --target ES2022 --noEmit examples/level-01.ts.',
        'go': 'With Go installed, run a worked example with go run examples/level-01.go.',
    }[extension]
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as kit:
        kit.writestr('README.txt', f'Ferrum World {number} / {name}\n{source["title"]}\n\n'
                     f'{instructions}\n\nUse the starter files to try each challenge. '
                     'The book has hints, debriefs, and side quests.\n')
        for n, lesson in enumerate(source['lessons'], 1):
            kit.writestr(f'examples/level-{n:02d}.{extension}', lesson['code'].rstrip() + '\n')
            kit.writestr(f'starters/level-{n:02d}.{extension}', lesson['starter'].rstrip() + '\n')
        journal = '\n\n'.join(f'Level {n:02d} / {lesson["title"]}\n'
                             'Scout [ ]  Forge [ ]  Explain [ ]  Side quest [ ]\n'
                             'Prediction:\nWhat I tested:\nWhat I learned:'
                             for n, lesson in enumerate(source['lessons'], 1))
        kit.writestr('Quest_Journal.txt', journal + '\n')
    with zipfile.ZipFile(path) as kit:
        if kit.testzip() is not None:
            raise ValueError(f'Invalid field kit for {name}.')


def page_links(page, numbers):
    links = []
    width, height = map(float, (page.mediabox.width, page.mediabox.height))
    for ref in page.get('/Annots', []):
        annotation = ref.get_object()
        if annotation.get('/Subtype') != '/Link' or not annotation.get('/Dest'):
            continue
        target = annotation['/Dest'][0].idnum
        x0, y0, x1, y1 = map(float, annotation['/Rect'])
        links.append(dict(x=round(x0 / width * 100, 3), y=round((height - y1) / height * 100, 3),
                          w=round((x1 - x0) / width * 100, 3), h=round((y1 - y0) / height * 100, 3),
                          page=numbers[target], label=f'Open book page {numbers[target]}'))
    return links


def game_data(pdf, source, number, slug, name, locations):
    reader = PdfReader(io.BytesIO(pdf))
    total = len(reader.pages)
    revision = hashlib.sha256(pdf).hexdigest()[:16]
    numbers = {p.indirect_reference.idnum: n for n, p in enumerate(reader.pages, 1)}
    quests = []
    pages = [dict(page=n, total=total, level=0, title=source['title'],
                  image=f'/book/{slug}/pages/{n}.webp?v={revision}',
                  links=page_links(page, numbers), notes=[], prompts=[], hintKinds=[])
             for n, page in enumerate(reader.pages, 1)]
    pages[0]['notes'] = source['intro'][:1]
    pages[locations['map'] - 1]['notes'] = ['Pick a route or jump to a level. Every level is available.']
    lessons = source['lessons']
    for n, lesson in enumerate(lessons, 1):
        manual = locations[f'level-{n}']
        example = locations[f'example-{n}']
        encounter = locations[f'encounter-{n}']
        side = locations[f'debrief-{n}']
        end = locations[f'level-{n + 1}'] - 1 if n < len(lessons) else total
        for page in pages[manual - 1:end]:
            page.update(level=n, title=lesson['title'])
        quests.append(dict(level=n, mission_title=lesson['title'], objective=lesson['objective'],
                           page=manual, manualPage=manual, bossPage=encounter, sidePage=side,
                           boss_title='Code challenge', boss_brief=lesson['challenge'],
                           side_quest=lesson['sideQuest'], loadout=[n - 1] if n > 1 else [],
                           route_choices=[dict(level=n + 1, label='Continue', reason=lessons[n]['title'])]
                           if n < len(lessons) else [], hint1=lesson['hint1'], hint2=lesson['hint2'],
                           debrief=lesson['debrief']))
        pages[manual - 1]['notes'] = [lesson['objective']]
        pages[example - 1]['notes'].append(lesson['takeaway'])
        pages[example - 1]['prompts'].append(dict(
            id=f'listing-{n}-1', type='code', title=f'Listing {n}.1 scratchpad',
            body='Predict the output. Then change one input and explain the result.',
            starter=lesson['code'], feedback='Your code draft is saved.'))
        pages[encounter - 1].update(notes=['Answer the checkpoint, then save a code draft for the challenge.'],
                                   hintKinds=['hint1', 'hint2', 'debrief'], prompts=[
            dict(id=f'checkpoint-{n}', type='choice', title='GM checkpoint', body=lesson['question'],
                 options=[dict(id=str(i), text=option) for i, option in enumerate(lesson['options'], 1)],
                 correctOption=str(lesson['correct'] + 1), feedback=lesson['feedback']),
            dict(id=f'boss-{n}', type='code', title='Code challenge', body=lesson['challenge'],
                 starter=lesson['starter'], feedback='Draft saved. Compare it with the debrief, then mark Forge self-review.')])
        pages[side - 1].update(notes=['Compare your solution with the debrief before marking Forge.'],
                               hintKinds=['debrief'], prompts=[
            dict(id=f'side-{n}', type='text', title='Side quest', body=lesson['sideQuest'],
                 feedback='Side quest notes saved. Mark the side quest when you can explain what changed.')])
    for page in pages:
        if not page['prompts']:
            page['prompts'] = [dict(id='notes', type='text', title='Field notes',
                                    body='Record a question, prediction, or takeaway.', feedback='Notes saved.')]
    return dict(world=dict(id=slug, number=number, name=name, title=source['title'], subtitle=source['subtitle']),
                zones=source['zones'], paths=source['paths'], quests=quests, rooms=[]), pages


def build_world(number, slug, name, extension, accent):
    data = APP / 'data/worlds' / slug
    source = json.loads((data / 'source.json').read_text(encoding='utf-8-sig'))
    validate_world(source)
    output = APP / 'public/book' / slug
    (output / 'pages').mkdir(parents=True, exist_ok=True)
    poppler = shutil.which('pdftoppm')
    if not poppler:
        raise RuntimeError('Install Poppler and add pdftoppm to PATH to render the world books.')
    scratch = ROOT / 'work/qa/worlds'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'{slug}-', dir=scratch) as tmp:
        tmp = Path(tmp)
        raw = tmp / 'raw.pdf'
        document = WorldBook(raw, number, name, accent)
        document.build(book_story(source, number, name, accent))
        kit = tmp / 'field-kit.zip'
        build_kit(kit, source, number, name, extension)
        writer = PdfWriter(clone_from=raw)
        kit_name = f'Ferrum-{name}-Field-Kit.zip'
        writer.add_attachment(kit_name, kit.read_bytes())
        pdf = tmp / 'book.pdf'
        with pdf.open('wb') as stream:
            writer.write(stream)
        pdf_data = pdf.read_bytes()
        reader = PdfReader(io.BytesIO(pdf_data))
        if reader.attachments.get(kit_name) != [kit.read_bytes()]:
            raise ValueError(f'Embedded kit verification failed for {name}.')
        campaign, pages = game_data(pdf_data, source, number, slug, name, document.locations)
        subprocess.run([poppler, '-r', '100', '-png', str(pdf), str(tmp / 'page')], check=True)
        images = sorted(tmp.glob('page-*.png'))
        if len(images) != len(pages):
            raise ValueError(f'Page raster count mismatch for {name}.')
        for n, png in enumerate(images, 1):
            with Image.open(png) as image:
                image.convert('RGB').save(output / 'pages' / f'{n}.webp', 'WEBP', quality=91)
        for old_page in (output / 'pages').glob('*.webp'):
            if old_page.stem.isascii() and old_page.stem.isdecimal() and int(old_page.stem) > len(pages):
                old_page.unlink()
        shutil.copyfile(kit, output / 'field-kit.zip')
        shutil.copyfile(pdf, output / 'book.pdf')
    write_json(data / 'campaign.json', campaign)
    write_json(data / 'pages.json', pages)
    write_json(data / 'exercises.json', [])
    print(f'World {number} {name}: {len(pages)} pages, {len(campaign["quests"])} levels, '
          f'{sum(len(page["prompts"]) for page in pages)} interactive cards.', flush=True)


if __name__ == '__main__':
    for world in WORLDS:
        if not sys.argv[1:] or world[1] in sys.argv[1:]:
            build_world(*world)
