const noticeType = `type Notice =
  | { kind: 'depart'; cargoId: string }
  | { kind: 'delay'; minutes: number };`;

const decodeSignature = 'function decodeNotice(value: unknown): Notice | null';
const routeSignature = 'function routeNotice(notice: Notice, handlers: NoticeHandlers): string';
const handlersType = `type NoticeHandlers = {
  [Kind in Notice['kind']]: (notice: Extract<Notice, { kind: Kind }>) => string;
};`;
const example = (id, code) => ({id, code, visibility:'public', group:'Examples'});
const sealed = (id, group, code) => ({id, code, visibility:'sealed', group});

const decoder = {
  id:'ts-side-decode-notice',
  signature:decodeSignature,
  starter:`${noticeType}

${decodeSignature} {
  return null;
}`,
  reference:`${noticeType}

${decodeSignature} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !('kind' in value) || !Object.hasOwn(value, 'kind')) return null;
  if (value.kind === 'depart' && 'cargoId' in value && Object.hasOwn(value, 'cargoId')
      && typeof value.cargoId === 'string') {
    const cargoId = value.cargoId.trim();
    if (cargoId) return { kind: 'depart', cargoId };
  }
  if (value.kind === 'delay' && 'minutes' in value && Object.hasOwn(value, 'minutes')
      && typeof value.minutes === 'number' && Number.isInteger(value.minutes)
      && value.minutes >= 1 && value.minutes <= 120) {
    return { kind: 'delay', minutes: value.minutes };
  }
  return null;
}`,
  tests:[
    example('decode-both-notices', `const departure = decodeNotice({kind:'depart', cargoId:' C7 '});
const delay = decodeNotice({kind:'delay', minutes:15});
assert(departure?.kind === 'depart' && departure.cargoId === 'C7', 'Trim the cargo ID.');
assert(delay?.kind === 'delay' && delay.minutes === 15, 'Keep the validated delay.');`),
    sealed('reject-unchecked-fields', 'Validation', `for (const value of [
  null, 'depart', 15, {}, {kind:'unknown'}, {kind:'depart', cargoId:' '},
  {kind:'delay', minutes:'2'}, {kind:'delay', minutes:0}, {kind:'delay', minutes:121},
  {kind:'delay', minutes:1.5}, {kind:'delay', minutes:NaN}, {kind:'delay', minutes:Infinity},
  Object.create({kind:'depart', cargoId:'C7'}),
  Object.assign(Object.create({minutes:1}), {kind:'delay'}),
  Object.assign([], {kind:'depart', cargoId:'C7'}),
]) assert(decodeNotice(value) === null);
for (const minutes of [1, 120]) assert(decodeNotice({kind:'delay', minutes})?.minutes === minutes);`),
    sealed('copy-only-validated-fields', 'State ownership', `const source = Object.freeze({kind:'depart', cargoId:'C7', extra:true});
const first = decodeNotice(source);
const second = decodeNotice(source);
assert(first?.kind === 'depart' && first.cargoId === 'C7' && Object.keys(first).length === 2);
assert(first !== source && first !== second && source.extra === true);`),
  ],
  typeTests:[{id:'notice-boundary-type', code:`type NoticeAssert<T extends true> = T;
type NoticeEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type NoticeBoundary = NoticeAssert<NoticeEqual<Parameters<typeof decodeNotice>, [unknown]>>;
type NoticeResult = NoticeAssert<NoticeEqual<ReturnType<typeof decodeNotice>,
  {kind:'depart'; cargoId:string} | {kind:'delay'; minutes:number} | null>>;
const noticeInput: unknown = {kind:'depart', cargoId:'C7'};
const decoded = decodeNotice(noticeInput);
if (decoded?.kind === 'depart') {
  const id: string = decoded.cargoId;
  // @ts-expect-error A departure has no delay minutes.
  decoded.minutes;
}`}],
};

const router = {
  id:'ts-side-route-notice',
  signature:routeSignature,
  starter:`${handlersType}

${routeSignature} {
  return '';
}`,
  reference:`${handlersType}

${routeSignature} {
  switch (notice.kind) {
    case 'depart': return handlers.depart(notice);
    case 'delay': return handlers.delay(notice);
  }
}`,
  tests:[
    example('route-decoded-departure', `const notice = decodeNotice({kind:'depart', cargoId:' C7 '});
assert(notice !== null);
const message = routeNotice(notice, {
  depart: entry => 'Depart ' + entry.cargoId,
  delay: entry => 'Delay ' + entry.minutes,
});
assert(message === 'Depart C7', 'Use the departure handler and return its message.');`),
    sealed('dispatch-only-matching-handler', 'Dispatch', `const calls = [];
const handlers = {
  depart: entry => { calls.push(['depart', entry]); return 'departed'; },
  delay: entry => { calls.push(['delay', entry]); return 'delayed'; },
};
const arrival = Object.freeze({kind:'depart', cargoId:'C3'});
const hold = Object.freeze({kind:'delay', minutes:4});
assert(routeNotice(hold, handlers) === 'delayed');
assert(routeNotice(arrival, handlers) === 'departed');
assert(calls.length === 2 && calls[0][0] === 'delay' && calls[0][1] === hold);
assert(calls[1][0] === 'depart' && calls[1][1] === arrival);`),
    sealed('retained-decoder-rejects-invalid-notices', 'Validation', `assert(decodeNotice({kind:'delay', minutes:'5'}) === null);
assert(decodeNotice(Object.create({kind:'depart', cargoId:'shadow'})) === null);
assert(decodeNotice({kind:'delay', minutes:120})?.minutes === 120);`),
  ],
  typeTests:[{id:'variant-specific-handlers', code:`type HandlerAssert<T extends true> = T;
type HandlerEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type HandlerTable = Parameters<typeof routeNotice>[1];
type HandlerKeys = HandlerAssert<HandlerEqual<keyof HandlerTable, 'depart' | 'delay'>>;
type DepartureInput = HandlerAssert<HandlerEqual<Parameters<HandlerTable['depart']>, [{kind:'depart'; cargoId:string}]>>;
type DelayInput = HandlerAssert<HandlerEqual<Parameters<HandlerTable['delay']>, [{kind:'delay'; minutes:number}]>>;
type RouteReturn = HandlerAssert<HandlerEqual<ReturnType<typeof routeNotice>, string>>;
type RouteInput = HandlerAssert<HandlerEqual<Parameters<typeof routeNotice>[0], Notice>>;
// @ts-expect-error The table requires a handler for the delay variant.
routeNotice({kind:'depart', cargoId:'C7'}, {depart: entry => entry.cargoId});`}],
};

export default {
  id:'typed-message-board',
  title:'The Harbor Signal Board',
  description:'Signals from visiting crews arrive as untrusted data. Validate each notice before routing it to a typed handler.',
  brief:'Keep parsing at the harbor gate. Once a notice passes inspection, the board should route it without repeating those checks.',
  debrief:'Decode external data once at the boundary. Use the literal kind to narrow the resulting union before calling the corresponding handler. When you add a notice variant, update the decoder, handler table and dispatch cases together. Keep both type checks and runtime cases in the rollout suite.',
  standardReward:'The harbor signal board is ready for the next watch.',
  stages:[
    {
      id:'trust-boundary',
      kind:'choice',
      title:'Inspect the harbor gate',
      prompt:'New crews can send any JSON object. Where should the board establish whether a signal has the required fields and values?',
      options:[
        {id:'assert-at-input', label:'Assert that every incoming object is a Notice.'},
        {id:'validate-once', label:'Accept unknown at the gate, validate its fields, and return a typed Notice only on success.'},
        {id:'validate-in-handlers', label:'Send the raw object to every handler and keep the first answer.'},
      ],
      answer:'validate-once',
      success:'A runtime check establishes the facts that the Notice type represents.',
      retry:'Type assertions disappear at runtime. Decide which code will reject an invalid notice before dispatch.',
    },
    {
      id:'decode-notice',
      kind:'code',
      title:'Decode the incoming notice',
      prompt:'Implement decodeNotice(value). Return null unless value is a non-null, non-array object with its own kind field. For depart, require its own string cargoId and trim it to a nonempty value. For delay, require its own numeric minutes field and accept integers from 1 through 120. For each valid notice, return a fresh object containing only its kind and validated field. Leave the input intact.',
      exercise:decoder,
    },
    {
      id:'route-notice',
      kind:'code',
      carryFrom:'decode-notice',
      title:'Route the checked signal',
      prompt:'Keep your checked decoder above the new code. Implement routeNotice so it passes the original notice to its matching handler exactly once and returns that handler’s string unchanged. The handlers table requires one function for every kind, with the corresponding input variant. Use the discriminant to narrow the notice before calling the handler.',
      exercise:router,
    },
    {
      id:'add-a-variant',
      kind:'choice',
      title:'Add the storm signal',
      prompt:'The next watch adds a storm notice. What must change before the board can safely send a real storm signal through the system?',
      options:[
        {id:'only-union', label:'Add the kind to the TypeScript union. Existing compiled handlers will accept it automatically.'},
        {id:'guess-handler', label:'Treat every unknown kind as delay until the crews update.'},
        {id:'extend-contract', label:'Extend the union, decoder, handler table and dispatch together. Test valid and malformed storm notices.'},
      ],
      answer:'extend-contract',
      success:'The runtime gate and the type contract now agree on which notices the board can route.',
      retry:'A type declaration will not validate new data or select its handler at runtime.',
    },
  ],
};
