// ECMAScript TypedArray.prototype.with captures the result length before value
// conversion, then reads each source element after that conversion. Shrinking a
// resizable buffer must not copy bytes from the now-inaccessible allocation.
// Every expression returns a Boolean; never expose inspected runtime memory.
// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.with
export const quickjsSecurityCases = [
  {
    id:'tracking-integer-shrink',
    title:'length-tracking integer views zero-fill entries removed during conversion',
    expression:`(() => {
      const buffer = new ArrayBuffer(4096, {maxByteLength:4096});
      const view = new Int32Array(buffer);
      view.fill(0x42424242);
      let conversions = 0;
      const result = view.with(0, {valueOf() { conversions++; buffer.resize(4); return 999; }});
      return conversions === 1 && result.length === 1024 && result[0] === 999
        && view.length === 1 && view[0] === 0x42424242
        && result.subarray(1).every(value => value === 0);
    })()`,
  },
  {
    id:'offset-tracking-shrink',
    title:'offset length-tracking views cannot copy removed backing bytes',
    expression:`(() => {
      const buffer = new ArrayBuffer(4096, {maxByteLength:4096});
      const view = new Int32Array(buffer, 16);
      view.fill(0x42424242);
      const result = view.with(0, {valueOf() { buffer.resize(20); return 7; }});
      return result.length === 1020 && result[0] === 7 && view.length === 1
        && result.subarray(1).every(value => value === 0);
    })()`,
  },
  {
    id:'tracking-float-shrink',
    title:'floating-point views convert removed elements from undefined to NaN',
    expression:`(() => {
      const buffer = new ArrayBuffer(4096, {maxByteLength:4096});
      const view = new Float64Array(buffer);
      view.fill(19.5);
      const result = view.with(0, {valueOf() { buffer.resize(8); return 3.5; }});
      return result.length === 512 && result[0] === 3.5
        && result.subarray(1).every(value => Number.isNaN(value));
    })()`,
  },
  {
    id:'fixed-view-invalidated',
    title:'shrinking a fixed-length view out of bounds rejects the replacement',
    expression:`(() => {
      const buffer = new ArrayBuffer(128, {maxByteLength:128});
      const view = new Int32Array(buffer, 0, 32);
      try {
        view.with(0, {valueOf() { buffer.resize(4); return 9; }});
        return false;
      } catch (error) { return error instanceof RangeError; }
    })()`,
  },
  {
    id:'offset-view-invalidated',
    title:'shrinking below an offset view rejects its now-invalid index',
    expression:`(() => {
      const buffer = new ArrayBuffer(128, {maxByteLength:128});
      const view = new Uint32Array(buffer, 16);
      try {
        view.with(0, {valueOf() { buffer.resize(8); return 9; }});
        return false;
      } catch (error) { return error instanceof RangeError; }
    })()`,
  },
  {
    id:'tracking-bigint-shrink',
    title:'BigInt views reject removed elements instead of copying inaccessible bytes',
    expression:`(() => {
      const buffer = new ArrayBuffer(4096, {maxByteLength:4096});
      const view = new BigInt64Array(buffer);
      view.fill(17n);
      try {
        view.with(0, {valueOf() { buffer.resize(8); return 9n; }});
        return false;
      } catch (error) { return error instanceof TypeError; }
    })()`,
  },
  {
    id:'growing-source',
    title:'growing the buffer during conversion preserves the originally captured length',
    expression:`(() => {
      const buffer = new ArrayBuffer(16, {maxByteLength:64});
      const view = new Int32Array(buffer);
      view.set([1, 2, 3, 4]);
      let conversions = 0;
      const result = view.with(3, {valueOf() { conversions++; buffer.resize(64); view[4] = 99; return 8; }});
      return conversions === 1 && result.length === 4 && result.join(',') === '1,2,3,8'
        && view.length === 16 && view[3] === 4 && view[4] === 99;
    })()`,
  },
  {
    id:'ordinary-number-and-bigint',
    title:'ordinary numeric and BigInt replacements preserve their source and type',
    expression:`(() => {
      const numbers = new Float64Array([1.5, 2.5, 3.5]);
      const replacedNumbers = numbers.with(-1, {valueOf() { return 7.5; }});
      const integers = new BigInt64Array([1n, 2n, 3n]);
      const replacedIntegers = integers.with(1, {valueOf() { return 99n; }});
      return replacedNumbers instanceof Float64Array && numbers.join(',') === '1.5,2.5,3.5'
        && replacedNumbers.join(',') === '1.5,2.5,7.5'
        && replacedIntegers instanceof BigInt64Array && integers.join(',') === '1,2,3'
        && replacedIntegers.join(',') === '1,99,3';
    })()`,
  },
];

// These constructor and allocation checks execute only in a disposable worker.
// They never read or write through a view whose buffer was invalidated.
quickjsSecurityCases.push(
  {
    id:'constructor-rechecks-resized-buffer', workerOnly:true,
    title:'constructor prototype lookup cannot retain stale buffer bounds',
    expression:`(() => {
      for (const offset of [0, 8]) {
        const buffer = new ArrayBuffer(16, {maxByteLength:16});
        const constructor = new Proxy(function () {}, {get(target, name, receiver) {
          if (name === 'prototype') { buffer.resize(4); return Uint8Array.prototype; }
          return Reflect.get(target, name, receiver);
        }});
        try { Reflect.construct(Uint8Array, [buffer, offset, 8], constructor); return false; }
        catch (error) { if (!(error instanceof RangeError)) return false; }
      }
      return true;
    })()`,
  },
  {
    id:'constructor-conversion-order', workerOnly:true,
    title:'constructor resolves its prototype before converting buffer offsets',
    expression:`(() => {
      const order = [];
      const buffer = new ArrayBuffer(16, {maxByteLength:32});
      const constructor = new Proxy(function () {}, {get(target, name, receiver) {
        if (name === 'prototype') { order.push('prototype'); return Uint16Array.prototype; }
        return Reflect.get(target, name, receiver);
      }});
      const offset = {valueOf() { order.push('offset'); return 2; }};
      const length = {valueOf() { order.push('length'); return 3; }};
      const view = Reflect.construct(Uint16Array, [buffer, offset, length], constructor);
      return order.join(',') === 'prototype,offset,length' && view.length === 3
        && view.byteOffset === 2 && view.buffer === buffer;
    })()`,
  },
  {
    id:'proxy-enumeration-size-limit', workerOnly:true,
    title:'oversized proxy enumeration is rejected before reading any key',
    expression:`(() => {
      for (const length of [0x20000000, 0x20000001, 0x40000001, 0xffffffff]) {
        let readKey = false;
        const keys = {length, get 0() { readKey = true; throw new Error('Unexpected key read'); }};
        try { Reflect.ownKeys(new Proxy({}, {ownKeys() { return keys; }})); return false; }
        catch (error) { if (readKey || error.name !== 'InternalError') return false; }
      }
      return true;
    })()`,
  },
  {
    id:'ordinary-proxy-enumeration', workerOnly:true,
    title:'ordinary proxy keys retain order and invariant checks',
    expression:`(() => {
      const key = Symbol('key');
      const proxy = new Proxy({a:1, b:2, [key]:3}, {ownKeys() { return ['b', key, 'a']; }});
      const keys = Reflect.ownKeys(proxy);
      if (keys.length !== 3 || keys[0] !== 'b' || keys[1] !== key || keys[2] !== 'a') return false;
      try { Reflect.ownKeys(new Proxy({}, {ownKeys() { return ['a', 'a']; }})); return false; }
      catch (error) { return error instanceof TypeError; }
    })()`,
  },
);

export function quickjsSecurityJob(language = 'javascript') {
  return {
    language,
    source:'function securityFixtureIsLoaded() { return true; }',
    tests:quickjsSecurityCases.map(({id, expression}) => ({
      id,
      code:`assert(securityFixtureIsLoaded()); assert(${expression}, 'The interpreter must preserve memory bounds and language semantics.');`,
    })),
    limits:{memoryBytes:8 * 1024 * 1024, timeoutMs:1_000, totalMs:10_000},
  };
}
