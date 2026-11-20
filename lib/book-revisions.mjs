import revisions from '../data/reading-revisions.json' with {type:'json'};

// Pagination is presentation. Only authored, unambiguous prompt IDs have aliases;
// repeated page notes deliberately retain their original page identity.
export function remapBookResponses(world, responses, history = revisions) {
  const aliases = history[world] ?? {};
  const records = [...responses];
  const byKey = new Map(records.map(answer => [`${answer.page}:${answer.promptId}`,answer]));
  const result = new Map();
  // History is ordered newest edition first; raw row order has no chronology.
  for (const [prior,page] of Object.entries(aliases)) {
    const answer = byKey.get(prior);
    if (!answer) continue;
    const key = `${page}:${answer.promptId}`;
    if (!result.has(key)) result.set(key, {...answer, page});
  }
  // Prefer an answer explicitly written on the current page in either ordering.
  for (const answer of records) {
    if (!Object.hasOwn(aliases, `${answer.page}:${answer.promptId}`)) {
      result.set(`${answer.page}:${answer.promptId}`, {...answer});
    }
  }
  return [...result.values()];
}

export function findBookResponse(world, responses, page, promptId, history = revisions) {
  return remapBookResponses(world, responses, history)
    .find(answer => answer.page === page && answer.promptId === promptId);
}

// Query-only lookups also work inside an existing save transaction. A present
// current response wins even when its value is deliberately empty.
export function compatibleBookResponse(world, page, promptId, lookup, history = revisions) {
  const current = lookup(page, promptId);
  if (current != null) return current;
  for (const [key, target] of Object.entries(history[world] ?? {})) {
    const separator = key.indexOf(':');
    if (target !== page || key.slice(separator + 1) !== promptId) continue;
    const saved = lookup(Number(key.slice(0, separator)), promptId);
    if (saved != null) return saved;
  }
}

export function remapBookDrafts(world, drafts, history = revisions) {
  const records = [...drafts].map(([key,value]) => {
    const match = /^(\d+):([^:]+)$/.exec(key);
    return match ? {page:Number(match[1]),promptId:match[2],value}
      : {page:null,promptId:key,value,key};
  });
  return new Map(remapBookResponses(world, records, history)
    .map(({page,promptId,value,key}) => [key ?? `${page}:${promptId}`,value]));
}
