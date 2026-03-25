import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../game/constants';
import { blockColor, BlockId, isFlora, isFluid, isLava, isSolid, isWater } from './blocks';
import { linearIndex } from './chunkMath';

export interface ChunkMeshData {
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  indices: Uint32Array;
  quadCount: number;
}

export interface ChunkMeshBundle {
  solid: ChunkMeshData;
  water: ChunkMeshData;
  lava: ChunkMeshData;
  flora: ChunkMeshData;
}

type Axis = 'x' | 'y' | 'z';

interface FaceDescriptor {
  axis: Axis;
  dir: 1 | -1;
  nx: number;
  ny: number;
  nz: number;
}

const FACE_DESCRIPTORS: FaceDescriptor[] = [
  { axis: 'x', dir: 1, nx: 1, ny: 0, nz: 0 },
  { axis: 'x', dir: -1, nx: -1, ny: 0, nz: 0 },
  { axis: 'y', dir: 1, nx: 0, ny: 1, nz: 0 },
  { axis: 'y', dir: -1, nx: 0, ny: -1, nz: 0 },
  { axis: 'z', dir: 1, nx: 0, ny: 0, nz: 1 },
  { axis: 'z', dir: -1, nx: 0, ny: 0, nz: -1 }
];

const WATER_SURFACE_DROP = 0.02;

function getBlockAt(blocks: Uint16Array, x: number, y: number, z: number): BlockId {
  if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) {
    return BlockId.Air;
  }
  return blocks[linearIndex(x, y, z)] as BlockId;
}

function normalBrightness(nx: number, ny: number, nz: number): number {
  if (ny === 1) return 1;
  if (ny === -1) return 0.55;
  if (Math.abs(nx) === 1) return 0.82;
  if (Math.abs(nz) === 1) return 0.68;
  return 0.8;
}

function colorVariation(slice: number, u: number, v: number, block: BlockId): number {
  let n = Math.imul(slice + 31, 73856093) ^ Math.imul(u + 17, 19349663) ^ Math.imul(v + 13, 83492791);
  n ^= block * 2654435761;
  n = (n ^ (n >>> 13)) >>> 0;
  return (n / 0xffffffff) * 2 - 1;
}

function pushQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  descriptor: FaceDescriptor,
  block: BlockId,
  slice: number,
  u: number,
  v: number,
  width: number,
  height: number
): void {
  const { axis, dir, nx, ny, nz } = descriptor;
  const baseIndex = positions.length / 3;
  const brightness = normalBrightness(nx, ny, nz);
  const [rRaw, gRaw, bRaw] = blockColor(block);
  const jitterStrength = isFluid(block) ? 0 : 12;
  const jitter = colorVariation(slice, u, v, block) * jitterStrength;
  const r = Math.max(0, Math.min(255, Math.round(rRaw * brightness + jitter)));
  const g = Math.max(0, Math.min(255, Math.round(gRaw * brightness + jitter * 0.8)));
  const blue = Math.max(0, Math.min(255, Math.round(bRaw * brightness + jitter * 0.6)));
  const topDrop = isWater(block) ? WATER_SURFACE_DROP : 0;

  let verts: Array<[number, number, number]>;

  if (axis === 'x') {
    const px = dir === 1 ? slice + 1 : slice;
    const y0 = u;
    const y1 = u + width;
    const yTop = y1 - topDrop;
    const z0 = v;
    const z1 = v + height;
    verts = dir === 1
      ? [
          [px, y0, z0],
          [px, yTop, z0],
          [px, yTop, z1],
          [px, y0, z1]
        ]
      : [
          [px, y0, z0],
          [px, y0, z1],
          [px, yTop, z1],
          [px, yTop, z0]
        ];
  } else if (axis === 'y') {
    const py = dir === 1 ? slice + 1 - topDrop : slice;
    const x0 = u;
    const x1 = u + width;
    const z0 = v;
    const z1 = v + height;
    verts = dir === 1
      ? [
          [x0, py, z0],
          [x0, py, z1],
          [x1, py, z1],
          [x1, py, z0]
        ]
      : [
          [x0, py, z0],
          [x1, py, z0],
          [x1, py, z1],
          [x0, py, z1]
        ];
  } else {
    const pz = dir === 1 ? slice + 1 : slice;
    const x0 = u;
    const x1 = u + width;
    const y0 = v;
    const y1 = v + height;
    const yTop = y1 - topDrop;
    verts = dir === 1
      ? [
          [x0, y0, pz],
          [x1, y0, pz],
          [x1, yTop, pz],
          [x0, yTop, pz]
        ]
      : [
          [x0, y0, pz],
          [x0, yTop, pz],
          [x1, yTop, pz],
          [x1, y0, pz]
        ];
  }

  for (const [x, y, z] of verts) {
    positions.push(x, y, z);
    normals.push(nx * 127, ny * 127, nz * 127);
    colors.push(r, g, blue);
  }

  indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function buildGreedyMeshWithRules(
  blocks: Uint16Array,
  includeBlock: (block: BlockId) => boolean,
  occludesFace: (block: BlockId) => boolean
): ChunkMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const face of FACE_DESCRIPTORS) {
    const axisSize = face.axis === 'x' ? CHUNK_SIZE_X : face.axis === 'y' ? CHUNK_SIZE_Y : CHUNK_SIZE_Z;
    const dimU = face.axis === 'x' ? CHUNK_SIZE_Y : CHUNK_SIZE_X;
    const dimV = face.axis === 'z' ? CHUNK_SIZE_Y : CHUNK_SIZE_Z;

    for (let slice = 0; slice < axisSize; slice++) {
      const mask = new Uint16Array(dimU * dimV);

      for (let v = 0; v < dimV; v++) {
        for (let u = 0; u < dimU; u++) {
          let x = 0;
          let y = 0;
          let z = 0;

          if (face.axis === 'x') {
            x = slice;
            y = u;
            z = v;
          } else if (face.axis === 'y') {
            x = u;
            y = slice;
            z = v;
          } else {
            x = u;
            y = v;
            z = slice;
          }

          const block = getBlockAt(blocks, x, y, z);
          if (!includeBlock(block)) {
            continue;
          }

          const nx = face.axis === 'x' ? x + face.dir : x;
          const ny = face.axis === 'y' ? y + face.dir : y;
          const nz = face.axis === 'z' ? z + face.dir : z;
          const neighbor = getBlockAt(blocks, nx, ny, nz);
          if (occludesFace(neighbor)) {
            continue;
          }

          mask[v * dimU + u] = block;
        }
      }

      for (let v = 0; v < dimV; v++) {
        for (let u = 0; u < dimU; ) {
          const block = mask[v * dimU + u] as BlockId;
          if (block === BlockId.Air) {
            u++;
            continue;
          }

          let width = 1;
          while (u + width < dimU && mask[v * dimU + (u + width)] === block) {
            width++;
          }

          let height = 1;
          let canExtend = true;
          while (v + height < dimV && canExtend) {
            for (let w = 0; w < width; w++) {
              if (mask[(v + height) * dimU + (u + w)] !== block) {
                canExtend = false;
                break;
              }
            }
            if (canExtend) {
              height++;
            }
          }

          pushQuad(positions, normals, colors, indices, face, block, slice, u, v, width, height);

          for (let dv = 0; dv < height; dv++) {
            for (let du = 0; du < width; du++) {
              mask[(v + dv) * dimU + (u + du)] = BlockId.Air;
            }
          }

          u += width;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Int8Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    quadCount: indices.length / 6
  };
}

export function buildGreedyMesh(blocks: Uint16Array): ChunkMeshData {
  return buildGreedyMeshWithRules(blocks, (block) => isSolid(block), (neighbor) => isSolid(neighbor));
}

function pushSpriteQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  r: number,
  g: number,
  blue: number
): void {
  const baseIndex = positions.length / 3;
  const nx = 0;
  const ny = 1;
  const nz = 0;

  for (const [x, y, z] of [a, b, c, d]) {
    positions.push(x, y, z);
    normals.push(nx * 127, ny * 127, nz * 127);
    colors.push(r, g, blue);
  }
  indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function buildFloraMesh(blocks: Uint16Array): ChunkMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y < CHUNK_SIZE_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const block = getBlockAt(blocks, x, y, z);
        if (!isFlora(block)) {
          continue;
        }
        if (!isSolid(getBlockAt(blocks, x, y - 1, z))) {
          continue;
        }

        const [rBase, gBase, bBase] = blockColor(block);
        const jitter = colorVariation(y, x, z, block) * 8;
        const r = Math.max(0, Math.min(255, Math.round(rBase + jitter)));
        const g = Math.max(0, Math.min(255, Math.round(gBase + jitter * 0.6)));
        const blue = Math.max(0, Math.min(255, Math.round(bBase + jitter * 0.4)));

        const x0 = x + 0.12;
        const x1 = x + 0.88;
        const y0 = y;
        const y1 = y + 0.9;
        const z0 = z + 0.12;
        const z1 = z + 0.88;

        pushSpriteQuad(
          positions,
          normals,
          colors,
          indices,
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
          r,
          g,
          blue
        );
        pushSpriteQuad(
          positions,
          normals,
          colors,
          indices,
          [x1, y0, z0],
          [x1, y1, z0],
          [x0, y1, z1],
          [x0, y0, z1],
          r,
          g,
          blue
        );
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Int8Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    quadCount: indices.length / 6
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function waterDepthAt(blocks: Uint16Array, x: number, y: number, z: number): number {
  let depth = 0;
  for (let yy = y; yy >= 0; yy--) {
    if (!isWater(getBlockAt(blocks, x, yy, z))) {
      break;
    }
    depth++;
  }
  return depth;
}

function cornerWaterHeight(blocks: Uint16Array, gx: number, y: number, gz: number): number {
  let sum = 0;
  let count = 0;

  for (let dz = -1; dz <= 0; dz++) {
    for (let dx = -1; dx <= 0; dx++) {
      const sx = gx + dx;
      const sz = gz + dz;
      if (isWater(getBlockAt(blocks, sx, y + 1, sz))) {
        return 1;
      }
      if (isWater(getBlockAt(blocks, sx, y, sz))) {
        sum += 1.0;
        count++;
      }
    }
  }

  if (count === 0) {
    return 0;
  }
  return sum / count;
}

function cornerWaterDepth(blocks: Uint16Array, gx: number, y: number, gz: number): number {
  let sum = 0;
  let count = 0;

  for (let dz = -1; dz <= 0; dz++) {
    for (let dx = -1; dx <= 0; dx++) {
      const sx = gx + dx;
      const sz = gz + dz;
      if (!isWater(getBlockAt(blocks, sx, y, sz)) && !isWater(getBlockAt(blocks, sx, y + 1, sz))) {
        continue;
      }
      sum += waterDepthAt(blocks, sx, y, sz);
      count++;
    }
  }

  if (count === 0) {
    return 0;
  }
  return sum / count;
}

function waterVertexColor(depth: number, brightness: number): [number, number, number] {
  const t = clamp01(depth / 8);
  const rBase = lerp(138, 52, t);
  const gBase = lerp(202, 116, t);
  const bBase = lerp(248, 176, t);
  const r = Math.max(0, Math.min(255, Math.round(rBase * brightness)));
  const g = Math.max(0, Math.min(255, Math.round(gBase * brightness)));
  const b = Math.max(0, Math.min(255, Math.round(bBase * brightness)));
  return [r, g, b];
}

function pushWaterQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  verts: Array<[number, number, number]>,
  nx: number,
  ny: number,
  nz: number,
  depths: [number, number, number, number]
): void {
  const baseIndex = positions.length / 3;
  const brightness = normalBrightness(nx, ny, nz);

  for (let i = 0; i < 4; i++) {
    const [x, y, z] = verts[i];
    const [r, g, b] = waterVertexColor(depths[i], brightness);
    positions.push(x, y, z);
    normals.push(nx * 127, ny * 127, nz * 127);
    colors.push(r, g, b);
  }

  indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function buildWaterSurfaceMesh(blocks: Uint16Array): ChunkMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const topDrop = WATER_SURFACE_DROP;
  const sideFloorInset = 0.02;

  for (let y = 0; y < CHUNK_SIZE_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        if (!isWater(getBlockAt(blocks, x, y, z))) {
          continue;
        }
        if (isWater(getBlockAt(blocks, x, y + 1, z))) {
          continue;
        }

        const h00 = cornerWaterHeight(blocks, x, y, z);
        const h01 = cornerWaterHeight(blocks, x, y, z + 1);
        const h11 = cornerWaterHeight(blocks, x + 1, y, z + 1);
        const h10 = cornerWaterHeight(blocks, x + 1, y, z);
        if (h00 <= 0 && h01 <= 0 && h11 <= 0 && h10 <= 0) {
          continue;
        }

        const d00 = cornerWaterDepth(blocks, x, y, z);
        const d01 = cornerWaterDepth(blocks, x, y, z + 1);
        const d11 = cornerWaterDepth(blocks, x + 1, y, z + 1);
        const d10 = cornerWaterDepth(blocks, x + 1, y, z);
        const topDepth = 2.4;

        const y00 = y + Math.max(sideFloorInset, h00 - topDrop);
        const y01 = y + Math.max(sideFloorInset, h01 - topDrop);
        const y11 = y + Math.max(sideFloorInset, h11 - topDrop);
        const y10 = y + Math.max(sideFloorInset, h10 - topDrop);

        pushWaterQuad(
          positions,
          normals,
          colors,
          indices,
          [
            [x, y00, z],
            [x, y01, z + 1],
            [x + 1, y11, z + 1],
            [x + 1, y10, z]
          ],
          0,
          1,
          0,
          [topDepth, topDepth, topDepth, topDepth]
        );

        const westNeighbor = getBlockAt(blocks, x - 1, y, z);
        if (!isWater(westNeighbor) && !isSolid(westNeighbor)) {
          pushWaterQuad(
            positions,
            normals,
            colors,
            indices,
            [
              [x, y, z],
              [x, y, z + 1],
              [x, y01, z + 1],
              [x, y00, z]
            ],
            -1,
            0,
            0,
            [d00, d01, d01, d00]
          );
        }

        const eastNeighbor = getBlockAt(blocks, x + 1, y, z);
        if (!isWater(eastNeighbor) && !isSolid(eastNeighbor)) {
          pushWaterQuad(
            positions,
            normals,
            colors,
            indices,
            [
              [x + 1, y, z],
              [x + 1, y10, z],
              [x + 1, y11, z + 1],
              [x + 1, y, z + 1]
            ],
            1,
            0,
            0,
            [d10, d10, d11, d11]
          );
        }

        const northNeighbor = getBlockAt(blocks, x, y, z - 1);
        if (!isWater(northNeighbor) && !isSolid(northNeighbor)) {
          pushWaterQuad(
            positions,
            normals,
            colors,
            indices,
            [
              [x, y, z],
              [x, y00, z],
              [x + 1, y10, z],
              [x + 1, y, z]
            ],
            0,
            0,
            -1,
            [d00, d00, d10, d10]
          );
        }

        const southNeighbor = getBlockAt(blocks, x, y, z + 1);
        if (!isWater(southNeighbor) && !isSolid(southNeighbor)) {
          pushWaterQuad(
            positions,
            normals,
            colors,
            indices,
            [
              [x, y, z + 1],
              [x + 1, y, z + 1],
              [x + 1, y11, z + 1],
              [x, y01, z + 1]
            ],
            0,
            0,
            1,
            [d01, d11, d11, d01]
          );
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Int8Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    quadCount: indices.length / 6
  };
}

export function buildChunkMeshes(blocks: Uint16Array): ChunkMeshBundle {
  return {
    solid: buildGreedyMeshWithRules(blocks, (block) => isSolid(block), (neighbor) => isSolid(neighbor)),
    water: buildWaterSurfaceMesh(blocks),
    lava: buildGreedyMeshWithRules(
      blocks,
      (block) => isLava(block),
      (neighbor) => isLava(neighbor) || isSolid(neighbor)
    ),
    flora: buildFloraMesh(blocks)
  };
}
