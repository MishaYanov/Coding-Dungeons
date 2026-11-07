import concurrent.futures
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
MANUSCRIPT = ROOT / 'work/manuscript'
CHECKS = ROOT / 'work/checks'
QA = ROOT / 'work/qa'
SNIPPETS = CHECKS / 'examples'
META = CHECKS / 'metadata'
SNIPPETS.mkdir(parents=True, exist_ok=True)
META.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
RUSTC = os.environ.get('FERRUM_TEST_RUSTC') or shutil.which('rustc')
if not RUSTC:
    raise SystemExit('rustc is required')
EXPECTED_DIAGNOSTICS = {
    'ch02_listing05': 'error[E0509]',
    'ch03_listing06': 'error[E0502]',
    'ch05_listing03': 'error: lifetime may not live long enough',
    'ch11_listing02': 'error[E0119]',
    'ch11_listing04': 'error[E0117]',
    'ch13_listing03': 'error[E0499]',
    'ch18_listing04': 'error: generic parameters may not be used in const operations',
    'ch19_listing02': 'error[E0597]',
    'ch24_listing03': 'error[E0277]',
    'ch27_listing02': 'error[E0038]',
    'ch36_listing03': 'error[E0599]',
    'ch37_listing02': 'error[E0502]',
}
version = subprocess.run([RUSTC, '--version'], capture_output=True,
                         text=True, check=True).stdout.strip()
rows = []
for path in sorted(MANUSCRIPT.glob('ch*.txt')):
    text = path.read_text(encoding='utf-8')
    for number, match in enumerate(re.finditer(
            r'^```([^\n]*)\n(.*?)\n```\s*$', text, re.M | re.S), 1):
        info, source = match.group(1).strip(), match.group(2)
        if not info.startswith('rust'):
            continue
        expected_fail = 'compile_fail' in info
        name = f'{path.stem}_listing{number:02}'
        source_path = SNIPPETS / f'{name}.rs'
        source_path.write_text(source + '\n', encoding='utf-8')
        rows.append(dict(chapter=path.stem, listing=number,
                         name=name, file=str(source_path),
                         expected_fail=expected_fail))

def check(row):
    command = [RUSTC, row['file'], '--edition=2024', '--crate-type=lib',
               '--crate-name', row['name'], '--emit=metadata',
               '--out-dir', str(META), '-A', 'warnings']
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=45, encoding='utf-8', errors='replace')
        row['returncode'] = result.returncode
        if row['expected_fail']:
            row['ok'] = (result.returncode == 1
                         and EXPECTED_DIAGNOSTICS[row['name']] in result.stderr)
        else:
            row['ok'] = result.returncode == 0
        row['diagnostic'] = result.stderr
    except subprocess.TimeoutExpired:
        row.update(returncode=None, ok=False, diagnostic='compiler timed out')
    return row

assert {row['chapter'] for row in rows} == {f'ch{n:02}' for n in range(1, 43)}
assert {row['name'] for row in rows if row['expected_fail']} == set(EXPECTED_DIAGNOSTICS)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(check, rows))
report = dict(compiler=version, edition='2024', checked=len(results),
              accepted=sum(not r['expected_fail'] for r in results),
              rejected=sum(r['expected_fail'] for r in results),
              unexpected=sum(not r['ok'] for r in results), results=results)
(QA / 'example_checks.json').write_text(
    json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k != 'results'}, indent=2))
for row in results:
    if not row['ok']:
        print('\nUNEXPECTED', row['name'], 'expected_fail=',row['expected_fail'])
        print(row['diagnostic'][:7000])
if report['unexpected']:
    raise SystemExit(1)
