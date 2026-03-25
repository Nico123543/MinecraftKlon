import { describe, expect, test } from 'vitest';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, CHUNK_VOLUME } from '../src/game/constants';
import { BlockId } from '../src/shared/blocks';
import { linearIndex } from '../src/shared/chunkMath';
import { buildChunkMeshes, buildGreedyMesh } from '../src/shared/meshing';

function emptyChunk(): Uint16Array {
  return new Uint16Array(CHUNK_VOLUME);
}

describe('greedy meshing', () => {
  test('single block creates 6 quads', () => {
    const blocks = emptyChunk();
    blocks[linearIndex(1, 1, 1)] = BlockId.Stone;
    const mesh = buildGreedyMesh(blocks);
    expect(mesh.quadCount).toBe(6);
  });

  test('two adjacent blocks do not keep internal faces', () => {
    const blocks = emptyChunk();
    blocks[linearIndex(1, 1, 1)] = BlockId.Stone;
    blocks[linearIndex(2, 1, 1)] = BlockId.Stone;
    const mesh = buildGreedyMesh(blocks);
    expect(mesh.quadCount).toBe(6);
  });

  test('full solid chunk collapses to six large quads', () => {
    const blocks = emptyChunk();
    for (let y = 0; y < CHUNK_SIZE_Y; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          blocks[linearIndex(x, y, z)] = BlockId.Stone;
        }
      }
    }

    const mesh = buildGreedyMesh(blocks);
    expect(mesh.quadCount).toBe(6);
  });

  test('water mesh is generated separately', () => {
    const blocks = emptyChunk();
    blocks[linearIndex(4, 10, 4)] = BlockId.Water;
    blocks[linearIndex(4, 11, 4)] = BlockId.Water;
    const meshBundle = buildChunkMeshes(blocks);
    expect(meshBundle.solid.quadCount).toBe(0);
    expect(meshBundle.water.quadCount).toBeGreaterThan(0);
    expect(meshBundle.lava.quadCount).toBe(0);
  });
});
