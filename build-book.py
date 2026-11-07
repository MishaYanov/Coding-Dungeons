"""Prepare the browser reader from the reviewed Ferrum PDF and manuscript."""
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import re
import shutil

from PIL import Image
from pypdf import PdfReader

APP = Path(__file__).resolve().parent
ROOT = APP if (APP / 'work/scripts/build_campaign.py').is_file() else APP.parents[1]
WORK = ROOT / 'work'
PDF = ROOT / 'outputs/Understanding_Rust_Campaign.pdf'
QA = WORK / 'qa/campaign'
DATA = APP / 'data'
BOOK = APP / 'public/book'
DATA.mkdir(parents=True, exist_ok=True)
(BOOK / 'pages').mkdir(parents=True, exist_ok=True)

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')),
                    encoding='utf-8')

def clean(text):
    return re.sub(r'\s+', ' ', text.replace('`', '').replace('\ufffd', '')).strip()

def normalized(text):
    return ' '.join(re.findall(r'[a-z0-9]+', text.lower()))

def training(text):
    section = re.search(r'^## Exercises(?: and Reasoned Solutions)?\s*\n(.*?)(?=^## Further Reading)', text, re.M | re.S)
    if not section:
        return []
    contents = section[1]
    if '## Reasoned Solutions' in contents:
        questions, answers = contents.split('## Reasoned Solutions', 1)
        questions = re.findall(r'^\d+\.\s+(.*?)(?=^\d+\.\s+|\Z)', questions, re.M | re.S)
        answers = re.findall(r'^\d+\.\s+(.*?)(?=^\d+\.\s+|\Z)', answers, re.M | re.S)
        return [(clean(q), clean(a)) for q, a in zip(questions, answers)]
    return [(clean(q), clean(a)) for q, a in re.findall(
        r'^Exercise \d+\.\s+(.*?)^Solution\.\s+(.*?)(?=^Exercise \d+\.|\Z)',
        contents, re.M | re.S)]

def coded(text):
    return bool(re.search(r'\b(?:write|implement|modify|rewrite|extend|adapt|add|sketch|build)\b|\bsignatures?\b', text, re.I))

def first_paragraph(lines, headings):
    skip = set(headings) | {'Training Encounters', 'Training Debriefs', 'Further Reading'}
    paragraph = []
    for line in lines:
        if line.startswith('Listing '):
            break
        if line in skip or line.startswith('FIELD MANUAL '):
            if paragraph:
                break
            continue
        if len(line) < 28 and not paragraph:
            continue
        paragraph.append(line)
        if len(' '.join(paragraph)) > 200:
            break
    summary = clean(' '.join(paragraph))
    end = max(summary.rfind('. '), summary.rfind('? '))
    if len(summary) > 215:
        summary = summary[:end + 1] if end > 100 else summary[:212].rsplit(' ', 1)[0] + '…'
    return summary

def convert(page):
    source = QA / 'final/pages' / f'page-{page:03}.png'
    target = BOOK / 'pages' / f'{page}.webp'
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        with Image.open(source) as img:
            img.convert('RGB').save(target, 'WEBP', quality=91, method=3)

def main():
    campaign = read_json(WORK / 'gamebook/campaign.json')
    loc = read_json(QA / 'metrics.json')['locations']
    checks = read_json(DATA / 'checkpoints.json')
    assert len(checks) == 42
    reader = PdfReader(PDF)
    revision = sha256(PDF.read_bytes()).hexdigest()[:16]
    total = len(reader.pages)
    assert total == 559
    page_ids = {p.indirect_reference.idnum: i for i, p in enumerate(reader.pages, 1)}
    starts = [loc[f'level{n:02}'] for n in range(1, 43)]
    quests = sorted(campaign['quests'], key=lambda q: q['level'])
    exercise_file = DATA / 'exercises.json'
    exercises = read_json(exercise_file) if exercise_file.exists() else []
    by_level = {e['level']: e for e in exercises}
    manuscript = {n: (WORK / 'manuscript' / f'ch{n:02}.txt').read_text(encoding='utf-8-sig')
                  for n in range(1, 43)}
    heads = {n: [clean(h) for h in re.findall(r'^#{1,3}\s+(.+)', s, re.M)]
             for n, s in manuscript.items()}
    listings = {n: re.findall(r'^```([^\n]*)\n(.*?)\n```\s*$', s, re.M | re.S)
                for n, s in manuscript.items()}
    pages = []
    bodies = []
    for number, pdf_page in enumerate(reader.pages, 1):
        body = [l.strip() for l in (pdf_page.extract_text() or '').splitlines() if l.strip()]
        if number > 1 and body[:4] == ['UNDERSTANDING RUST / FERRUM', 'Map', 'Save', 'Vault']:
            body = body[5:]
        bodies.append(body)
        level = bisect_right(starts, number) if number < loc['vault'] else 0
        q = quests[level-1] if level else None
        notes = []
        title = q['mission_title'] if q else 'Ferrum expedition'
        hint_kinds = []
        if q:
            if number == loc[f'level{level:02}']:
                notes.append(f"Your mission. {q['objective']}")
                notes.append('Choose a mastery target to focus on, then use the checkpoint to test your model of the system.')
            elif number == loc[f'boss{level:02}']:
                title = q['boss_title']
                notes.append('State the invariant and how you would falsify it before implementing a repair. The hints reveal progressively more of the argument.')
                hint_kinds = ['hint1', 'hint2', 'debrief']
            elif number == loc[f'side{level:02}']:
                notes.append(f"Optional twist. {q['reward']}")
            else:
                section = next((h for h in heads[level][1:] if h in body), '')
                excerpt = first_paragraph(body, heads[level])
                if section:
                    title = section
                if excerpt and not re.match(r'^(?:fn |pub |let |struct |use |impl|[{}])', excerpt):
                    notes.append(excerpt)
                notes.append(f"Mission lens. {q['objective']}")
        elif number in (6, 7, 8):
            title = 'Choose your route'
            notes = ['Follow a colored node on the book page or open the route menu. Pick the district that matches the skill you want to practice.']
        elif number >= loc['vault']:
            title = 'Reference and debriefs'
            notes = ['Follow a return link to revisit the encounter and refine your answer. Your saved work stays attached to its original page.']
        else:
            notes = ['Open the World Map or follow the book in order. The GM brings up tasks as you reach questions, code listings, and encounters.']
        width, height = float(pdf_page.mediabox.width), float(pdf_page.mediabox.height)
        links = []
        for ref in pdf_page.get('/Annots', []):
            annot = ref.get_object()
            if annot.get('/Subtype') != '/Link':
                continue
            x0, y0, x1, y1 = [float(v) for v in annot['/Rect']]
            if x1 <= x0 or y1 <= y0:
                continue
            rectangle = {'x': round(100*x0/width, 3), 'y': round(100*(height-y1)/height, 3),
                         'w': round(100*(x1-x0)/width, 3), 'h': round(100*(y1-y0)/height, 3)}
            dest = annot.get('/Dest')
            if dest:
                target = page_ids.get(dest.get_object()[0].idnum)
                if target:
                    links.append({**rectangle, 'page': target, 'label': f'Open book page {target}'})
            else:
                url = str(annot.get('/A', {}).get('/URI', ''))
                if url.startswith('https://'):
                    links.append({**rectangle, 'url': url, 'label': 'Open source reference'})
        pages.append({'page':number, 'total':total, 'level':level, 'title':title,
                      'image':f'/book/pages/{number}.webp?v={revision}', 'links':links, 'prompts':[],
                      'notes':notes, 'hintKinds':hint_kinds})

    def add(page, prompt):
        pages[page-1]['prompts'].append(prompt)

    def attach(prompt, exercise):
        prompt['exerciseId'] = exercise['id']

    for level, q in enumerate(quests, 1):
        start = loc[f'level{level:02}']
        manual = loc[f'ch{level:02}']
        boss = loc[f'boss{level:02}']
        side = loc[f'side{level:02}']
        question, options, correct, feedback = checks[level-1]
        add(manual, {'id':f'checkpoint-{level}', 'type':'choice', 'title':'GM checkpoint',
                     'body':question, 'options':[{'id':str(i+1),'text':t} for i,t in enumerate(options)],
                     'correctOption':str(correct+1), 'feedback':feedback})
        challenge = {'id':f'boss-{level}', 'type':'code' if coded(q['boss_brief']) else 'text',
                     'title':q['boss_title'], 'body':q['boss_brief'], 'criteria':q['constraints'],
                     'feedback':'Your draft is saved. Compare it with the encounter constraints, then reveal a hint or the debrief when you are ready.'}
        exercise = by_level.get(level)
        matched_exercise = False
        for index, (prompt, answer) in enumerate(training(manuscript[level]), 1):
            prefix = ' '.join(normalized(prompt).split()[:8])
            candidate = next((i for i in range(manual, boss+1)
                              if prefix and prefix in normalized(' '.join(bodies[i-1]))), None)
            if candidate is None:
                raise ValueError(f'Cannot locate book question {level}.{index}: {prompt[:90]}')
            card = {'id':f'training-{level}-{index}', 'type':'code' if coded(prompt) else 'text',
                    'title':f'Training encounter {index}', 'body':prompt, 'feedback':answer}
            match = exercise and exercise.get('promptMatch', '')
            if match and match.lower() in prompt.lower():
                card['type'] = 'code'
                attach(card, exercise)
                matched_exercise = True
            add(candidate, card)
        if exercise and not matched_exercise:
            challenge['type'] = 'code'
            attach(challenge, exercise)
        add(boss, challenge)
        add(side, {'id':f'side-{level}', 'type':'code' if coded(q['side_quest']) else 'text',
                   'title':'Side quest', 'body':q['side_quest'],
                   'feedback':'Your side quest evidence is saved. Mark the side quest in your log once you can explain the added constraint and its effect.'})
        for number in range(manual,boss+1):
            for line in bodies[number-1]:
                match = re.match(r'Listing (\d+)\.(\d+) (Rust example|Rejected example|Sketch)$', line)
                if not match:
                    continue
                listing_level, index = (int(match[1]),int(match[2]))
                if listing_level != level or index > len(listings[level]):
                    raise ValueError(f'Listing mismatch on page {number}: {line}')
                kind, source = listings[level][index-1]
                if not kind.startswith('rust'):
                    continue
                rejected = 'compile_fail' in kind
                add(number, {'id':f'listing-{level}-{index}','type':'code',
                             'title':f'Listing {level}.{index} scratchpad', 'starter':source,
                             'body':('Predict why this listing is rejected. Edit a copy to test your proposed repair.'
                                     if rejected else 'Try a variation of the book example. Record the behavior you expect before you change its code.'),
                             'feedback':'Your code draft is saved on this page.'})
        q['page'] = start
        q['manualPage'] = manual
        q['bossPage'] = boss
        q['sidePage'] = side

    for room in campaign['rooms']:
        page = loc[f'room_{room["id"]}']
        choices = room['choices']
        add(page, {'id':f'room-{room["id"]}', 'type':'choice', 'title':room['title'],
                   'body':room['brief'], 'options':[{'id':str(i+1),'text':c['label']} for i,c in enumerate(choices)],
                   'correctOption':'3', 'feedbackByOption':{str(i+1):c['result'] for i,c in enumerate(choices)}})
        add(page, {'id':f'remix-{room["id"]}', 'type':'text', 'title':'Remix the scenario',
                   'body':room['remix'], 'feedback':'Your alternate design is saved. Identify which changed assumption justified your choice.'})
        room['page'] = page

    # A notebook remains available on ordinary prose pages without manufacturing quiz questions.
    for page in pages:
        if not page['prompts']:
            page['prompts'].append({'id':'notes', 'type':'text', 'title':'Field notes',
                                    'body':'Record an invariant, a question, or a prediction to revisit.',
                                    'feedback':'Your field note is saved on this page.'})
    write_json(DATA / 'pages.json', pages)
    write_json(DATA / 'campaign.json', campaign)
    shutil.copyfile(PDF, BOOK / 'ferrum-expedition.pdf')
    shutil.copyfile(PDF.with_name('Ferrum-Field-Kit.zip'), BOOK / 'ferrum-field-kit.zip')
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(convert, range(1,total+1)))
    print(f'Prepared {total} pages and {sum(len(p["prompts"]) for p in pages)} GM cards, '
          f'{sum(len(p["links"]) for p in pages)} book links, {len(exercises)} test exercises.')

if __name__ == '__main__':
    main()
