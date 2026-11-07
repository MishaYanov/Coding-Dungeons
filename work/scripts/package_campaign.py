from pathlib import Path
import json
import zipfile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'work/gamebook'
campaign=json.loads((DATA/'campaign.json').read_text(encoding='utf-8'))
output=ROOT/'outputs/Ferrum-Field-Kit.zip'
readme='''THE FERRUM EXPEDITION
Understanding Rust Campaign Edition

Open the campaign PDF and begin at the World Map on page 6.
Choose Architect, Warden, Delver, or Pathfinder, or explore all 42 levels.

The PDF contains clickable routes and a fillable quest log.
It does not run your Rust code or automatically award XP.
Save a personal copy to retain form edits in a compatible PDF reader.
Use campaign/Quest_Journal.txt if you prefer an ordinary editable text file.

CORE MASTERY
Scout 20 XP: predict and inspect a worked example.
Forge 40 XP: produce the boss artifact and satisfy the win conditions.
Explain 40 XP: record the owner, invariant, failure path, and tradeoff.
Side 25 XP: complete the optional harder variation.

CONTENTS
campaign/Routes.json          The four suggested paths
campaign/Encounters.json      Missions without hints/debriefs
campaign/Quest_Journal.txt    Editable evidence and progress log
campaign/Vault.json           Hints and debriefs; open when wanted
campaign/Branching_Rooms.json  Three optional decision encounters
listings/                    Original book examples and validation record

LEVEL AND LISTING NUMBERS
The original Chapter N is now Level N. Listing 24.3 remains Listing 24.3.
Source filenames retain chNN_listingXX so existing references stay useful.
These listings match the accompanying edition of the book.
See listings/README.txt and listings/validation.json for compiler and test results.

Check an accepted unit from the extracted archive:
rustc --edition=2024 --crate-type=lib --emit=metadata listings/examples/ch09_listing01.rs

Run a complete unit that defines main:
rustc --edition=2024 listings/examples/ch38_listing01.rs -o example.exe
./example.exe

Rejected units are intentionally noncompiling. Sketches need their stated context.
The Vault is separate so opening the journal does not reveal boss answers.
'''
journal=['FERRUM EXPEDITION QUEST JOURNAL','',
         'Callsign:','Active path:','Core XP:','Side XP:','',
         'Mark only when evidence is recorded. Maximum core 4200, side 1050.','']
encounters=[]
vault=[]
for q in sorted(campaign['quests'],key=lambda q:q['level']):
    n=q['level']
    encounters.append({k:v for k,v in q.items()
                       if k not in ['hint1','hint2','debrief']})
    vault.append({k:q[k] for k in ['level','boss_title','hint1','hint2','debrief']})
    journal.extend([f'LEVEL {n:02} {q["mission_title"]}',
                    f'Boss: {q["boss_title"]}',
                    '[ ] Scout 20   [ ] Forge 40   [ ] Explain 40   [ ] Side 25',
                    'Mission: '+q['objective'],'Win conditions:'])
    journal.extend('  - '+condition for condition in q['win_conditions'])
    journal.extend(['Prediction before compiling:',
                    'Artifact or source path:',
                    'Owner and invariant:',
                    'Failure or cancellation case:',
                    'Tradeoff and counterexample:',
                    'Side quest evidence:',
                    'Next route:',''])
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('README.txt',readme)
    z.writestr('campaign/Routes.json',json.dumps(campaign['paths'],indent=2))
    z.writestr('campaign/Encounters.json',json.dumps(encounters,ensure_ascii=False,indent=2))
    z.writestr('campaign/Vault.json',json.dumps(vault,ensure_ascii=False,indent=2))
    z.writestr('campaign/Branching_Rooms.json',json.dumps(campaign['rooms'],ensure_ascii=False,indent=2))
    z.writestr('campaign/Quest_Journal.txt','\n'.join(journal)+'\n')
    with zipfile.ZipFile(ROOT/'outputs/Understanding_Rust_Examples.zip') as source:
        for name in source.namelist():
            z.writestr('listings/'+name,source.read(name))
print(output.name,output.stat().st_size,'bytes')

pdf=ROOT/'outputs/Understanding_Rust_Campaign.pdf'
source=PdfReader(pdf)
writer=PdfWriter(clone_from=source)
for attachment in list(writer.attachment_list):
    if attachment.name == output.name:
        attachment.delete()
attachment=writer.add_attachment(output.name,output.read_bytes())
attachment.subtype=NameObject('/application/zip')
updated=pdf.with_suffix('.with-kit.pdf')
writer.write(updated)
reopened=PdfReader(updated)
assert len(reopened.pages)==len(source.pages)>0
assert set(reopened.get_fields() or {})==set(source.get_fields() or {})
updated.replace(pdf)
