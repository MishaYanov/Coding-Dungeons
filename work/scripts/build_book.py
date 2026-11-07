from pathlib import Path
import re
import html
import json
import textwrap
import math
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    PageBreak, Flowable, KeepTogether, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'work/manuscript'
OUTPUT = ROOT / 'outputs/Understanding_Rust.pdf'
QA = ROOT / 'work/qa'
QA.mkdir(exist_ok=True, parents=True)

for name, file in [
    ('Book', 'georgia.ttf'), ('BookBold', 'georgiab.ttf'),
    ('BookItalic', 'georgiai.ttf'), ('BookBI', 'georgiaz.ttf'),
    ('Head', 'calibri.ttf'), ('HeadBold', 'calibrib.ttf'),
    ('Code', 'consola.ttf'), ('CodeBold', 'consolab.ttf'),
]:
    pdfmetrics.registerFont(TTFont(name, f'C:/Windows/Fonts/{file}'))
pdfmetrics.registerFontFamily('Book', normal='Book', bold='BookBold',
                              italic='BookItalic', boldItalic='BookBI')
pdfmetrics.registerFontFamily('Head', normal='Head', bold='HeadBold',
                              italic='Head', boldItalic='HeadBold')
pdfmetrics.registerFontFamily('Code', normal='Code', bold='CodeBold',
                              italic='Code', boldItalic='CodeBold')

PAGE_W, PAGE_H = 432, 648
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 43.2, 45, 45
WIDTH = PAGE_W - 2 * MARGIN_X
HEIGHT = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM
STYLES = {
    'body': ParagraphStyle('body', fontName='Book', fontSize=10.5,
        leading=14.8, spaceAfter=6.5, textColor=colors.black,
        allowWidows=0, allowOrphans=0, splitLongWords=True),
    'h1': ParagraphStyle('chapter', fontName='HeadBold', fontSize=21,
        leading=24.6, spaceBefore=0, spaceAfter=19, keepWithNext=True,
        textColor=colors.black),
    'h2': ParagraphStyle('section', fontName='HeadBold', fontSize=14,
        leading=17.5, spaceBefore=13, spaceAfter=7, keepWithNext=True,
        textColor=colors.black),
    'h3': ParagraphStyle('subsection', fontName='HeadBold', fontSize=11.5,
        leading=15, spaceBefore=10, spaceAfter=5, keepWithNext=True,
        textColor=colors.black),
    'part': ParagraphStyle('part', fontName='Head', fontSize=10.8,
        leading=14, spaceAfter=12, keepWithNext=True,
        textColor=colors.black),
    'listing': ParagraphStyle('listing', fontName='Head', fontSize=8.5,
        leading=11, spaceBefore=6, spaceAfter=4, keepWithNext=True,
        textColor=colors.HexColor('#333333')),
    'table': ParagraphStyle('table', fontName='Head', fontSize=9,
        leading=12, spaceAfter=0),
    'index': ParagraphStyle('index', fontName='Book', fontSize=9.6,
        leading=13.2, spaceAfter=5),
    'reference': ParagraphStyle('reference', fontName='Book', fontSize=9.6,
        leading=13.0, spaceAfter=5,allowWidows=0,allowOrphans=0),
}

def normalized(text):
    replacements = {
        '\u2011':'-', '\u2010':'-', '\u2013':'-', '\u2014':' - ',
        '\u2212':'-', '\u00a0':' ', '\u2018':"'", '\u2019':"'",
        '\u201c':'"', '\u201d':'"', '\u2026':'...',
        '\u2192':'->', '\u2190':'<-', '\u2264':'<=', '\u2265':'>=',
    }
    for a,b in replacements.items():
        text = text.replace(a,b)
    return text

def inline(text):
    text = normalized(text)
    saved = []
    def save(value):
        token = f'ZZTOKEN{len(saved)}ZZ'
        saved.append(value)
        return token
    text = re.sub(r'`([^`]+)`', lambda m: save(
        '<font name="Code" size="9.1">' +
        html.escape(m.group(1), quote=False) + '</font>'), text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)',
        lambda m: save('<link href="'+html.escape(m.group(2), quote=True)+
            '"><u>'+html.escape(m.group(1), quote=False)+'</u></link>'), text)
    text = html.escape(text, quote=False)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', text)
    for i,value in enumerate(saved):
        text = text.replace(f'ZZTOKEN{i}ZZ', value)
    return text

class CodeBlock(Flowable):
    def __init__(self, lines, label, continued=False, font_size=None,
                 kind='Rust example'):
        Flowable.__init__(self)
        self.lines = lines
        self.label = label
        self.continued = continued
        self.font_size = font_size
        self.kind = kind
        self.spaceAfter = 9
        self.spaceBefore = 6

    def wrap(self, available_width, available_height):
        self.width = available_width
        widest = max((pdfmetrics.stringWidth(line, 'Code', 8.25)
                      for line in self.lines), default=1)
        if self.font_size is None:
            self.font_size = min(8.25, 8.25*(available_width-5)/max(widest,1))
        if self.font_size < 7.45:
            raise ValueError(f'Code too wide at {self.label}: {widest}')
        self.leading = self.font_size * 1.32
        self.top = 16
        self.height = len(self.lines)*self.leading+self.top+3
        return self.width, self.height

    def split(self, available_width, available_height):
        self.wrap(available_width, available_height)
        fit = math.floor((available_height-self.top-3)/self.leading)
        if fit < 4:
            return []
        if len(self.lines)-fit < 3:
            fit = len(self.lines)-3
        if fit < 4:
            return []
        return [CodeBlock(self.lines[:fit], self.label, self.continued,
                          self.font_size,self.kind),
                CodeBlock(self.lines[fit:], self.label, True,
                          self.font_size,self.kind)]

    def draw(self):
        canvas = self.canv
        y = self.height-self.top-self.leading+1
        canvas.setFont('Head', 8.5)
        canvas.setFillColor(colors.HexColor('#444444'))
        caption = self.label + (' continued' if self.continued
                                else ' ' + self.kind)
        canvas.drawString(4, self.height-9, caption)
        canvas.setFillColor(colors.black)
        canvas.setFont('Code', self.font_size)
        for line in self.lines:
            canvas.drawString(4, y, line)
            y -= self.leading

class BookDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(str(filename), pagesize=(PAGE_W,PAGE_H),
            leftMargin=MARGIN_X, rightMargin=MARGIN_X,
            topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOTTOM,
            title='Understanding Rust',
            author='Advanced Rust Study',
            subject='Ownership Types Concurrency and Systems Design',
            pageCompression=1)
        frame = Frame(MARGIN_X, MARGIN_BOTTOM, WIDTH, HEIGHT,
            leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,
            id='body')
        self.addPageTemplates(PageTemplate(id='book', frames=frame,
                                          onPage=self.decorate))
        self.chapter_pages = {}

    def decorate(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setFillColor(colors.HexColor('#444444'))
        canvas.setFont('Head', 8)
        canvas.drawString(MARGIN_X, PAGE_H-26, 'Understanding Rust')
        canvas.drawCentredString(PAGE_W/2, 25, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        key = getattr(flowable, '_bookmark', None)
        if key:
            title = flowable._toc_title
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0, closed=False)
            self.notify('TOCEntry', (0, title, self.page, key))
            self.chapter_pages[key] = self.page

PARTS = {
    1: ('1','Ownership and Resource Logic'),
    9: ('2','Types and Public Interfaces'),
    19: ('3','Concurrency and Asynchronous Systems'),
    29: ('4','Memory and Systems Engineering'),
    37: ('5','Design Studies'),
}

def parse_manuscript(path, chapter=None):
    lines = normalized(path.read_text(encoding='utf-8')).splitlines()
    flowables=[]
    paragraph=[]
    code=[]
    in_code=False
    language=''
    listing=0
    references_start=None
    in_references=False
    def flush():
        if paragraph:
            value=' '.join(x.strip() for x in paragraph)
            if value.startswith(('- ', '* ')):
                value = '<b>•</b> '+inline(value[2:])
            else:
                value=inline(value)
            style=STYLES['reference'] if in_references else STYLES['body']
            flowables.append(Paragraph(value,style))
            paragraph.clear()
    for line in lines:
        if line.startswith('```'):
            if in_code:
                listing+=1
                prefix=str(chapter) if chapter is not None else path.stem
                label=f'Listing {prefix}.{listing}'
                kind = ('Rejected example' if 'compile_fail' in language
                        else 'Rust example' if language.startswith('rust')
                        else 'Sketch')
                flowables.append(CodeBlock(code, label,kind=kind))
                code=[]
                in_code=False
            else:
                flush()
                language=line[3:].strip()
                in_code=True
            continue
        if in_code:
            code.append(line.rstrip().expandtabs(4))
            continue
        if not line.strip():
            flush()
            continue
        if line.startswith('# '):
            flush()
            title=line[2:].strip()
            if chapter is not None:
                title=re.sub(r'^Chapter\s+\d+\s+', '', title)
                value=f'<font name="Head" size="10">CHAPTER {chapter}</font>'
                value+='<br/>'+inline(title)
                heading=Paragraph(value,STYLES['h1'])
                heading._bookmark=f'ch{chapter:02}'
                heading._toc_title=f'{chapter}  {title}'
            else:
                heading=Paragraph(inline(title),STYLES['h1'])
                heading._bookmark=path.stem
                heading._toc_title=title
            flowables.append(heading)
        elif line.startswith('### '):
            flush()
            flowables.append(Paragraph(inline(line[4:]),STYLES['h3']))
        elif line.startswith('## '):
            flush()
            if line[3:].strip() == 'Further Reading':
                references_start=len(flowables)
                in_references=True
            flowables.append(Paragraph(inline(line[3:]),STYLES['h2']))
        elif re.match(r'^(?:\d+\.|[-*]) ',line):
            flush()
            paragraph.append(line)
            flush()
        elif line.startswith('> '):
            flush()
            paragraph.append(line[2:])
        elif line.startswith('|'):
            flush()
            if not re.match(r'^\|[\s:|\-]+$',line):
                cells = [x.strip() for x in line.strip('|').split('|')]
                flowables.append(Paragraph(inline('  |  '.join(cells)),
                                           STYLES['body']))
        else:
            paragraph.append(line)
    flush()
    if in_code:
        raise ValueError(f'Unclosed code fence: {path}')
    if references_start is not None:
        flowables=(flowables[:references_start]+
                   [KeepTogether(flowables[references_start:])])
    return flowables

def make_index(chapter_pages):
    entries={
        'ABI and foreign boundaries':[29,33],
        'Allocation and retained memory':[8,34,35,37,38,39],
        'Associated types and GATs':[9,13],
        'Async interfaces':[23,27],
        'Atomics and happens before':[22],
        'Backpressure and admission':[21,28,39],
        'Borrow splitting and reborrowing':[3,37],
        'Cancellation and partial progress':[26,28,39,40],
        'Cell RefCell and UnsafeCell':[7],
        'Closures and capture':[12],
        'Coherence and orphan rules':[11,16],
        'Collections and hashing':[34],
        'Const evaluation and const generics':[18],
        'Destruction and panic safety':[2,6,32],
        'Dispatch and type erasure':[10,27],
        'Errors and recovery':[14,38,40],
        'Executors and wakeups':[23,25],
        'FFI ownership and callbacks':[33],
        'Generational handles and arenas':[8],
        'Initialization and validity':[2,30,32],
        'Iterators and lending':[13],
        'Layout alignment and representation':[29],
        'Lifetimes and higher ranked bounds':[4,5,12,13],
        'Lock scope and deadlock':[20,28,39,42],
        'Macros and hygiene':[17],
        'Memory ordering and reclamation':[22,30],
        'Miri fuzzing and property tests':[36,42],
        'Monomorphization and code size':[10,11,35],
        'Moves places and drop flags':[1,2],
        'Pin Unpin and projection':[24],
        'Pointer provenance and aliasing':[30,31],
        'Protocol state machines':[15,28,40],
        'Public APIs and compatibility':[16,41],
        'RAII and resource ownership':[1,6,26],
        'Send Sync and scoped threads':[19,27],
        'Snapshots and optimistic transactions':[38],
        'Soundness and unsafe review':[30,31,32,42],
        'Trait obligations and bounds':[9,11],
        'Typestate and newtypes':[15,40],
        'Variance and PhantomData':[5],
    }
    story=[PageBreak()]
    title=Paragraph('Topic Index',STYLES['h1'])
    title._bookmark='topic_index'
    title._toc_title='Topic Index'
    story.append(title)
    story.append(Paragraph('Page numbers identify chapter openings. '
        'Each entry links to the relevant chapter.',STYLES['body']))
    for term, chapters in sorted(entries.items()):
        links=[]
        for number in chapters:
            key=f'ch{number:02}'
            if key not in chapter_pages:
                continue
            page=chapter_pages.get(key,0)
            links.append(f'<link href="#{key}"><u>{page}</u></link>')
        story.append(Paragraph(inline(term)+'  '+', '.join(links),
                               STYLES['index']))
    return story

def build_story(index_pages=None):
    story=[]
    story.append(Spacer(1,71))
    story.append(Paragraph('Understanding<br/>Rust',ParagraphStyle(
        'title',fontName='HeadBold',fontSize=43,leading=46,
        textColor=colors.black,spaceAfter=24)))
    story.append(Paragraph('Ownership Types Concurrency<br/>and Systems Design',
        ParagraphStyle('subtitle',fontName='Head',fontSize=18,leading=24,
            spaceAfter=25,textColor=colors.black)))
    story.append(Paragraph('An advanced book for experienced developers',
        ParagraphStyle('audience',fontName='Book',fontSize=11,
            leading=16,spaceAfter=95)))
    story.append(Paragraph('42 chapters with worked examples<br/>'
        'exercises and reasoned solutions<br/><br/>'
        'Rust 2024 edition<br/>November 2026',ParagraphStyle(
        'edition',fontName='Head',fontSize=10.5,leading=15)))
    story.append(PageBreak())
    story.extend(parse_manuscript(SOURCE/'front.txt'))
    story.append(PageBreak())
    story.append(Paragraph('Contents',STYLES['h1']))
    toc=TableOfContents()
    toc.levelStyles=[ParagraphStyle('toc0',fontName='Head',fontSize=10,
        leading=13.5,spaceBefore=4,leftIndent=0,firstLineIndent=0,
        rightIndent=23,textColor=colors.black)]
    toc.dotsMinLevel=0
    story.append(toc)
    for chapter in range(1,43):
        path=SOURCE/f'ch{chapter:02}.txt'
        if not path.exists():
            continue
        story.append(PageBreak())
        if chapter in PARTS:
            number,name=PARTS[chapter]
            story.append(Paragraph(f'PART {number}  {name}',STYLES['part']))
        story.extend(parse_manuscript(path,chapter))
    for name in ('appendix_a','appendix_b'):
        path=SOURCE/f'{name}.txt'
        if path.exists():
            story.append(PageBreak())
            story.extend(parse_manuscript(path))
    if index_pages:
        story.extend(make_index(index_pages))
    return story

def main():
    doc=BookDoc(OUTPUT)
    doc.multiBuild(build_story(),maxPasses=5)
    chapter_pages=dict(doc.chapter_pages)
    doc=BookDoc(OUTPUT)
    doc.multiBuild(build_story(chapter_pages),maxPasses=5)
    reader=PdfReader(OUTPUT)
    files=list(SOURCE.glob('*.txt'))
    metrics={
        'pages':len(reader.pages),
        'chapters':len(list(SOURCE.glob('ch*.txt'))),
        'manuscript_words':sum(len(p.read_text(encoding='utf-8').split())
                               for p in files),
        'chapter_pages':doc.chapter_pages,
        'page_size_inches':[6,9],
        'body_point_size':10.5,
        'body_leading':14.8,
    }
    (QA/'book_metrics.json').write_text(json.dumps(metrics,indent=2),
                                      encoding='utf-8')
    print(json.dumps(metrics,indent=2))

if __name__=='__main__':
    main()
