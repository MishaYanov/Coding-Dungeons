"""Execute complete, trusted Rust examples extracted by check_examples.py."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / 'work/qa'
BIN = ROOT / 'work/checks/bin'
RUSTC = os.environ.get('FERRUM_TEST_RUSTC') or shutil.which('rustc')
if not RUSTC:
    raise SystemExit('rustc is required')


def execute(case):
    name, source, is_test = case
    cwd = BIN / name
    cwd.mkdir(exist_ok=True, parents=True)
    source_path = cwd / f'{name}.rs'
    source_path.write_text(source, encoding='utf-8')
    exe = cwd / (name + ('.exe' if os.name == 'nt' else ''))
    command = [RUSTC, str(source_path), '--edition=2024', '-A', 'warnings', '-o', str(exe)]
    if is_test:
        command.append('--test')
    result = {'example': name, 'passed': False}
    try:
        compilation = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                                     encoding='utf-8', errors='replace', timeout=60)
        result['compiled'] = compilation.returncode == 0
        if compilation.returncode != 0:
            result['stderr'] = compilation.stderr
            return result
        run = subprocess.run([str(exe)], cwd=cwd, capture_output=True, text=True,
                             encoding='utf-8', errors='replace', timeout=15)
        result.update(passed=run.returncode == 0, stdout=run.stdout, stderr=run.stderr)
    except subprocess.TimeoutExpired:
        result['stderr'] = 'Example compilation or execution timed out.'
    return result


report = json.loads((QA / 'example_checks.json').read_text(encoding='utf-8'))
cases = []
for row in report['results']:
    if row['expected_fail']:
        continue
    source = Path(row['file']).read_text(encoding='utf-8')
    if re.search(r'^fn main\s*\(', source, re.M):
        cases.append((row['name'], source, False))

fixtures = ROOT / 'test/fixtures'
if not fixtures.is_dir():
    fixtures = ROOT / 'work/ferrum-web/test/fixtures'
promise = next(row for row in report['results'] if row['name'] == 'ch25_listing02')
promise_source = Path(promise['file']).read_text(encoding='utf-8')
standalone_count = len(cases)
waker_tests = (fixtures / 'promise-regression.rs').read_text(encoding='utf-8')
release_contracts = (fixtures / 'rust-199-release-contracts.rs').read_text(encoding='utf-8')
cases.extend([
    ('ch25_waker_regression', promise_source + '\n' + waker_tests, True),
    ('rust_199_release_contracts', release_contracts, False),
])

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(execute, cases))
failures = [result for result in results if not result['passed']]
(QA / 'case_study_execution.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(f'Ran {standalone_count} complete Rust examples, the Chapter 25 regression suite, and the Rust 1.99 feature probe.')
if failures:
    print(json.dumps(failures, indent=2))
    raise SystemExit(1)
