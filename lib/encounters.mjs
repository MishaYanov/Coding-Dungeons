function choice({ answer, success, retry, ...stage }) {
  return {
    ...stage,
    evaluate(optionId) {
      const correct = optionId === answer;
      return { correct, feedback: correct ? success : retry };
    },
  };
}

const rustSignature = `fn two_mut<T>(slice: &mut [T], first: usize, second: usize)
    -> Option<(&mut T, &mut T)>
{`;

const directBorrow = `${rustSignature}
    if first == second { return None; }
    Some((slice.get_mut(first)?, slice.get_mut(second)?))
}`;

function splitPatch(result) {
  return `${rustSignature}
    if first == second || first >= slice.len() || second >= slice.len() {
        return None;
    }
    let low = first.min(second);
    let high = first.max(second);
    let (left, right) = slice.split_at_mut(high);
    let pair = (&mut left[low], &mut right[0]);
    ${result}
}`;
}

function testBorrowPatch(optionId) {
  if (optionId === 'borrow-twice') {
    return {
      correct: false,
      feedback: 'Both calls borrow the entire slice mutably. Rust rejects the second borrow while the first reference is still needed.',
      checks: [{ label: 'The candidate can produce both mutable references', passed: false }],
    };
  }

  // Model the index pairs returned by the curated Rust patches. The graded
  // drill handles compilation and tests for a learner's own Rust code.
  function registerPair(length, first, second) {
    if (first === second || first >= length || second >= length) return null;
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return optionId === 'split-disjoint' && first > second ? [high, low] : [low, high];
  }

  const checks = [
    { label: 'Forward indices return registers in request order', passed: registerPair(4, 0, 3)?.join(',') === '0,3' },
    { label: 'Reversed indices preserve request order', passed: registerPair(4, 3, 0)?.join(',') === '3,0' },
    { label: 'Equal indices are rejected', passed: registerPair(4, 2, 2) === null },
    { label: 'Out-of-range indices are rejected in either position', passed: registerPair(4, 4, 0) === null && registerPair(4, 0, 4) === null },
  ];
  const correct = checks.every(check => check.passed);
  return {
    correct,
    checks,
    feedback: correct
      ? 'The split creates two disjoint regions. Returning the references in request order also handles reversed indices.'
      : 'The split gives you disjoint references, but returning them in index order changes what the caller receives for reversed requests.',
  };
}

function searchPatch(tracking, guard) {
  return `function makeSearch(load, publish) {
  let current;
  return async function search(query) {
    const mine = ${tracking};
    current = mine;
    let outcome;
    try {
      outcome = { ok: true, value: await load(query) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    ${guard}
  };
}`;
}

const unguardedSearch = `async function search(query) {
  let outcome;
  try {
    outcome = { ok: true, value: await load(query) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  publish(outcome);
}`;

async function replaySearch(mode, { older, latest, repeatQuery = false }) {
  let current;
  const pending = [];
  const trace = [];
  const published = [];

  function load(query) {
    return new Promise((resolve, reject) => {
      const name = pending.length === 0 ? 'Older' : 'Latest';
      trace.push(`${name} request started for “${query}”.`);
      pending.push({ name, resolve, reject });
    });
  }

  async function search(query) {
    const mine = mode === 'same-query' ? query : Symbol();
    current = mine;
    let outcome;
    try {
      outcome = { ok: true, value: await load(query) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (mode === 'unguarded' || mine === current || (mode === 'guard-success' && !outcome.ok)) {
      const display = outcome.ok ? outcome.value : outcome.error.message;
      trace.push(`Published ${outcome.ok ? 'result' : 'error'}: ${display}.`);
      published.push(display);
    }
  }

  function finish(request, type) {
    const display = `${request.name.toLowerCase()} ${type === 'resolve' ? 'results' : 'failure'}`;
    trace.push(`${request.name} request ${type === 'resolve' ? 'resolved' : 'rejected'}.`);
    if (type === 'resolve') request.resolve(display);
    else request.reject(new Error(display));
  }

  const first = search(repeatQuery ? 'map' : 'm');
  const second = search('map');
  finish(pending[1], latest);
  await second;
  finish(pending[0], older);
  await first;
  return { trace, published };
}

async function reproduceStaleResult() {
  const { trace, published } = await replaySearch('unguarded', { older: 'resolve', latest: 'resolve' });
  const correct = published.join(',') === 'latest results,older results';
  return {
    correct,
    trace,
    feedback: correct ? 'Reproduced. The older request settled last and replaced the latest results on screen.' : 'The replay did not reproduce the reported overwrite.',
  };
}

async function testSearchPatch(optionId) {
  const cases = [
    { label: 'An older success cannot overwrite the latest results', older: 'resolve', latest: 'resolve', expected: 'latest results' },
    { label: 'An older failure cannot overwrite the latest results', older: 'reject', latest: 'resolve', expected: 'latest results' },
    { label: 'The latest failure still reaches the screen', older: 'resolve', latest: 'reject', expected: 'latest failure' },
    { label: 'Repeating the same query still distinguishes the two requests', older: 'resolve', latest: 'resolve', repeatQuery: true, expected: 'latest results' },
  ];
  const checks = [];
  let failureTrace;
  for (const test of cases) {
    const { trace, published } = await replaySearch(optionId, test);
    const passed = published.length === 1 && published[0] === test.expected;
    checks.push({ label: test.label, passed });
    if (!passed) failureTrace ??= trace;
  }
  const correct = checks.every(check => check.passed);
  const feedback = correct
    ? 'All four checks pass. A unique token identifies each request, and both outcomes go through the same publication guard.'
    : optionId === 'same-query'
      ? 'Two requests can use identical query text. Give each call its own identity so an earlier call for the same query cannot publish.'
      : 'The result guard blocks old successes, but an older rejection still publishes. Apply the identity check to both outcomes.';
  return { correct, feedback, checks, ...(failureTrace && { trace: failureTrace }) };
}

export const encounters = [
  {
    id: 'ferric-scarab-elite',
    world: 'rust',
    kind: 'elite',
    title: 'The Ironbound Scarab',
    description: 'Three locks hold the Scarab’s shell shut. Spot the borrowing problem, test a repair, and explain why it works.',
    level: 3,
    page: 48,
    stages: [
      choice({
        id: 'diagnose',
        title: 'Spot the aliasing risk',
        prompt: 'The two indices differ. Why does Rust still reject this attempt to hold two mutable references?',
        actionLabel: 'Check diagnosis',
        code: directBorrow,
        options: [
          { id: 'generic-type', label: 'The generic element type must implement Copy.' },
          { id: 'overlapping-borrows', label: 'Both get_mut calls borrow the same slice. Checking the indices does not prove the borrowed regions are disjoint.' },
          { id: 'return-length', label: 'Option cannot return two references at once.' },
        ],
        answer: 'overlapping-borrows',
        success: 'The index check rules out an equal pair at runtime. The borrowing expression still needs to produce two disjoint regions.',
        retry: 'Look at what each get_mut call borrows and when the first returned reference is used.',
      }),
      {
        id: 'repair',
        title: 'Repair the register split',
        prompt: 'Return two mutable references in the requested order. Reject equal or invalid indices. Choose a curated patch to run its model checks. Use the Rust graded drill to compile and test your own code.',
        actionLabel: 'Run repair checks',
        options: [
          { id: 'borrow-twice', label: 'Keep both get_mut calls', code: directBorrow },
          { id: 'split-sorted', label: 'Split and return in index order', code: splitPatch('Some(pair)') },
          { id: 'split-disjoint', label: 'Split and return in request order', code: splitPatch('Some(if first < second { pair } else { (pair.1, pair.0) })') },
        ],
        evaluate: testBorrowPatch,
      },
      choice({
        id: 'explain',
        title: 'Prove the regions are separate',
        prompt: 'Why can the returned mutable references coexist after a valid split?',
        actionLabel: 'Check explanation',
        options: [
          { id: 'lifetime-changed', label: 'The split lengthens the lifetime of both references.' },
          { id: 'values-copied', label: 'The split copies the two values into new storage.' },
          { id: 'separate-regions', label: 'Each reference comes from a different non-overlapping slice. Both still borrow from the original storage.' },
        ],
        answer: 'separate-regions',
        success: 'The split hands out exclusive access to separate regions of one slice. The references remain tied to that slice’s borrow.',
        retry: 'The operation changes the shape of the borrow. Consider where each returned reference points.',
      }),
    ],
  },
  {
    id: 'stale-signal',
    world: 'javascript',
    kind: 'bug-hunt',
    title: 'The Stolen Signal',
    description: 'The relay briefly shows your latest search, then snaps back to an older result. Diagnose the overwrite, replay it, and patch the publication step.',
    level: 12,
    page: 38,
    stages: [
      choice({
        id: 'diagnose',
        title: 'Diagnose the overwrite',
        prompt: 'The user types “m” and then “map”. The “map” results appear first, followed by results for “m”. Which behavior explains the overwrite?',
        actionLabel: 'Check diagnosis',
        code: unguardedSearch,
        options: [
          { id: 'input-changed', label: 'Typing a new query changes the argument inside the older async call.' },
          { id: 'late-request', label: 'The older request completes later and publishes even though a newer request has started.' },
          { id: 'blocked-loop', label: 'The first await blocks the browser from starting the second search.' },
        ],
        answer: 'late-request',
        success: 'The search publishes every outcome. The last request to settle can overwrite the latest search.',
        retry: 'Separate the order in which the user starts requests from the order in which their promises settle.',
      }),
      {
        id: 'reproduce',
        title: 'Replay the two requests',
        prompt: 'Start the older request first, then complete the latest request before the older one. Follow the display updates to see which result wins.',
        actionLabel: 'Run the replay',
        evaluate: reproduceStaleResult,
      },
      {
        id: 'repair',
        title: 'Guard the publication step',
        prompt: 'Choose a patch and test the relay against late successes, late errors, the latest error, and repeated query text.',
        actionLabel: 'Run regression checks',
        options: [
          { id: 'guard-success', label: 'Guard successful results only', code: searchPatch('Symbol()', 'if (!outcome.ok || mine === current) publish(outcome);') },
          { id: 'guard-both', label: 'Give each request a token and guard both outcomes', code: searchPatch('Symbol()', 'if (mine === current) publish(outcome);') },
          { id: 'same-query', label: 'Use the query text as the token', code: searchPatch('query', 'if (mine === current) publish(outcome);') },
        ],
        evaluate: testSearchPatch,
      },
    ],
  },
];

export function publicEncounter({ id, world, kind, title, description, level, page, stages }) {
  return {
    id, world, kind, title, description, level, page,
    stages: stages.map(({ id, title, prompt, actionLabel, options, code }) => ({
      id, title, prompt, actionLabel,
      ...(options && { options: options.map(({ id, label, code }) => ({ id, label, ...(code && { code }) })) }),
      ...(code && { code }),
    })),
  };
}

export async function evaluateStage(encounter, stage, optionId) {
  if (!encounter.stages.includes(stage)) throw new Error('Stage does not belong to this encounter.');
  return stage.evaluate(optionId);
}
