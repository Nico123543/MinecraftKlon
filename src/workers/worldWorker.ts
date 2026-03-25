/// <reference lib="webworker" />
import { generateChunkBlocks } from '../shared/generation';
import { buildChunkMeshes } from '../shared/meshing';
import type { WorkerRequest, WorkerResponse } from '../game/workerProtocol';

function postResponse(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'generateChunk') {
      const blocks = generateChunkBlocks(req.cx, req.cz, req.seed);
      postResponse(
        {
          id: req.id,
          type: 'chunkReady',
          key: req.key,
          blocks: blocks.buffer
        },
        [blocks.buffer]
      );
      return;
    }

    if (req.type === 'meshChunk') {
      const mesh = buildChunkMeshes(req.blocks);
      postResponse(
        {
          id: req.id,
          type: 'meshReady',
          key: req.key,
          solidPositions: mesh.solid.positions.buffer,
          solidNormals: mesh.solid.normals.buffer,
          solidColors: mesh.solid.colors.buffer,
          solidIndices: mesh.solid.indices.buffer,
          solidQuadCount: mesh.solid.quadCount,
          waterSurfacePositions: mesh.water.positions.buffer,
          waterSurfaceNormals: mesh.water.normals.buffer,
          waterSurfaceColors: mesh.water.colors.buffer,
          waterSurfaceIndices: mesh.water.indices.buffer,
          waterSurfaceQuadCount: mesh.water.quadCount,
          lavaPositions: mesh.lava.positions.buffer,
          lavaNormals: mesh.lava.normals.buffer,
          lavaColors: mesh.lava.colors.buffer,
          lavaIndices: mesh.lava.indices.buffer,
          lavaQuadCount: mesh.lava.quadCount,
          floraPositions: mesh.flora.positions.buffer,
          floraNormals: mesh.flora.normals.buffer,
          floraColors: mesh.flora.colors.buffer,
          floraIndices: mesh.flora.indices.buffer,
          floraQuadCount: mesh.flora.quadCount
        },
        [
          mesh.solid.positions.buffer,
          mesh.solid.normals.buffer,
          mesh.solid.colors.buffer,
          mesh.solid.indices.buffer,
          mesh.water.positions.buffer,
          mesh.water.normals.buffer,
          mesh.water.colors.buffer,
          mesh.water.indices.buffer,
          mesh.lava.positions.buffer,
          mesh.lava.normals.buffer,
          mesh.lava.colors.buffer,
          mesh.lava.indices.buffer,
          mesh.flora.positions.buffer,
          mesh.flora.normals.buffer,
          mesh.flora.colors.buffer,
          mesh.flora.indices.buffer
        ]
      );
      return;
    }

    postResponse({
      id: (req as { id: number }).id,
      type: 'workerError',
      message: 'Unknown request type'
    });
  } catch (error) {
    postResponse({
      id: req.id,
      type: 'workerError',
      message: error instanceof Error ? error.message : 'Unknown worker error'
    });
  }
};
