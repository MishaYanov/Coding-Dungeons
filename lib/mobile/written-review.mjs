const version = 'mobile-1';

// Each condition tests one clause of the authored World 1 rubric. Check
// several concepts together and report only evidence the rule can identify.
const checks = {
  'side-1': [
    [/\b(?:fresh|different|separate|distinct|own|new)\b/i, /\bobjects?\b/i],
    [/\bfirst\b/i, /\b(?:one|1)\b/i, /\b(?:visit\w*|count\w*|incremen\w*)\b/i],
    [/\bsecond\b/i, /\b(?:zero|0)\b/i, /\b(?:remain\w*|stays?|still|unchanged|untouched)\b/i],
  ],
  'side-2': [
    [/\bnumber\b/i, /\b0x10\b/i, /\b16\b/],
    [/\b(?:before|prior)\b/i, /\b(?:conver\w*|number)\b/i, /\b(?:digits?|\[0-9\])\b|\[0-9\]|\\d/i],
    [/\b(?:reject\w*|invalid|disallows?|excludes?|fails?)\b/i, /\b(?:0x10|non-decimal|hexadecimal)\b/i],
  ],
  'side-3': [
    [/\bfirst\b/i, /\bmatch\w*\b|\bpredicate\b/i, /\breturn\w*\b/i],
    [/\bnull\b/i, /\b(?:no|nothing|exhaust\w*|none|missing|otherwise)\b/i],
    [/\b(?:stop\w*|immediate\w*|early|short-circuit\w*)\b/i, /\b(?:first|later|further|avoid\w*|needless)\b/i],
  ],
  'side-8': [
    [/\b(?:closure|closes?|captures?)\b/i, /\b(?:count|binding)\b/i, /\b(?:scope|lexical|environment|creation)\b/i],
    [/\b(?:callback|later)\b/i, /\b(?:still|access\w*|preserv\w*|does not change|keeps?)\b/i],
    [/\b(?:each|separate|own|fresh|independent)\b/i, /\b(?:count\w*|binding)\b/i],
  ],
};
const negation = /\b(?:not|never|cannot|no longer|doesn't|isn't|can't)\b/i;

export function reviewWritten(rubric, value) {
  const response = (status, score, feedback) => ({status, score, feedback, rubricVersion:version});
  const answer = value.trim().replace(/\s+/g, ' ');
  if (!answer) return response('clarify', null, 'Write a short explanation for the GM to review.');
  if (answer === rubric.reference.trim().replace(/\s+/g, ' ')) {
    return response('scored', 100, 'You covered every part. Want to compare with my answer?');
  }
  const clauses = answer.split(/(?<=[.!?;])\s+/);
  // Negated or contradictory phrasing is hard to classify with a small
  // deterministic rubric. Ask for a clearer clause rather than credit it.
  const supported = clauses.filter(clause => !negation.test(clause));
  const score = (checks[rubric.promptId] ?? []).reduce((total, patterns, index) =>
    total + (supported.some(clause => patterns.every(pattern => pattern.test(clause))) ? rubric.criteria[index].points : 0), 0);
  if (!score) return response('clarify', null, 'I could not match a rubric point. Rephrase a key claim or compare with my answer.');
  const feedback = score === 100 ? 'You covered every rubric point. Want to compare with my answer?'
    : score >= 75 ? 'Most of your reasoning checks out. Can you explain the missing detail?'
      : 'You got part of it. Want to see my answer?';
  return response('scored', score, feedback);
}

export function visibleWritten(assessment, mode) {
  if (!assessment || mode !== 'hard') return assessment;
  return {...assessment, feedback:assessment.status === 'scored'
    ? 'Hard Mode review complete.' : 'The GM could not verify this answer.'};
}
