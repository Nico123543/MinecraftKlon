import { describe, expect, test } from 'vitest';
import { CHUNK_VOLUME } from '../src/game/constants';
import { indexToLocal, linearIndex } from '../src/shared/chunkMath';

describe('chunk index mapping', () => {
  test('xyz <-> linear index is bijective', () => {
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const local = indexToLocal(i);
      const roundTrip = linearIndex(local.lx, local.ly, local.lz);
      expect(roundTrip).toBe(i);
    }
  });
});
