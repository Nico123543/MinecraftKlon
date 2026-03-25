import { describe, expect, test } from 'vitest';
import { decodeRle, encodeRle } from '../src/shared/rle';

describe('rle compression', () => {
  test('roundtrip keeps data unchanged', () => {
    const source = new Uint16Array(2048);
    for (let i = 0; i < source.length; i++) {
      source[i] = (i % 37) < 20 ? 1 : (i % 11);
    }

    const encoded = encodeRle(source);
    const decoded = decodeRle(encoded, source.length);
    expect(decoded).toEqual(source);
  });
});
