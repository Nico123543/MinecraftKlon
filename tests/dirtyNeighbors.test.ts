import { describe, expect, test } from 'vitest';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../src/game/constants';
import { affectedChunkKeysForLocalEdit } from '../src/shared/chunkMath';

describe('chunk neighbor invalidation', () => {
  test('center block invalidates only its own chunk', () => {
    const keys = affectedChunkKeysForLocalEdit(3, -2, 7, 7);
    expect(keys.sort()).toEqual(['3,-2']);
  });

  test('edge block invalidates adjacent chunks', () => {
    const keys = affectedChunkKeysForLocalEdit(0, 0, 0, CHUNK_SIZE_Z - 1).sort();
    expect(keys).toEqual(['-1,0', '0,0', '0,1']);
  });

  test('corner block invalidates all touched neighbors', () => {
    const keys = affectedChunkKeysForLocalEdit(10, -4, CHUNK_SIZE_X - 1, 0).sort();
    expect(keys).toEqual(['10,-4', '10,-5', '11,-4']);
  });
});
