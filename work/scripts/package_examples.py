from pathlib import Path
import json
import re
import zipfile

ROOT=Path(__file__).resolve().parents[2]
report=json.loads((ROOT/'work/qa/example_checks.json').read_text(encoding='utf-8'))
runs=json.loads((ROOT/'work/qa/case_study_execution.json').read_text(encoding='utf-8'))
archive=ROOT/'outputs/Understanding_Rust_Examples.zip'
readme=f'''Understanding Rust example companion

This archive accompanies the 42 chapter book Understanding Rust.
Files retain the chapter and listing numbers printed in the book.

Compiler validation
  {report['compiler']}
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
Foreign integration and runtime excerpts may need the context described in
the book before they can be linked or used in a complete application.
'''
validation={
    'compiler':report['compiler'],'edition':'2024',
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
    for path in sorted((ROOT/'work/manuscript').glob('ch*.txt')):
        text=path.read_text(encoding='utf-8')
        chapter=int(path.stem[2:])
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
