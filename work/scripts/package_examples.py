from pathlib import Path
import json
import re
import zipfile
from hashlib import sha256
from book_sources import checked_sources

ROOT=Path(__file__).resolve().parents[2]
report=json.loads((ROOT/'work/qa/example_checks.json').read_text(encoding='utf-8'))
runs=json.loads((ROOT/'work/qa/case_study_execution.json').read_text(encoding='utf-8'))
archive=ROOT/'outputs/Understanding_Rust_Examples.zip'
matrix=json.loads((ROOT/'work/qa/book_toolchains.json').read_text(encoding='utf-8'))
assert matrix['sources']=={path.name:sha256(path.read_bytes()).hexdigest()
                          for path in checked_sources(ROOT/'work/manuscript')}, 'Rerun the toolchain checks after editing examples.'
validated='; '.join(row['compiler'] for row in matrix['toolchains'])
readme=f'''Understanding Rust example companion

This archive accompanies the 42 chapter book Understanding Rust.
Files retain the chapter and listing numbers printed in the book.

Compiler validation
  {validated}
  Edition 2024
  {report['accepted']} accepted Rust source units type-checked successfully
  {report['rejected']} intentionally rejected source units failed as expected
  {report['unexpected']} unexpected compiler outcomes
  {sum(r.get('passed', False) for r in runs)} executable examples and regression suites ran successfully

The validation compiled source units as libraries with --emit=metadata.
This checks types without requiring a main function or a foreign linker.
It is not a runtime test of every listing or a proof of soundness.
The executed examples and regression suites are identified in validation.json.

Check an accepted source unit from the extracted archive

  rustc --edition=2024 --crate-type=lib --emit=metadata examples/ch09_listing01.rs

Run a complete source unit that defines main

  rustc --edition=2024 examples/ch38_listing01.rs -o example.exe
  ./example.exe

Rejected examples are stored under rejected/ and intentionally do not compile.
Read the surrounding chapter for the reason and the intended correction.

The sketches/ directory contains nonstandalone excerpts, manifests, commands,
and diagrams. These were not classified as compilable Rust source units.
The surrounding book explains the required context and assumptions.

index.tsv maps every listing to its chapter, classification, and archive path.
validation.json records the check outcomes without local workspace paths.

This companion uses no Cargo dependencies for its standalone checked units.
The lab_async, lab_dispatch and lab_schedules programs are complete host labs.
Use index.tsv to find their examples/ filenames. Compile one file at a time.
The async lab uses host threads and a controlled logical clock; it does not
claim to be a production I/O runtime. The schedule lab explores a stated model,
not every hardware memory ordering or possible Rust execution.
Foreign integration and runtime excerpts may need the context described in
the book before they can be linked or used in a complete application.
'''
validation={
    'compiler':report['compiler'],'edition':'2024',
    'toolchains':matrix['toolchains'],
    'accepted':report['accepted'],'expected_rejections':report['rejected'],
    'unexpected_outcomes':report['unexpected'],
    'checks':[{'name':r['name'],'expected_rejection':r['expected_fail'],
               'passed':r['ok']} for r in report['results']],
    'executed':[{'name':r['example'],'passed':r.get('passed',False)} for r in runs],
}
index=['chapter\tlisting\tkind\tpath\tchapter_title']
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('README.txt',readme)
    z.writestr('validation.json',json.dumps(validation,indent=2))
    for path in checked_sources(ROOT/'work/manuscript'):
        text=path.read_text(encoding='utf-8')
        chapter=int(path.stem[2:]) if path.stem.startswith('ch') else path.stem
        title=text.splitlines()[0].lstrip('# ').strip()
        for number,match in enumerate(re.finditer(
            r'^```([^\n]*)\n(.*?)\n```\s*$',text,re.M|re.S),1):
            language=match.group(1).strip()
            source=match.group(2)+'\n'
            if language.startswith('rust'):
                rejected='compile_fail' in language
                kind='rejected' if rejected else 'accepted'
                folder='rejected' if rejected else 'examples'
                name=f'{folder}/{path.stem}_listing{number:02}.rs'
            else:
                kind='sketch'
                name=f'sketches/{path.stem}_listing{number:02}.txt'
            z.writestr(name,source)
            index.append(f'{chapter}\t{number}\t{kind}\t{name}\t{title}')
    z.writestr('index.tsv','\n'.join(index)+'\n')
print(f'Packaged {len(index)-1} listings: {archive.name} ({archive.stat().st_size} bytes)')
