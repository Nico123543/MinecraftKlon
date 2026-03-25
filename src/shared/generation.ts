import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, CHUNK_VOLUME } from '../game/constants';
import { BlockId } from './blocks';
import { linearIndex } from './chunkMath';
import { fbm2D } from './noise';

const SEA_LEVEL = 34;
const COASTLINE_X = 96;
const COAST_TRANSITION = 54;
const LAKE_CENTER_X = 14;
const LAKE_CENTER_Z = -10;
const LAKE_RADIUS = 19;

function hash2DInt(x: number, z: number, seed: number): number {
  let n = x * 374761393 + z * 668265263 + seed * 700001;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 0xffffffff;
}

function hash3DInt(x: number, y: number, z: number, seed: number): number {
  let n = x * 374761393 + y * 1597334677 + z * 668265263 + seed * 700001;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 0xffffffff;
}

function setIfInside(blocks: Uint16Array, lx: number, ly: number, lz: number, block: BlockId): void {
  if (lx < 0 || lx >= CHUNK_SIZE_X || ly < 0 || ly >= CHUNK_SIZE_Y || lz < 0 || lz >= CHUNK_SIZE_Z) {
    return;
  }
  blocks[linearIndex(lx, ly, lz)] = block;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function terrainHeight(wx: number, wz: number, seed: number): number {
  const continental = fbm2D(wx * 0.006, wz * 0.006, seed + 11, 4);
  const detail = fbm2D(wx * 0.03, wz * 0.03, seed + 37, 3);
  const micro = fbm2D(wx * 0.09, wz * 0.09, seed + 73, 2);

  const h = 52 + continental * 20 + detail * 8 + micro * 2;
  return Math.max(6, Math.min(CHUNK_SIZE_Y - 4, Math.floor(h)));
}

export function generateChunkBlocks(cx: number, cz: number, seed: number): Uint16Array {
  const blocks = new Uint16Array(CHUNK_VOLUME);

  for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      const wx = cx * CHUNK_SIZE_X + lx;
      const wz = cz * CHUNK_SIZE_Z + lz;
      let h = terrainHeight(wx, wz, seed);
      const biome = fbm2D(wx * 0.01, wz * 0.01, seed + 181, 2);
      const humidity = fbm2D(wx * 0.012, wz * 0.012, seed + 331, 3);
      const variety = fbm2D(wx * 0.05, wz * 0.05, seed + 913, 2);
      const coastNoise = fbm2D(wx * 0.005, wz * 0.005, seed + 517, 3) * 16;
      const coastX = COASTLINE_X + coastNoise;
      const toSea = clamp01((wx - (coastX - COAST_TRANSITION)) / COAST_TRANSITION);
      const seaShelf = SEA_LEVEL - 8 + Math.floor(fbm2D(wx * 0.022, wz * 0.022, seed + 619, 2) * 4);

      let waterLevel = -1;
      if (toSea > 0.42) {
        waterLevel = SEA_LEVEL;
        h = Math.round(lerp(h, seaShelf, toSea));
      }

      const lakeDist = Math.hypot(wx - LAKE_CENTER_X, wz - LAKE_CENTER_Z);
      const lakeEdge = LAKE_RADIUS + fbm2D(wx * 0.01, wz * 0.01, seed + 401, 2) * 3.2;
      if (lakeDist < lakeEdge) {
        const lakeLevel = SEA_LEVEL - 2;
        waterLevel = Math.max(waterLevel, lakeLevel);
        const lakeFloor = lakeLevel - 4 + Math.floor(fbm2D(wx * 0.03, wz * 0.03, seed + 477, 2) * 2);
        h = Math.min(h, lakeFloor);
      }

      const underwater = waterLevel >= 0 && h < waterLevel;

      let topBlock: BlockId = BlockId.Grass;
      if (underwater) {
        if (variety > 0.35) topBlock = BlockId.Clay;
        else if (variety < -0.3) topBlock = BlockId.Gravel;
        else topBlock = BlockId.Sand;
      } else if (biome > 0.35) {
        topBlock = BlockId.Sand;
      } else if (biome < -0.28) {
        topBlock = BlockId.Clay;
      } else if (humidity < -0.4) {
        topBlock = BlockId.Brick;
      }

      for (let y = 0; y <= h; y++) {
        const index = linearIndex(lx, y, lz);
        if (y === h) {
          blocks[index] = topBlock;
        } else if (y >= h - 3) {
          blocks[index] =
            topBlock === BlockId.Sand || topBlock === BlockId.Gravel
              ? BlockId.Sand
              : topBlock === BlockId.Clay
                ? BlockId.Clay
                : BlockId.Dirt;
        } else {
          blocks[index] = BlockId.Stone;
        }
      }

      if (underwater) {
        for (let y = h + 1; y <= waterLevel; y++) {
          blocks[linearIndex(lx, y, lz)] = BlockId.Water;
        }
      }

      // Ores.
      for (let y = 4; y < h - 3; y++) {
        const idx = linearIndex(lx, y, lz);
        if (blocks[idx] !== BlockId.Stone) {
          continue;
        }

        const oreChance = hash3DInt(wx, y, wz, seed + 1511);
        const depth = 1 - y / Math.max(1, h);
        if (oreChance > 0.992 - depth * 0.01) {
          blocks[idx] = BlockId.CoalOre;
        } else if (oreChance > 0.986 - depth * 0.006 && y < 56) {
          blocks[idx] = BlockId.CopperOre;
        }
      }

      // Stylized vegetation.
      if (!underwater && humidity > 0.45 && h + 5 < CHUNK_SIZE_Y) {
        const treeChance = hash2DInt(wx, wz, seed + 1171);
        if (treeChance > 0.994 && topBlock === BlockId.Grass) {
          const trunkHeight = 3 + Math.floor(hash2DInt(wx + 9, wz - 7, seed + 137) * 3);
          for (let t = 1; t <= trunkHeight; t++) {
            setIfInside(blocks, lx, h + t, lz, BlockId.Wood);
          }

          const canopyY = h + trunkHeight;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const dist = Math.abs(dx) + Math.abs(dz);
              if (dist > 3) continue;
              setIfInside(blocks, lx + dx, canopyY, lz + dz, BlockId.Leaves);
              if (dist <= 2) {
                setIfInside(blocks, lx + dx, canopyY + 1, lz + dz, BlockId.Leaves);
              }
            }
          }
        }
      }

      // Flowers.
      if (!underwater && topBlock === BlockId.Grass && h + 1 < CHUNK_SIZE_Y) {
        const flowerChance = hash2DInt(wx, wz, seed + 5003);
        if (flowerChance > 0.974 && flowerChance <= 0.988) {
          setIfInside(blocks, lx, h + 1, lz, BlockId.FlowerRed);
        } else if (flowerChance > 0.988) {
          setIfInside(blocks, lx, h + 1, lz, BlockId.FlowerYellow);
        }
      }

      // Underwater coral accents.
      if (underwater && h + 3 < waterLevel) {
        const coralChance = hash2DInt(wx, wz, seed + 2201);
        if (coralChance > 0.986) {
          const coralHeight = 1 + Math.floor(hash2DInt(wx - 5, wz + 11, seed + 97) * 3);
          for (let c = 1; c <= coralHeight; c++) {
            const block = c === coralHeight && coralChance > 0.995 ? BlockId.Glow : coralChance > 0.992 ? BlockId.Brick : BlockId.Clay;
            setIfInside(blocks, lx, h + c, lz, block);
          }
        }
      }

      // Rare lava vents near lowland.
      if (!underwater && h > 16 && h < 58 && h + 1 < CHUNK_SIZE_Y) {
        const ventChance = hash2DInt(wx, wz, seed + 6101);
        if (ventChance > 0.9983) {
          setIfInside(blocks, lx, h, lz, BlockId.Lava);
          setIfInside(blocks, lx + 1, h, lz, BlockId.Lava);
          setIfInside(blocks, lx - 1, h, lz, BlockId.Lava);
          setIfInside(blocks, lx, h, lz + 1, BlockId.Lava);
          setIfInside(blocks, lx, h, lz - 1, BlockId.Lava);
          setIfInside(blocks, lx, h - 1, lz, BlockId.Stone);
        }
      }
    }
  }

  return blocks;
}
