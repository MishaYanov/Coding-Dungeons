const version = 'mobile-1';

// Each condition tests one clause of an authored rubric. Check
// several concepts together and report only evidence the rule can identify.
const checks = {
  'javascript/side-1': [
    [/\b(?:fresh|different|separate|distinct|own|new)\b/i, /\bobjects?\b/i],
    [/\bfirst\b/i, /\b(?:one|1)\b/i, /\b(?:visit\w*|count\w*|incremen\w*)\b/i],
    [/\bsecond\b/i, /\b(?:zero|0)\b/i, /\b(?:remain\w*|stays?|still|unchanged|untouched)\b/i],
  ],
  'javascript/side-2': [
    [/\bnumber\b/i, /\b0x10\b/i, /\b16\b/],
    [/\b(?:before|prior)\b/i, /\b(?:conver\w*|number)\b/i, /\b(?:digits?|\[0-9\])\b|\[0-9\]|\\d/i],
    [/\b(?:reject\w*|invalid|disallows?|excludes?|fails?)\b/i, /\b(?:0x10|non-decimal|hexadecimal)\b/i],
  ],
  'javascript/side-3': [
    [/\bfirst\b/i, /\bmatch\w*\b|\bpredicate\b/i, /\breturn\w*\b/i],
    [/\bnull\b/i, /\b(?:no|nothing|exhaust\w*|none|missing|otherwise)\b/i],
    [/\b(?:stop\w*|immediate\w*|early|short-circuit\w*)\b/i, /\b(?:first|later|further|avoid\w*|needless)\b/i],
  ],
  'javascript/side-8': [
    [/\b(?:closure|closes?|captures?)\b/i, /\b(?:count|binding)\b/i, /\b(?:scope|lexical|environment|creation)\b/i],
    [/\b(?:callback|later)\b/i, /\b(?:still|access\w*|preserv\w*|does not change|keeps?)\b/i],
    [/\b(?:each|separate|own|fresh|independent)\b/i, /\b(?:count\w*|binding)\b/i],
  ],
  'typescript/side-2': [
    [/\b(?:read[\s-]*only|immutable)\b/i, /\b(?:map|groups?|properties|keys)\b/i],
    [/\b(?:read[\s-]*only|immutable)\b/i, /\b(?:arrays?|nested|results?|elements?)\b/i],
  ],
  'typescript/side-4': [
    [/\b(?:second|callback)\b/i, /\b(?:exception|throw\w*|error)\b/i, /\b(?:propagat\w*|bubbles?|caller)\b/i],
    {explicitNegation:[/\b(?:never|cannot|can't|does(?:n't| not)|won't|will not)\s+return\w*\b|\bno\s+(?:partial|incomplete)\b/i,
      /\b(?:partial|incomplete)\b/i]},
  ],
  'typescript/side-6': [
    [/\b(?:caught|rejection|thrown|catch)\b/i, /\bunknown\b/i],
    [/\b(?:narrow\w*|instanceof|typeof|check\w*)\b/i, /\b(?:message|diagnostic)\b/i, /\b(?:error|string)\b/i],
    [/\boffline\b/i, /\b(?:diagnostic|fallback|message)\b/i],
  ],
  'typescript/side-8': [
    [/\b(?:allowlist|allowed|permitted)\b/i, /\b(?:runtime|run time)\b/i, /\b(?:check\w*|validat\w*|match\w*)\b/i],
    [/\b(?:reject\w*|discard\w*|skip\w*)\b/i, /\b(?:invalid|unknown|disallowed|others?|rest|input)\b/i],
    [/\b(?:validat\w*|narrow\w*|allowed|permitted)\b/i, /\bpluck\b/i],
  ],
  'rust/training-1-1': [
    [/\b(?:copy|copies|clone\w*)\b/i, /\b(?:selected|fields?|strings?)\b/i, /\b(?:own\w*|reus\w*)\b/i],
    [/\b(?:proportional|allocate\w*|allocations?|cost\w*|pays?|paying)\b/i, /\b(?:bytes?|data|selected)\b/i],
    [/\b(?:own\w*|move\w*|share\w*|Arc)\b/i, /\b(?:backing|buffer)\b/i, /\b(?:range\w*|offset\w*|Arc)\b/i],
    [/\b(?:whole|complete|entire)\b/i, /\b(?:backing|allocation|buffer)\b/i, /\b(?:retain\w*|keeps?|hold\w*)\b/i],
  ],
  'rust/training-1-3': [
    [/\b(?:borrow\w*|reference)\b/i, /\b(?:last|final)\b/i, /\b(?:use|access)\b/i],
    [/\bafter\b/i, /\brefresh\b/i, /\b(?:overlap\w*|exclusive|mutable)\b/i],
    {explicitNegation:[/\b(?:does(?:n't| not)|cannot|can't|never)\s+(?:narrow|remove|change|weaken)\b|\bstill\s+(?:needs|requires)\b/i,
      /\b(?:preallocat\w*|reserv\w*|capacity)\b/i,
      /\b(?:contract|exclusive|mutable|borrow\w*)\b/i]},
  ],
  'rust/training-2-1': [
    [/\b(?:remaining|unmoved|left|other)\b/i, /\bfield\b/i, /\b(?:use|access\w*|move\w*)\b/i],
    {explicitNegation:[/\b(?:cannot|can't|may not|can no longer)\s+(?:use|access|move)\b|\b(?:unavailable|unusable)\b/i,
      /\b(?:whole|entire)\b/i, /\b(?:struct|value)\b/i]},
    [/\b(?:drop\w*|cleanup)\b/i, /\b(?:remaining|owned|owner|initialized)\b/i, /\b(?:field\w*|moved)\b/i],
  ],
  'rust/training-4-3': [
    [/\b(?:drop\w*|free\w*)\b/i, /\b(?:own\w*|String)\b/i, /\b(?:normally|static|leak\w*)\b/i],
    [/\b(?:own\w*|String)\b/i, /\b(?:transfer\w*|moves?|carries)\b/i, /\b(?:no|ownership|owned)\b/i],
    [/\b(?:referent|local)\b/i, /\b(?:lifetime|handle|reference)\b/i,
      /\b(?:local|only|expire\w*)\b/i],
  ],
  'go/side-1': [
    [/\blen\b/i, /\b(?:2|two)\b/i],
    [/\b(?:1|one|233|u\+00e9)\b/i, /\brunes?\b/i],
    [/\blen\b/i, /\bbytes?\b/i, /\b(?:range|ranging)\b/i, /\b(?:runes?|utf-8)\b/i],
  ],
  'go/side-2': [
    [/\+2/, /\b(?:accept\w*|pars\w*|yields?)\b/i],
    [/\b2\.0\b/, /\b(?:reject\w*|fails?|invalid)\b/i],
    [/\b(?:pars\w*|conversion|syntax)\b/i, /\bdomain\b/i, /\b(?:before|after|first)\b/i],
  ],
  'go/side-4': [
    [/\b(?:capac\w*|cap)\b/i, /\b(?:1|one)\b/i, /\bfront\b/i],
    [/\bappend\w*\b/i, /\b(?:new|allocat\w*)\b/i, /\b(?:array|storage|backing)\b/i],
    [/\bbefore\b/i, /\bappend\w*\b/i, /\bfront\[0\]/i, /\bstock\[0\]/i],
  ],
  'go/side-6': [
    [/\b(?:copy|copies|copied)\b/i, /\bslice\b/i, /\bheader\b/i],
    [/\b(?:shared?|same)\b/i, /\b(?:backing|underlying)\b/i, /\b(?:array|elements?)\b/i, /\b(?:write\w*|mutation|visible|change\w*)\b/i],
  ],
};
const negation = /\b(?:not|never|cannot|no longer|doesn['’]t|isn['’]t|can['’]t)\b/i;

export function reviewWritten(rubric, value) {
  const response = (status, score, feedback) => ({status, score, feedback, rubricVersion:version});
  const answer = value.trim().replace(/\s+/g, ' ');
  if (!answer) return response('clarify', null, 'Write a short explanation for the GM to review.');
  if (answer === rubric.reference.trim().replace(/\s+/g, ' ')) {
    return response('scored', 100, 'You covered every part. Want to compare with my answer?');
  }
  const clauses = answer.split(/(?<=[.!?;])\s+|,\s*but\s+/i);
  // Negated or contradictory phrasing is hard to classify with a small
  // deterministic rubric. Ask for a clearer clause rather than credit it.
  const supported = clauses.filter(clause => !negation.test(clause));
  const score = (checks[`${rubric.worldId}/${rubric.promptId}`] ?? []).reduce((total, condition, index) => {
    const patterns = condition.explicitNegation ?? condition;
    const evidence = condition.explicitNegation ? clauses : supported;
    return total + (evidence.some(clause => patterns.every(pattern => pattern.test(clause))) ? rubric.criteria[index].points : 0);
  }, 0);
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
