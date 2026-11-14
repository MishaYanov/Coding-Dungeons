import assert from 'node:assert/strict';
import test from 'node:test';
import {compileFailure} from '../lib/mobile/rust-compiler.mjs';

function diagnostic(overrides = {}) {
  return JSON.stringify({level:'error', message:'mismatched types',
    spans:[{file_name:'/work/submission.rs'}],
    rendered:'error[E0308]: mismatched types\n --> /work/submission.rs:1:1\nlet value: i32 = "wrong";',
    ...overrides});
}

test('learner identifiers, source snippets and explicit diagnostics cannot impersonate compiler failures', () => {
  for (const name of ['value', 'unimplemented', 'not yet supported', 'panicked at', 'internal compiler error']) {
    const output = diagnostic({rendered:`error[E0308]: mismatched types\nlet ${name}: i32 = "wrong";`});
    const result = compileFailure({output, trapped:false}, true);
    assert.equal(result.status, 'compile_error', name);
    assert.match(result.diagnostics[0].message, /mismatched types/);
  }
  // compile_error! accepts arbitrary learner text as its diagnostic message.
  for (const message of ['wasm emission failed', 'internal compiler error', 'unimplemented']) {
    const result = compileFailure({output:diagnostic({message, rendered:message}), trapped:false}, true);
    assert.equal(result.status, 'compile_error', message);
  }
});

test('actual unsupported backend operations are infrastructure failures', () => {
  const message = 'wasm emission failed: lowering `v2 = uextend.i16 v1`: extend to i16 unimplemented';
  for (const output of ['error: ' + message, diagnostic({message, spans:[], rendered:message})]) {
    const result = compileFailure({output, trapped:true}, false);
    assert.equal(result.status, 'runner_error');
    assert.match(result.diagnostics[0].message, /cannot generate/);
  }
});

test('a compiler trap after a primary learner diagnostic still explains the compilation error', () => {
  const result = compileFailure({output:diagnostic(), trapped:true}, true);
  assert.equal(result.status, 'compile_error');
  assert.match(result.diagnostics[0].message, /submission.rs:1:1/);
  assert.equal(result.diagnostics[0].message.includes('/work/'), false);
  assert.equal(compileFailure({output:'', trapped:true}, true).status, 'runner_error');
});

test('compiler panics and ICE reports take precedence over earlier learner diagnostics', () => {
  for (const backend of [
    "thread 'rustc' panicked at compiler/backend.rs:7:3: internal compiler error",
    diagnostic({message:'internal compiler error: unexpected invariant', spans:[], rendered:'compiler failed'}),
    diagnostic({level:'error: internal compiler error', message:'unexpected invariant', rendered:'compiler failed'}),
  ]) {
    const result = compileFailure({output:diagnostic() + '\n' + backend, trapped:true}, true);
    assert.equal(result.status, 'runner_error');
  }
});

test('harness type errors retain the signature diagnostic without exposing trusted source', () => {
  const output = diagnostic({message:'cannot find function `answer`', spans:[{file_name:'/work/harness.rs'}],
    rendered:'error[E0425]: trusted fixture source'});
  const result = compileFailure({output, trapped:false}, false);
  assert.equal(result.status, 'compile_error');
  assert.match(result.diagnostics[0].message, /required signature/);
  assert.equal(result.diagnostics[0].message.includes('trusted fixture source'), false);
});
