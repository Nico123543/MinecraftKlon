import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, CHUNK_VOLUME } from '../game/constants';

export type ChunkKey = `${number},${number}`;

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export interface LocalCoord {
  lx: number;
  ly: number;
  lz: number;
}

export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: ChunkKey): ChunkCoord {
  const [cxStr, czStr] = key.split(',');
  return { cx: Number(cxStr), cz: Number(czStr) };
}

export function floorDiv(n: number, d: number): number {
  return Math.floor(n / d);
}

export function mod(n: number, d: number): number {
  return ((n % d) + d) % d;
}

export function worldToChunkCoord(wx: number, wz: number): { cx: number; cz: number; lx: number; lz: number } {
  const vx = Math.floor(wx);
  const vz = Math.floor(wz);
  const cx = floorDiv(vx, CHUNK_SIZE_X);
  const cz = floorDiv(vz, CHUNK_SIZE_Z);
  return {
    cx,
    cz,
    lx: mod(vx, CHUNK_SIZE_X),
    lz: mod(vz, CHUNK_SIZE_Z)
  };
}

export function localToWorld(cx: number, cz: number, lx: number, ly: number, lz: number): { wx: number; wy: number; wz: number } {
  return {
    wx: cx * CHUNK_SIZE_X + lx,
    wy: ly,
    wz: cz * CHUNK_SIZE_Z + lz
  };
}

export function linearIndex(lx: number, ly: number, lz: number): number {
  return ly * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
}

export function indexToLocal(index: number): LocalCoord {
  if (index < 0 || index >= CHUNK_VOLUME) {
    throw new Error(`index out of range: ${index}`);
  }
  const layerSize = CHUNK_SIZE_X * CHUNK_SIZE_Z;
  const ly = Math.floor(index / layerSize);
  const rest = index % layerSize;
  const lz = Math.floor(rest / CHUNK_SIZE_X);
  const lx = rest % CHUNK_SIZE_X;
  return { lx, ly, lz };
}

export function isInsideLocal(lx: number, ly: number, lz: number): boolean {
  return lx >= 0 && lx < CHUNK_SIZE_X && ly >= 0 && ly < CHUNK_SIZE_Y && lz >= 0 && lz < CHUNK_SIZE_Z;
}

export function affectedChunkKeysForLocalEdit(cx: number, cz: number, lx: number, lz: number): ChunkKey[] {
  const keys = new Set<ChunkKey>([chunkKey(cx, cz)]);
  if (lx === 0) keys.add(chunkKey(cx - 1, cz));
  if (lx === CHUNK_SIZE_X - 1) keys.add(chunkKey(cx + 1, cz));
  if (lz === 0) keys.add(chunkKey(cx, cz - 1));
  if (lz === CHUNK_SIZE_Z - 1) keys.add(chunkKey(cx, cz + 1));
  return [...keys];
}
