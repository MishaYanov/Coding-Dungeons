from pathlib import Path
import json
import re
from zipfile import ZipFile
from collections import Counter
from pypdf import PdfReader,PdfWriter

ROOT=Path(__file__).resolve().parents[2]
QA=ROOT/'work/qa/campaign'
PDF=ROOT/'outputs/Understanding_Rust_Campaign.pdf'
metrics=json.loads((QA/'metrics.json').read_text(encoding='utf-8'))
reader=PdfReader(PDF)
kit=ROOT/'outputs/Ferrum-Field-Kit.zip'
assert reader.attachments.get(kit.name)==[kit.read_bytes()]
with ZipFile(kit) as archive:
    assert archive.testzip() is None
    assert 'campaign/Quest_Journal.txt' in archive.namelist()
fields=reader.get_fields() or {}
expected={'callsign','active_path','xp_total'}
expected.update(f'level{n:02}_{phase}' for n in range(1,43)
                for phase in ['scout','forge','explain','side'])
assert set(fields)==expected,(set(fields)^expected)
assert len(reader.pages)>=300
locations=metrics['locations']
for n in range(1,43):
    for prefix in ['level','ch','boss']:
        assert f'{prefix}{n:02}' in locations
    pages=[locations[f'hint{n:02}_{s}'] for s in ['n','t','d']]
    assert pages[0]<pages[1]<pages[2],(n,pages)

page_ids={page.indirect_reference.idnum:i+1
          for i,page in enumerate(reader.pages)}
links=0
widgets=[]
for number,page in enumerate(reader.pages,1):
    for ref in page.get('/Annots',[]):
        annotation=ref.get_object()
        if annotation.get('/Subtype')=='/Link':
            destination=annotation.get('/Dest')
            if destination is not None:
                destination=destination.get_object()
                assert destination[0].idnum in page_ids,(number,destination)
                links+=1
        elif annotation.get('/Subtype')=='/Widget':
            widgets.append(annotation)
            name=str(annotation.get('/T'))
            assert name in expected,name
            assert '/AP' in annotation and '/N' in annotation['/AP'],name
            if annotation.get('/FT')=='/Btn':
                assert str(annotation['/V'])=='/Off',name
                assert str(annotation['/AS'])=='/Off',name
                assert '/Yes' in annotation['/AP']['/N'],name
            x0,y0,x1,y1=annotation['/Rect']
            assert 42<=x0<x1<=390 and 42<=y0<y1<=607,(name,annotation['/Rect'])
assert len(widgets)==len(expected)
assert len({str(w['/T']) for w in widgets})==len(expected)

writer=PdfWriter()
writer.clone_document_from_reader(reader)
values={'callsign':'Ferrum Explorer','active_path':'The Warden',
        'xp_total':'165','level01_scout':'/Yes','level01_forge':'/Yes',
        'level01_explain':'/Yes','level01_side':'/Yes',
        'level42_explain':'/Yes'}
writer.update_page_form_field_values(None,values,auto_regenerate=False)
test_path=QA/'progress_roundtrip.pdf'
with test_path.open('wb') as stream:
    writer.write(stream)
test=PdfReader(test_path)
test_fields=test.get_fields()
assert set(test_fields)==expected
for name,value in values.items():
    assert str(test_fields[name]['/V'])==value,(name,test_fields[name])
for page in test.pages:
    for ref in page.get('/Annots',[]):
        widget=ref.get_object()
        if widget.get('/Subtype')=='/Widget':
            name=str(widget.get('/T'))
            if name in values:
                assert str(widget['/V'])==values[name],name
                assert '/AP' in widget and '/N' in widget['/AP'],name
                if widget.get('/FT')=='/Btn':
                    assert str(widget['/AS'])==values[name],name

text_pages=[]
for number,page in enumerate(reader.pages,1):
    text=page.extract_text() or ''
    if any(bad in text for bad in ['\ufffd','ZZTOKEN','\u00e2\u20ac','TODO','TBD']):
        raise AssertionError(('badtext',number))
    text_pages.append(text)
text='\n'.join(text_pages)
assert 'Three Marks of Mastery' in text
assert 'The Ghost Payment' in text
assert 'The Debrief Archive' in text
listing_ids=set(re.findall(r'Listing (\d+\.\d+) (?:Rust example|Rejected example|Sketch)',text))
assert len(listing_ids)==162,len(listing_ids)
result={'pages':len(reader.pages),'levels':42,'paths':4,
        'internal_links':links,'fillable_fields':len(fields),
        'widgets':len(widgets),'progress_roundtrip':'passed',
        'all_listing_ids_preserved':len(listing_ids),
        'hint_stages_separate_for_all_levels':True,
        'save_pages':[locations['save'],locations['save2']],
        'locations':locations}
(QA/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='locations'},indent=2))
