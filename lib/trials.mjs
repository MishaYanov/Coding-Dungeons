function question(id, text, choices, answer, explanation) {
  const options = choices.map((choice, index) => ({id: ['a', 'b', 'c'][index], text: choice}));
  return {id, text, options, answer, explanation};
}

const trials = [
  {
    worldId: 'javascript',
    id: 'dispatch-floor-trial',
    title: 'Dispatch Floor Trial',
    description: 'Check two workshop orders before the courier leaves the Dispatch Floor.',
    questions: [
      // https://tc39.es/ecma262/#sec-promise.all
      question('relay-order',
        'Promise.all receives [first, second]. The promises fulfill with "first" and "second" respectively, but second finishes before first. What is the result?',
        ['["second", "first"]', '["first", "second"]', '["second"]'], 'b',
        'Promise.all waits for both promises to fulfill and keeps their values in input order.'),
      // https://tc39.es/ecma262/#sec-isstrictlyequal
      question('badge-identity',
        'The variables badge and spare each hold a separately created object with the same properties. The variable alias was assigned badge. Which comparison is true?',
        ['badge === spare', 'spare === alias', 'badge === alias'], 'c',
        'Strict equality compares objects by identity. Assigning badge to alias makes both variables refer to the same object.'),
    ],
  },
  {
    worldId: 'typescript',
    id: 'signal-harbor-trial',
    title: 'Signal Harbor Trial',
    description: 'Sort the harbor’s signal reports before the signal office closes.',
    questions: [
      // https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
      question('read-signal',
        'A signal has type { kind: "ready" } | { kind: "error", message: string }. Inside if (signal.kind === "error"), which expression can the type checker accept as a string?',
        ['signal.message', 'signal.ready', 'signal.kind === "ready"'], 'a',
        'Checking the kind property narrows the union to its error variant. In that branch, message is a string.'),
      // https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking
      question('missing-signal',
        'A switch handles every kind in a signal union. Its default branch contains const unhandled: never = signal. What happens when you add an unhandled "paused" variant to the union?',
        ['TypeScript adds a paused case automatically.', 'TypeScript converts the paused signal to undefined.', 'The assignment to never becomes a type error.'], 'c',
        'The new variant can reach the default branch. Its type cannot be assigned to never, so the checker flags the missing case.'),
    ],
  },
  {
    worldId: 'rust',
    id: 'foundry-trial',
    title: 'Borrowing Foundry Trial',
    description: 'Carry a map through the foundry and repair a label before the wardens seal the door.',
    questions: [
      // https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html#variables-and-data-interacting-with-move
      question('pack-ownership',
        'After let scroll = String::from("map") and let pack = scroll, which binding can still be used to read the String?',
        ['Only scroll.', 'Only pack.', 'Both scroll and pack.'], 'b',
        'String does not implement Copy. The assignment moves ownership to pack, so scroll cannot be used afterward.'),
      // https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html#mutable-references
      question('repair-borrow',
        'Which parameter type lets a function append to a caller’s String while the caller keeps ownership?',
        ['&mut String', '&String', 'String'], 'a',
        'A mutable reference gives the function temporary exclusive access to edit the String while ownership stays with the caller.'),
    ],
  },
  {
    worldId: 'go',
    id: 'relay-guild-trial',
    title: 'Relay Guild Trial',
    description: 'Check the relay’s crate inventory and close the dispatch ledger before the next signal.',
    questions: [
      // https://go.dev/ref/spec#Slice_expressions
      question('shared-crates',
        'Set crates := []int{1, 2, 3}, then front := crates[:2]. What does crates[0] contain after front[0] = 9?',
        ['1', '2', '9'], 'c',
        'Slicing shares the backing array. Both slices refer to the same first element, so assigning through front also changes crates[0].'),
      // https://go.dev/ref/spec#Defer_statements
      question('deferred-ledger',
        'Inside a Go function, set count := 1, then defer fmt.Println(count), then count = 2. What does the deferred call print when the function returns?',
        ['2', '1', 'Nothing.'], 'b',
        'Go evaluates and saves the arguments when the defer statement executes. The deferred call later receives the saved value 1.'),
    ],
  },
];

export function trialsFor(worldId) {
  return trials.filter(trial => trial.worldId === worldId).map(({id, title, description, questions}) => ({
    id,
    title,
    description,
    questions: questions.map(({id, text, options}) => ({
      id, text, options: options.map(({id, text}) => ({id, text})),
    })),
  }));
}

export function evaluateTrial(worldId, trialId, answers) {
  const trial = trials.find(candidate => candidate.worldId === worldId && candidate.id === trialId);
  if (!trial || !answers || typeof answers !== 'object' || Array.isArray(answers)) return null;

  const {questions} = trial;
  if (Object.keys(answers).length !== questions.length) return null;
  if (!questions.every(({id, options}) => Object.hasOwn(answers, id) && options.some(option => option.id === answers[id]))) {
    return null;
  }

  const feedback = questions.map(({id, answer, explanation}) => ({id, correct: answers[id] === answer, explanation}));
  const passed = feedback.filter(result => result.correct).length;
  return {correct: passed === questions.length, passed, total: questions.length, feedback};
}
