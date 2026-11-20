"""Validate book programs and game fixtures on the baseline and current toolchains."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from book_sources import checked_sources

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT/'work/qa'
results = []
for toolchain in sys.argv[1:] or ['1.99.1','1.100.0']:
    compiler = subprocess.check_output(['rustup','which','--toolchain',toolchain,'rustc'],
                                       cwd=ROOT,text=True).strip()
    env = {**os.environ,'FERRUM_TEST_RUSTC':compiler}
    for script in ['check_examples.py','run_case_studies.py']:
        subprocess.run([sys.executable,str(ROOT/'work/scripts'/script)],cwd=ROOT,env=env,check=True)
    subprocess.run(['node','--test','test/exercises.test.mjs','test/workbench-rust-catalog.test.mjs',
                    'test/rogue-rust-catalog.test.mjs'],cwd=ROOT,env=env,check=True)
    checks=json.loads((QA/'example_checks.json').read_text(encoding='utf-8'))
    runs=json.loads((QA/'case_study_execution.json').read_text(encoding='utf-8'))
    results.append({'toolchain':toolchain,'compiler':checks['compiler'],
                    'checked':checks['checked'],'accepted':checks['accepted'],
                    'expectedRejections':checks['rejected'],'unexpected':checks['unexpected'],
                    'executed':len(runs),'executionFailures':sum(not run['passed'] for run in runs)})
sources={path.name:hashlib.sha256(path.read_bytes()).hexdigest()
         for path in checked_sources(ROOT/'work/manuscript')}
report={'edition':'2024','sources':sources,'toolchains':results}
(QA/'book_toolchains.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'toolchains':results},indent=2))
