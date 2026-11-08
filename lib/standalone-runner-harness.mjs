export const caseExport = 'coding_dungeons_run_case';

const caseLimit = 32;
const fixtureLimit = 128 * 1024;
const rustTest = /#\[test\]\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/g;
const standardGoImport = /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/;
const fixtureId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function validateIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > caseLimit
      || ids.some(id => typeof id !== 'string' || !fixtureId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid native suite case IDs');
  }
}

const portableAdmission = `
fn simultaneous_callers_respect_capacity() {
    fn require_send<T: Send>() {}
    require_send::<Admission>();
    require_send::<Permit>();
    let gate = Admission::new(2);
    let handles = [gate.clone(), gate.clone(), gate.clone(), gate.clone()];
    let permits: Vec<_> = handles.iter().filter_map(|handle| handle.try_admit()).collect();
    assert_eq!(permits.len(), 2);
    assert_eq!(gate.snapshot(), Snapshot { phase: Phase::Open, occupied: 2, free: 0 });
    drop(permits);
    assert_eq!(gate.snapshot().free, 2);
}
`;

// The native compiler links this trusted file only after the learner crate was
// compiled in a workspace where the fixture source did not exist.
export function rustWasiHarness({ id, tests, testNames }) {
  validateIds(testNames);
  if (typeof tests !== 'string' || Buffer.byteLength(tests) > fixtureLimit) throw new Error('Invalid Rust suite source');
  const seen = new Set();
  let source = tests.replace(rustTest, (_, name) => {
    if (seen.has(name)) throw new Error('Duplicate Rust test function');
    seen.add(name);
    return `fn ${name}() {`;
  });
  if (seen.size !== testNames.length || testNames.some(name => !seen.has(name)) || source.includes('#[test]')) {
    throw new Error('Rust suite declarations and case IDs differ');
  }

  if (id === 'bounded-admission') {
    const oldCase = /fn simultaneous_callers_respect_capacity\(\) \{[\s\S]*?\n\}/;
    if (!oldCase.test(source)) throw new Error('The Rust admission case needs a WASI fixture');
    source = source.replace(oldCase, portableAdmission.trim());
  }
  const cases = testNames.map((name, index) => `${index} => ${name}(),`).join('\n');
  return {
    ids: [...testNames],
    source: `mod ferrum_tests {
    use ferrum_submission::*;
    ${source}
    pub(super) fn run(index: i32) -> i32 {
        match index { ${cases} _ => return 0 }
        1
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ${caseExport}(index: i32) -> i32 {
    ferrum_tests::run(index)
}
`,
  };
}

export function goWasiHarness(fixtures) {
  if (!Array.isArray(fixtures)) throw new Error('Invalid Go suite source');
  const ids = fixtures.map(fixture => fixture?.id);
  validateIds(ids);
  const imports = new Set();
  let totalBytes = 0;
  const cases = fixtures.map((fixture, index) => {
    if (typeof fixture.code !== 'string' || !fixture.code.trim() || (totalBytes += Buffer.byteLength(fixture.code)) > fixtureLimit) {
      throw new Error('Invalid Go suite source');
    }
    if (fixture.imports !== undefined && !Array.isArray(fixture.imports)) throw new Error('Invalid Go suite imports');
    for (const name of fixture.imports ?? []) {
      if (typeof name !== 'string' || !standardGoImport.test(name)) throw new Error('Invalid Go suite imports');
      imports.add(name);
    }
    return `case ${index}:\n        func(t *codingDungeonsCase) {\n${fixture.code}\n        }(trial)`;
  });
  const importSource = imports.size ? `import (\n${[...imports].sort().map(name => `    "${name}"`).join('\n')}\n)\n` : '';
  return {
    ids,
    source: `package main

${importSource}
type codingDungeonsCase struct { failures int }

func (t *codingDungeonsCase) Fatal(_ ...any) { t.Error(); panic("test failed") }
func (t *codingDungeonsCase) Fatalf(_ string, args ...any) { t.Fatal(args...) }
func (t *codingDungeonsCase) Error(_ ...any) { t.failures = 1 }
func (t *codingDungeonsCase) Errorf(_ string, args ...any) { t.Error(args...) }
func (t *codingDungeonsCase) Helper() {}

//go:wasmexport ${caseExport}
func codingDungeonsRunCase(index int32) int32 {
    trial := &codingDungeonsCase{}
    switch index {
        ${cases.join('\n')}
    default:
        return 0
    }
    if trial.failures != 0 { return 0 }
    return 1
}
`,
  };
}
