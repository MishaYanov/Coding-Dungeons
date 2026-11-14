// The Go linker emits one linear memory without a maximum by default.
// Set a maximum before validation or instantiation to bound the worker's heap.
export function capWasmMemory(bytes, limit) {
  const magic = [0, 97, 115, 109, 1, 0, 0, 0];
  if (!magic.every((value, index) => bytes[index] === value)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 65_536) throw new Error('Invalid WASM memory limit');
  let offset = 8;
  const read = () => {
    let value = 0;
    for (let factor = 1; factor <= 2 ** 28; factor *= 128) {
      if (offset >= bytes.length) throw new Error('Incomplete WASM section');
      const byte = bytes[offset++];
      value += (byte & 127) * factor;
      if (byte < 128) {
        if (value <= 0xffffffff) return value;
        break;
      }
    }
    throw new Error('Invalid WASM section size');
  };
  const write = value => {
    const encoded = [];
    while (value >= 128) {
      encoded.push((value & 127) | 128);
      value >>>= 7;
    }
    return [...encoded, value];
  };
  while (offset < bytes.length) {
    const sectionOffset = offset;
    const type = bytes[offset++];
    const size = read();
    const end = offset + size;
    if (end > bytes.length) throw new Error('Incomplete WASM section');
    if (type !== 5) { offset = end; continue; }
    const count = read();
    const flags = read();
    if (count !== 1 || (flags !== 0 && flags !== 1)) throw new Error('Unsupported WASM memory');
    const minimum = read();
    const declaredMax = flags === 1 ? read() : 65_536;
    if (minimum > declaredMax || declaredMax > 65_536 || minimum > limit || offset !== end) {
      throw new Error('WASM memory exceeds its limit');
    }
    if (flags === 1 && declaredMax <= limit) return bytes;
    const maximum = Math.min(declaredMax, limit);
    const memory = [1, 1, ...write(minimum), ...write(maximum)];
    const header = [5, ...write(memory.length), ...memory];
    const capped = new Uint8Array(sectionOffset + header.length + bytes.length - end);
    capped.set(bytes.subarray(0, sectionOffset));
    capped.set(header, sectionOffset);
    capped.set(bytes.subarray(end), sectionOffset + header.length);
    return capped;
  }
  throw new Error('WASM memory section missing');
}
