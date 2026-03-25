import type { ChunkKey } from '../shared/chunkMath';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

interface GenerateResult {
  key: ChunkKey;
  blocks: Uint16Array;
}

export interface MeshResult {
  key: ChunkKey;
  solid: {
    positions: Float32Array;
    normals: Int8Array;
    colors: Uint8Array;
    indices: Uint32Array;
    quadCount: number;
  };
  water: {
    positions: Float32Array;
    normals: Int8Array;
    colors: Uint8Array;
    indices: Uint32Array;
    quadCount: number;
  };
  lava: {
    positions: Float32Array;
    normals: Int8Array;
    colors: Uint8Array;
    indices: Uint32Array;
    quadCount: number;
  };
  flora: {
    positions: Float32Array;
    normals: Int8Array;
    colors: Uint8Array;
    indices: Uint32Array;
    quadCount: number;
  };
}

type TaskKind = 'generateChunk' | 'meshChunk';

interface PendingTask<T> {
  id: number;
  kind: TaskKind;
  request: WorkerRequest;
  transfer: Transferable[];
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  currentTaskId: number | null;
}

export class WorldWorkerPool {
  private readonly workers: WorkerSlot[];
  private readonly tasks = new Map<number, PendingTask<unknown>>();
  private readonly meshQueue: PendingTask<unknown>[] = [];
  private readonly generateQueue: PendingTask<unknown>[] = [];
  private nextId = 1;

  constructor(workerCount: number) {
    const count = Math.max(1, workerCount);
    this.workers = Array.from({ length: count }, () => {
      const worker = new Worker(new URL('../workers/worldWorker.ts', import.meta.url), { type: 'module' });
      return { worker, currentTaskId: null };
    });

    for (const slot of this.workers) {
      slot.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.onWorkerMessage(slot, event.data);
      };
      slot.worker.onerror = (event) => {
        const message = event.message || 'Worker runtime error';
        this.failCurrentTask(slot, new Error(message));
      };
    }
  }

  dispose(): void {
    for (const slot of this.workers) {
      slot.worker.terminate();
      slot.currentTaskId = null;
    }

    for (const task of this.tasks.values()) {
      task.reject(new Error('Worker pool disposed'));
    }
    for (const task of this.meshQueue) {
      task.reject(new Error('Worker pool disposed'));
    }
    for (const task of this.generateQueue) {
      task.reject(new Error('Worker pool disposed'));
    }

    this.meshQueue.length = 0;
    this.generateQueue.length = 0;
    this.tasks.clear();
  }

  generateChunk(key: ChunkKey, cx: number, cz: number, seed: number): Promise<GenerateResult> {
    const id = this.nextId++;
    return this.enqueue(
      {
        id,
        kind: 'generateChunk',
        request: { id, type: 'generateChunk', key, cx, cz, seed }
      },
      'generate'
    ) as Promise<GenerateResult>;
  }

  meshChunk(key: ChunkKey, blocks: Uint16Array): Promise<MeshResult> {
    const id = this.nextId++;
    const copy = blocks.slice();
    return this.enqueue(
      {
        id,
        kind: 'meshChunk',
        request: { id, type: 'meshChunk', key, blocks: copy }
      },
      'mesh',
      [copy.buffer]
    ) as Promise<MeshResult>;
  }

  private enqueue(
    base: Omit<PendingTask<unknown>, 'resolve' | 'reject' | 'transfer'>,
    queue: 'mesh' | 'generate',
    transfer: Transferable[] = []
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task: PendingTask<unknown> = {
        ...base,
        transfer,
        resolve,
        reject
      };

      this.tasks.set(task.id, task);
      if (queue === 'mesh') {
        this.meshQueue.push(task);
      } else {
        this.generateQueue.push(task);
      }

      this.dispatch();
    });
  }

  private dispatch(): void {
    for (const slot of this.workers) {
      if (slot.currentTaskId !== null) {
        continue;
      }

      const task = this.meshQueue.shift() ?? this.generateQueue.shift();
      if (!task) {
        return;
      }

      slot.currentTaskId = task.id;
      slot.worker.postMessage(task.request, task.transfer);
    }
  }

  private onWorkerMessage(slot: WorkerSlot, response: WorkerResponse): void {
    const taskId = response.id;
    const task = this.tasks.get(taskId);
    this.tasks.delete(taskId);

    if (!task) {
      slot.currentTaskId = null;
      this.dispatch();
      return;
    }

    if (response.type === 'workerError') {
      task.reject(new Error(response.message));
      slot.currentTaskId = null;
      this.dispatch();
      return;
    }

    try {
      if (task.kind === 'generateChunk' && response.type === 'chunkReady') {
        task.resolve({
          key: response.key,
          blocks: new Uint16Array(response.blocks)
        });
      } else if (task.kind === 'meshChunk' && response.type === 'meshReady') {
        task.resolve({
          key: response.key,
          solid: {
            positions: new Float32Array(response.solidPositions),
            normals: new Int8Array(response.solidNormals),
            colors: new Uint8Array(response.solidColors),
            indices: new Uint32Array(response.solidIndices),
            quadCount: response.solidQuadCount
          },
          water: {
            positions: new Float32Array(response.waterSurfacePositions),
            normals: new Int8Array(response.waterSurfaceNormals),
            colors: new Uint8Array(response.waterSurfaceColors),
            indices: new Uint32Array(response.waterSurfaceIndices),
            quadCount: response.waterSurfaceQuadCount
          },
          lava: {
            positions: new Float32Array(response.lavaPositions),
            normals: new Int8Array(response.lavaNormals),
            colors: new Uint8Array(response.lavaColors),
            indices: new Uint32Array(response.lavaIndices),
            quadCount: response.lavaQuadCount
          },
          flora: {
            positions: new Float32Array(response.floraPositions),
            normals: new Int8Array(response.floraNormals),
            colors: new Uint8Array(response.floraColors),
            indices: new Uint32Array(response.floraIndices),
            quadCount: response.floraQuadCount
          }
        } as MeshResult);
      } else {
        task.reject(new Error('Worker response type mismatch'));
      }
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error('Failed to decode worker response'));
    } finally {
      slot.currentTaskId = null;
      this.dispatch();
    }
  }

  private failCurrentTask(slot: WorkerSlot, error: Error): void {
    const taskId = slot.currentTaskId;
    if (taskId === null) {
      return;
    }

    const task = this.tasks.get(taskId);
    this.tasks.delete(taskId);
    slot.currentTaskId = null;
    if (task) {
      task.reject(error);
    }
    this.dispatch();
  }
}
