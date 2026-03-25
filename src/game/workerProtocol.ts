import type { ChunkKey } from '../shared/chunkMath';

export interface GenerateChunkRequest {
  id: number;
  type: 'generateChunk';
  key: ChunkKey;
  cx: number;
  cz: number;
  seed: number;
}

export interface MeshChunkRequest {
  id: number;
  type: 'meshChunk';
  key: ChunkKey;
  blocks: Uint16Array;
}

export type WorkerRequest = GenerateChunkRequest | MeshChunkRequest;

export interface ChunkReadyResponse {
  id: number;
  type: 'chunkReady';
  key: ChunkKey;
  blocks: ArrayBufferLike;
}

export interface MeshReadyResponse {
  id: number;
  type: 'meshReady';
  key: ChunkKey;
  solidPositions: ArrayBufferLike;
  solidNormals: ArrayBufferLike;
  solidColors: ArrayBufferLike;
  solidIndices: ArrayBufferLike;
  solidQuadCount: number;
  waterPositions: ArrayBufferLike;
  waterNormals: ArrayBufferLike;
  waterColors: ArrayBufferLike;
  waterIndices: ArrayBufferLike;
  waterQuadCount: number;
  lavaPositions: ArrayBufferLike;
  lavaNormals: ArrayBufferLike;
  lavaColors: ArrayBufferLike;
  lavaIndices: ArrayBufferLike;
  lavaQuadCount: number;
  floraPositions: ArrayBufferLike;
  floraNormals: ArrayBufferLike;
  floraColors: ArrayBufferLike;
  floraIndices: ArrayBufferLike;
  floraQuadCount: number;
}

export interface WorkerErrorResponse {
  id: number;
  type: 'workerError';
  message: string;
}

export type WorkerResponse = ChunkReadyResponse | MeshReadyResponse | WorkerErrorResponse;
