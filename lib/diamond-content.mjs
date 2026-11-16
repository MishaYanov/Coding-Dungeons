export const encounterId = 'diamond-goblin';
export const rewardDiamonds = 3;
export const stages = ['code', 'choice'];
export const pageBlockSize = 8;
export const title = 'The Diamond Goblin';
export const description = 'A goblin snatches the loose gem and throws it into a locked sack. Crack the lock and answer its riddle to win the diamonds.';
export const exerciseTitle = 'Crack the sack lock';
export const exerciseDescription = 'Add the positive entries and leave the input unchanged. Negative entries and zero add nothing. There are at most 1,000 entries, each an integer from −1,000 to 1,000. Return zero if there are no positive entries.';
const mixed = [4, -7, 0, 5];
const larger = [12, -3, 2, 12, -1_000, 1_000];
const scriptFixtures = [
  {id:'mixed-bag', visibility:'public', group:'Examples',
    code:`assert(sumDiamonds(${JSON.stringify(mixed)}) === 9, 'Add the positive entries only.');`},
  {id:'no-diamonds', visibility:'sealed', group:'Edge cases',
    code:'assert(sumDiamonds([]) === 0 && sumDiamonds([-1, 0, -1000]) === 0);'},
  {id:'untouched-bag', visibility:'sealed', group:'Edge cases',
    code:`assert(sumDiamonds(Object.freeze(${JSON.stringify(larger)})) === 1026);`},
];

function rustCase(name, body) {
  return `#[test]\nfn ${name}() {\n    ${body}\n}`;
}

const rustCases = [
  ['mixed_bag', `assert_eq!(sum_diamonds(&[${mixed.join(', ')}]), 9);`],
  ['no_diamonds', 'assert_eq!(sum_diamonds(&[]), 0);\n    assert_eq!(sum_diamonds(&[-1, 0, -1000]), 0);'],
  ['larger_bag', `assert_eq!(sum_diamonds(&[${larger.join(', ')}]), 1026);`],
];
const jsSignature = 'function sumDiamonds(values)';
const tsSignature = 'function sumDiamonds(values: readonly number[]): number';
const rustSignature = 'pub fn sum_diamonds(values: &[i32]) -> i32';
const goSignature = 'func sumDiamonds(values []int) int';
export const definitions = {
  javascript:{
    signature:jsSignature,
    starter:`${jsSignature} {\n  // Count the diamonds here.\n  return 0;\n}`,
    reference:`${jsSignature} {\n  return values.reduce((sum, value) => sum + Math.max(0, value), 0);\n}`,
    tests:scriptFixtures,
  },
  typescript:{
    signature:tsSignature,
    starter:`${tsSignature} {\n  // Count the diamonds here.\n  return 0;\n}`,
    reference:`${tsSignature} {\n  return values.reduce((sum, value) => sum + Math.max(0, value), 0);\n}`,
    tests:scriptFixtures,
    typeTests:[{id:'readonly-bag', code:`const bag: readonly number[] = [4, -7, 0, 5];
const total: number = sumDiamonds(bag);
// @ts-expect-error Only numeric entries are allowed.
sumDiamonds(['4']);`}],
  },
  rust:{
    signature:rustSignature,
    starter:`${rustSignature} {\n    todo!()\n}`,
    reference:`${rustSignature} {\n    values.iter().copied().filter(|&value| value > 0).sum()\n}`,
    tests:rustCases.map(([name, body]) => rustCase(name, body)).join('\n\n'),
    testNames:rustCases.map(([name]) => name),
  },
  go:{
    signature:goSignature,
    starter:`package main\n\n${goSignature} {\n\t// Count the diamonds here.\n\treturn 0\n}\n\nfunc main() {}\n`,
    reference:`package main\n\n${goSignature} {\n\ttotal := 0\n\tfor _, value := range values {\n\t\tif value > 0 {\n\t\t\ttotal += value\n\t\t}\n\t}\n\treturn total\n}\n\nfunc main() {}\n`,
    tests:[
      {id:'mixed-bag', visibility:'public', group:'Examples',
        code:`if sumDiamonds([]int{${mixed.join(', ')}}) != 9 { t.Fatal("Add the positive entries only.") }`},
      {id:'no-diamonds', visibility:'sealed', group:'Edge cases',
        code:'if sumDiamonds(nil) != 0 || sumDiamonds([]int{}) != 0 || sumDiamonds([]int{-1, 0, -1000}) != 0 { t.Fatal("Expected zero.") }'},
      {id:'untouched-bag', visibility:'sealed', group:'Edge cases', imports:['slices'],
        code:`bag := []int{${larger.join(', ')}}
if sumDiamonds(bag) != 1026 { t.Fatal("Unexpected total.") }
if !slices.Equal(bag, []int{${larger.join(', ')}}) { t.Fatal("Leave the input unchanged.") }`},
    ],
  },
};

export const riddles = {
  javascript:{
    prompt:'Which expression creates a new array with the same entries while leaving the original array alone?',
    options:[{id:'sort', label:'values.sort()'}, {id:'slice', label:'values.slice()'}, {id:'same', label:'const copy = values'}],
    answer:'slice',
    explanation:'slice() with no arguments makes a shallow copy of the entire array. sort() can reorder the original, and assignment only creates another reference to it.',
    hint:'Look for a method that allocates a new array and preserves the order of its entries.',
  },
  typescript:{
    prompt:'Which annotation lets you read an entry as a number but rejects writing through values at type check time?',
    options:[{id:'readonly', label:'readonly number[]'}, {id:'mutable', label:'number[]'}, {id:'unknown', label:'unknown[]'}],
    answer:'readonly',
    explanation:'readonly number[] gives you number entries and disallows writes through this reference at type check time.',
    hint:'Look for an annotation that keeps the number element type and restricts changes through this reference.',
  },
  csharp:{
    prompt:'You have a Dictionary<string, int> and need to distinguish an absent key from a stored zero. Which operation tells you whether the key exists and retrieves the value in one call?',
    options:[{id:'index', label:'counts[key]'}, {id:'lookup', label:'counts.TryGetValue(key, out int count)'},
      {id:'count', label:'counts.Count'}],
    answer:'lookup',
    explanation:'TryGetValue returns a Boolean for key presence and writes the value through the out parameter. A stored zero still returns true.',
    hint:'Look for the operation that reports whether it found the key separately from the value.',
  },
  rust:{
    prompt:'Which parameter type allows a shared borrow of a sequence of i32 values?',
    options:[{id:'owned', label:'Vec<i32>'}, {id:'exclusive', label:'&mut [i32]'}, {id:'shared', label:'&[i32]'}],
    answer:'shared',
    explanation:'&[i32] borrows a slice through a shared reference. Vec<i32> takes ownership and &mut [i32] requires an exclusive borrow.',
    hint:'Look for the slice reference that does not require exclusive access or move ownership.',
  },
  go:{
    prompt:'What happens if a function writes values[0] on a nonempty []int slice it received from its caller?',
    options:[{id:'isolated', label:'The caller keeps the old element because parameters are passed by value.'},
      {id:'shared', label:'The caller sees the new element through its slice.'},
      {id:'append', label:'The slice grows by one element.'}],
    answer:'shared',
    explanation:'Go copies the slice value when passing it to the function. Both slices still refer to the same backing array, so the element write is visible.',
    hint:'Consider what gets copied when you pass a slice and where its elements are stored.',
  },
};

const csharpLock = {
  prompt:'The lock reads Console.WriteLine(7 / 2); in a C# program. Which value does it print?',
  options:[{id:'three', label:'3'}, {id:'three-half', label:'3.5'}, {id:'four', label:'4'}],
  answer:'three',
  explanation:'Both operands are integers. Integer division truncates toward zero, so the lock reads 3.',
  hint:'Check the types of both operands before deciding whether the result can have a fraction.',
};

export function diamondChoiceStage(world, stageId) {
  return stageId === 'choice' || (world === 'csharp' && stageId === 'code');
}

export function diamondDescription(world) {
  return world === 'csharp'
    ? 'A goblin hides the gem in a locked sack. Read the C# expression on the lock and solve its riddle to claim the diamonds.'
    : description;
}

export function diamondChoices(world) {
  const stage = (id, title, {prompt, options}) => ({id, title, kind:'choice', prompt, options});
  return {lock:world === 'csharp' ? stage('code', 'Read the sack lock', csharpLock) : null,
    riddle:stage('choice', 'Answer the goblin’s riddle', riddles[world])};
}

export function evaluateDiamondChoice(world, optionId, stageId = 'choice') {
  const riddle = world === 'csharp' && stageId === 'code' ? csharpLock : riddles[world];
  if (!riddle?.options.some(option => option.id === optionId)) return null;
  const correct = optionId === riddle.answer;
  return {correct, feedback:correct ? riddle.explanation : riddle.hint};
}

export function evaluateDiamondCode(report) {
  const feedback = {
    pass:report.purpose === 'examples' ? 'The visible checks passed. Submit to run the full suite.' : 'The sack lock springs open. Now answer the goblin’s riddle.',
    fail:'The sack stays locked. Check the results and try another approach.',
    compile_error:'The code could not compile. Fix the error to try the lock again.',
    timeout:'The tests ran out of time. Try a faster solution.',
    unavailable:'The local runner is unavailable. Your draft is saved.',
    busy:'The local runner is busy. Try again in a moment.',
  }[report.verdict] ?? 'The runner could not complete this check. Try again.';
  return {...report, correct:report.verdict === 'pass', feedback};
}
