const items = [
  {id:'potion', name:'Healing potion', kind:'potion', price:1, description:'Restores up to 20 HP. Available in One Life.'},
  {id:'emerald-cloak', name:'Emerald Cloak', kind:'skin', price:1, description:'Give your hero’s badge and character sheet an emerald and gold finish.'},
  {id:'gemkeeper', name:'Gemkeeper', kind:'title', price:1, description:'Display Gemkeeper beside your hero’s name.'},
  {id:'vault-key', name:'Vault Key', kind:'key', price:2, description:'Unlock this world’s bonus challenge room.'},
];

function question(id, text, choices, answer, explanation) {
  return {id, text, options:choices.map((text, index) => ({id:['a', 'b', 'c'][index], text})), answer, explanation};
}

const challenges = new Map([
  ['javascript', {
    id:'dispatch-vault', title:'The Duplicate Dispatch',
    description:'The dispatch vault keeps one record per order. Audit its map before reopening the loading gate.',
    questions:[
      question('order-keys', 'The vault receives two separate objects, each {id: "order-7"}. Which Map key strategy stores one record per order ID?',
        ['Use the object itself.', 'Use each object’s id string.', 'Use a new Symbol for every delivery.'], 'b',
        'Separate objects and fresh symbols are distinct Map keys. The same ID string identifies both deliveries as one order.'),
      question('zero-quantity', 'A Map stores ordered quantities. Zero is a valid quantity. Which expression distinguishes a missing key from a stored zero?',
        ['Boolean(quantities.get(id))', 'quantities.get(id) > 0', 'quantities.has(id)'], 'c',
        'Map.has checks whether the key exists. A truthiness test rejects both a missing value and a stored zero.'),
    ],
  }],
  ['typescript', {
    id:'signal-vault', title:'The Untrusted Manifest',
    description:'The harbor vault receives crate manifests from a file. Verify what the loader can safely assume about a manifest.',
    questions:[
      question('boundary-type', 'The parsed manifest is stored as unknown. How should the loader establish that a crate count is a number?',
        ['Check the object and the count at runtime before returning a typed result.', 'Use a type assertion for the expected manifest shape.', 'Annotate the return type and trust any input.'], 'a',
        'The runtime check establishes what the input actually contains. A type assertion or annotation does not validate data.'),
      question('numeric-guard', 'The variable count has type unknown. In which branch can TypeScript narrow it to number?',
        ['if (count)', 'if (typeof count === "number")', 'if (count !== undefined)'], 'b',
        'The typeof check identifies numeric values. Truthiness and removal of undefined are too broad to establish number.'),
    ],
  }],
  ['csharp', {
    id:'lantern-vault', title:'The Missing Inventory Record',
    description:'Check which stock records can be processed before the vault opens.',
    questions:[
      question('nullable-source', 'A method gets a string? label which may be missing. What must you do before reading label.Length?',
        ['Add ! because it will substitute an empty string.', 'Check that label is non-null.', 'Use var to change its type.'], 'b',
        'A null check proves the value exists. The null-forgiving operator only changes the compiler’s warning analysis.'),
      question('materialize-stock', 'You filtered a list with Where and need the matching entries now, independent of later changes to the list membership. Which call materializes those entries?',
        ['ToList()', 'AsEnumerable()', 'Where again'], 'a',
        'ToList enumerates the query now into a new list. For reference elements, it copies the references and does not clone the objects.'),
    ],
  }],
  ['rust', {
    id:'foundry-vault', title:'The Recoverable Handoff',
    description:'Design a vault API that returns rejected cargo so the caller can correct it and try again.',
    questions:[
      question('return-cargo', 'The vault consumes a Cargo on success. On rejection the caller must get that owned Cargo back with a reason. Which return type expresses both outcomes?',
        ['Option<Receipt>', 'Result<Receipt, Reason>', 'Result<Receipt, (Cargo, Reason)>'], 'c',
        'The error variant owns both the rejected cargo and its reason. The success variant returns a receipt.'),
      question('borrow-inspection', 'A separate inspection function reads a Cargo and returns an independent report. The caller must retain ownership and inspection must not need exclusive access. Which parameter fits?',
        ['&Cargo', '&mut Cargo', 'Cargo'], 'a',
        'A shared reference lets the function read ordinary fields without taking ownership or requiring exclusive access.'),
    ],
  }],
  ['go', {
    id:'relay-vault', title:'The Last Relay',
    description:'The vault worker must tell the difference between a valid zero reading and the end of its stream.',
    questions:[
      question('zero-receive', 'A channel carries int values, including zero. With v, ok := <-readings, what does ok report?',
        ['Whether v is nonzero.', 'Whether the receive delivered a sent value.', 'Whether the channel had a buffer.'], 'b',
        'A sent zero gives ok == true. Receiving after the channel is closed and drained gives zero with ok == false.'),
      question('drain-channel', 'The producer closes a buffered channel while two readings remain buffered. What will a range loop over the channel do?',
        ['Read the two remaining values and then finish.', 'Stop immediately and discard the buffered values.', 'Read forever, yielding zeros after the two values.'], 'a',
        'Closing a channel leaves queued values available. A range loop stops after consuming them.'),
    ],
  }],
]);

const itemById = new Map(items.map(item => [item.id, item]));
const cosmeticKinds = ['skin', 'title'];

function reject(message, status = 409) {
  throw Object.assign(new Error(message), {status});
}

export function emptyMerchant() {
  return {potionsBought:0, owned:[], skin:null, title:null, cleared:false};
}

function spent(state) {
  return state.potionsBought * itemById.get('potion').price
    + state.owned.reduce((total, id) => total + itemById.get(id).price, 0);
}

export function validMerchantState(state, earned) {
  return Boolean(state && typeof state === 'object' && !Array.isArray(state)
    && Object.keys(state).length === 5
    && Number.isSafeInteger(state.potionsBought) && state.potionsBought >= 0 && state.potionsBought <= earned
    && Array.isArray(state.owned) && state.owned.length <= items.length - 1
    && new Set(state.owned).size === state.owned.length
    && state.owned.every(id => itemById.has(id) && id !== 'potion')
    && cosmeticKinds.every(kind => state[kind] === null
      || state.owned.includes(state[kind]) && itemById.get(state[kind]).kind === kind)
    && typeof state.cleared === 'boolean' && (!state.cleared || state.owned.includes('vault-key'))
    && spent(state) <= earned);
}

export function merchantView(worldId, state, {earned, oneLife, fallen}) {
  const balance = earned - spent(state);
  const room = challenges.get(worldId);
  const unlocked = state.owned.includes('vault-key');
  return {
    earned, balance,
    items:items.map(item => {
      const owned = state.owned.includes(item.id);
      return {...item, owned, equipped:state[item.kind] === item.id,
        available:!owned && !fallen && balance >= item.price && (item.kind !== 'potion' || oneLife)};
    }),
    equipped:{skin:state.skin, title:state.title},
    challenge:{id:room.id, title:room.title, description:room.description, unlocked, cleared:state.cleared,
      questions:unlocked && !state.cleared ? room.questions.map(({id, text, options}) => ({
        id, text, options:options.map(option => ({...option})),
      })) : []},
  };
}

export function purchaseMerchant(state, itemId, {earned, oneLife, fallen}) {
  const item = itemById.get(itemId);
  if (!item) reject('Choose an item from the merchant.', 400);
  if (fallen) reject('Your hero has fallen.');
  if (state.owned.includes(itemId)) reject('You already own this item.');
  const potion = item.kind === 'potion';
  if (potion && !oneLife) reject('Healing potions are for One Life heroes.');
  if (earned - spent(state) < item.price) reject('You do not have enough diamonds.');
  return {potion, state:potion ? {...state, potionsBought:state.potionsBought + 1}
    : {...state, owned:[...state.owned, itemId]}};
}

export function equipMerchant(state, itemId, equipped) {
  const kind = itemById.get(itemId)?.kind;
  if (!cosmeticKinds.includes(kind) || typeof equipped !== 'boolean') reject('Choose a skin or title to equip.', 400);
  if (!state.owned.includes(itemId)) reject('You do not own this item.');
  return {...state, [kind]:equipped ? itemId : null};
}

export function submitMerchantChallenge(worldId, state, answers) {
  if (!state.owned.includes('vault-key')) reject('Buy a Vault Key to enter.');
  if (state.cleared) reject('You have already cleared this challenge.');
  const {questions} = challenges.get(worldId);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== questions.length
    || !questions.every(({id, options}) => Object.hasOwn(answers, id) && options.some(option => option.id === answers[id]))) {
    reject('Choose an answer for every vault question.', 400);
  }
  const feedback = questions.map(({id, answer, explanation}) => ({id, correct:answers[id] === answer, explanation}));
  const passed = feedback.filter(item => item.correct).length;
  const correct = passed === questions.length;
  return {state:{...state, cleared:correct}, report:{correct, passed, total:questions.length, feedback}};
}
