export function encodeRle(data: Uint16Array): Uint16Array {
  if (data.length === 0) {
    return new Uint16Array();
  }

  const out: number[] = [];
  let current = data[0];
  let count = 1;

  for (let i = 1; i < data.length; i++) {
    const value = data[i];
    if (value === current && count < 0xffff) {
      count++;
      continue;
    }

    out.push(current, count);
    current = value;
    count = 1;
  }

  out.push(current, count);
  return Uint16Array.from(out);
}

export function decodeRle(data: Uint16Array, expectedLength: number): Uint16Array {
  if (data.length % 2 !== 0) {
    throw new Error('Invalid RLE stream length');
  }

  const out = new Uint16Array(expectedLength);
  let write = 0;

  for (let i = 0; i < data.length; i += 2) {
    const value = data[i];
    const count = data[i + 1];
    for (let c = 0; c < count; c++) {
      if (write >= expectedLength) {
        throw new Error('RLE stream overflows target length');
      }
      out[write++] = value;
    }
  }

  if (write !== expectedLength) {
    throw new Error(`RLE decoded length mismatch: got ${write}, expected ${expectedLength}`);
  }

  return out;
}
