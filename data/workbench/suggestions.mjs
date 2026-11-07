export const suggestions = new Map([
  ['js-make-badge', {
    text: 'Normalize the supplied name before you create the badge object.',
    snippet: 'const name = rawName.trim().toUpperCase();',
  }],
  ['js-make-latest', {
    text: 'Use a new identity for each call, even when two calls have the same query.',
    snippet: 'const mine = Symbol();\ncurrent = mine;',
  }],
  ['ts-parse-dock-id', {
    text: 'Narrow the unknown input before checking its format.',
    snippet: "if (typeof value !== 'string') return undefined;",
  }],
  ['split-registers', {
    text: 'Partition the slice at the larger index before borrowing either region.',
    snippet: 'let (before_high, from_high) = values.split_at_mut(high);',
  }],
  ['go-with-tag', {
    text: 'Create storage for the result before appending the tags.',
    snippet: 'out := make([]string, 0, len(tags)+1)',
  }],
]);
