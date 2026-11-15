import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getQuickJS} from '../lib/quickjs-runtime.mjs';
import {runWorkbench} from '../lib/workbench-runner.mjs';
import {quickjsSecurityCases, quickjsSecurityJob} from './fixtures/quickjs-security.mjs';

for (const {id, title, expression} of quickjsSecurityCases.filter(item => !item.workerOnly)) {
  test('QuickJS security: ' + title, {timeout:5_000}, async () => {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    const deadline = performance.now() + 1_000;
    runtime.setMemoryLimit(8 * 1024 * 1024);
    runtime.setMaxStackSize(320 * 1024);
    runtime.setInterruptHandler(() => performance.now() >= deadline);
    try {
      const context = runtime.newContext();
      try {
        const evaluated = context.evalCode(expression, 'security:' + id);
        if (evaluated.error) {
          evaluated.error.dispose();
          assert.fail(id + ': the bounded security fixture threw unexpectedly.');
        }
        try {
          assert.equal(context.typeof(evaluated.value), 'boolean', id + ': fixtures report only a Boolean.');
          assert.equal(context.dump(evaluated.value), true, id + ': TypedArray.with must obey the post-conversion buffer bounds.');
        } finally {
          evaluated.value.dispose();
        }
      } finally {
        context.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

for (const language of ['javascript', 'typescript']) {
  test('the actual ' + language + ' Workbench worker retains the QuickJS security fix', {timeout:20_000}, async () => {
    const result = await runWorkbench(quickjsSecurityJob(language));
    assert.equal(result.status, 'passed', language + ': the production worker must use the corrected interpreter.');
    assert.deepEqual(result.tests.map(({id, status}) => ({id, status})),
      quickjsSecurityCases.map(({id}) => ({id, status:'passed'})));
  });
}
