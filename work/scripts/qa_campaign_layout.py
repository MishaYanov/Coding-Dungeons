from pathlib import Path
import json
import shutil
import subprocess
import sys
from PIL import Image,ImageDraw,ImageFont
import pdfplumber

ROOT=Path(__file__).resolve().parents[2]
BASE_QA=ROOT/'work/qa/campaign'
QA=BASE_QA/sys.argv[1] if len(sys.argv)>1 else BASE_QA
QA.mkdir(exist_ok=True,parents=True)
PDF=ROOT/'outputs/Understanding_Rust_Campaign.pdf'
PAGES=QA/'pages'
SHEETS=QA/'sheets'
PAGES.mkdir(exist_ok=True,parents=True)
SHEETS.mkdir(exist_ok=True,parents=True)
issues=[]
stats=[]
with pdfplumber.open(PDF) as pdf:
    for number,page in enumerate(pdf.pages,1):
        body=[c for c in page.chars if 42<=c['top']<=606]
        if not body:
            issues.append({'page':number,'issue':'empty body'})
        outside=[c for c in page.chars if
            c['x0'] < (40 if number==1 else 42)
            or c['x1']>390 or c['top']<15 or c['bottom']>630]
        if outside:
            issues.append({'page':number,'issue':'text outside bounds',
                           'text':''.join(c['text'] for c in outside)[:100]})
        stats.append({'page':number,'characters':len(body),
                      'body_bottom':round(max((c['bottom'] for c in body),
                                             default=0),2)})
(QA/'layout_audit.json').write_text(json.dumps({'issues':issues,'pages':stats},
                                             indent=2),encoding='utf-8')
print('Layout audit:',len(stats),'pages;',len(issues),'flags',flush=True)
for issue in issues:
    print(issue,flush=True)
subprocess.run([shutil.which('pdftoppm'),'-r','100','-png',str(PDF),
                str(PAGES/'page')],check=True)
files=sorted(PAGES.glob('page-*.png'))
font=ImageFont.truetype('C:/Windows/Fonts/calibri.ttf',20)
for start in range(0,len(files),4):
    sheet=Image.new('RGB',(900,1376),'#dddddd')
    draw=ImageDraw.Draw(sheet)
    for index,path in enumerate(files[start:start+4]):
        im=Image.open(path).convert('RGB')
        im.thumbnail((432,648),Image.Resampling.LANCZOS)
        x=12+(index%2)*450
        y=29+(index//2)*688
        sheet.paste(im,(x,y))
        draw.text((x,y-25),f'Page {start+index+1}',font=font,fill='black')
    sheet.save(SHEETS/f'sheet-{start//4+1:03}.jpg',quality=91)
print('Rendered',len(files),'pages;',len(list(SHEETS.glob('*.jpg'))),
      'contact sheets',flush=True)
verification=json.loads((BASE_QA/'verification.json').read_text(encoding='utf-8'))
for page in verification['save_pages']:
    subprocess.run([shutil.which('pdftoppm'),'-f',str(page),'-l',str(page),
                    '-r','120','-png',str(BASE_QA/'progress_roundtrip.pdf'),
                    str(QA/'filled')],check=True)
print('Filled form render complete',flush=True)
