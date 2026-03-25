export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Wood = 5,
  Leaves = 6,
  Clay = 7,
  Brick = 8,
  Glow = 9,
  Water = 10,
  Gravel = 11,
  CoalOre = 12,
  CopperOre = 13,
  Lava = 14,
  FlowerRed = 15,
  FlowerYellow = 16
}

export const PLACEABLE_BLOCKS: BlockId[] = [
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.Sand,
  BlockId.Wood,
  BlockId.Leaves,
  BlockId.CoalOre,
  BlockId.CopperOre,
  BlockId.Water,
  BlockId.Lava
];

export function isSolid(block: BlockId): boolean {
  return block !== BlockId.Air && !isFluid(block) && !isFlora(block);
}

export function isWater(block: BlockId): boolean {
  return block === BlockId.Water;
}

export function isLava(block: BlockId): boolean {
  return block === BlockId.Lava;
}

export function isFluid(block: BlockId): boolean {
  return block === BlockId.Water || block === BlockId.Lava;
}

export function isFlora(block: BlockId): boolean {
  return block === BlockId.FlowerRed || block === BlockId.FlowerYellow;
}

export function blockColor(block: BlockId): [number, number, number] {
  switch (block) {
    case BlockId.Grass:
      return [113, 184, 92];
    case BlockId.Dirt:
      return [131, 92, 62];
    case BlockId.Stone:
      return [125, 130, 136];
    case BlockId.Sand:
      return [221, 206, 146];
    case BlockId.Wood:
      return [161, 118, 78];
    case BlockId.Leaves:
      return [78, 156, 79];
    case BlockId.Clay:
      return [144, 160, 176];
    case BlockId.Brick:
      return [184, 84, 74];
    case BlockId.Glow:
      return [244, 228, 124];
    case BlockId.Gravel:
      return [139, 145, 151];
    case BlockId.CoalOre:
      return [88, 94, 101];
    case BlockId.CopperOre:
      return [177, 122, 92];
    case BlockId.Water:
      return [64, 146, 222];
    case BlockId.Lava:
      return [236, 104, 38];
    case BlockId.FlowerRed:
      return [216, 66, 78];
    case BlockId.FlowerYellow:
      return [236, 198, 64];
    case BlockId.Air:
    default:
      return [0, 0, 0];
  }
}
