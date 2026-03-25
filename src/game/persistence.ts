import { CHUNK_VOLUME, WORLD_FORMAT_VERSION } from './constants';
import type { ChunkKey } from '../shared/chunkMath';
import { decodeRle, encodeRle } from '../shared/rle';

const DB_NAME = `minecraft-klon-db-v${WORLD_FORMAT_VERSION}`;
const DB_VERSION = 1;
const STORE_CHUNKS = 'chunks';

interface ChunkRecord {
  id: string;
  data: ArrayBufferLike;
}

function chunkRecordId(seed: number, key: ChunkKey): string {
  return `${seed}:${key}`;
}

function chunkKeyFromRecordId(seed: number, id: string): ChunkKey | null {
  const prefix = `${seed}:`;
  if (!id.startsWith(prefix)) {
    return null;
  }
  return id.slice(prefix.length) as ChunkKey;
}

export class WorldPersistence {
  private dbPromise: Promise<IDBDatabase> | null = null;

  init(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
            db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
      });
    }

    return this.dbPromise;
  }

  async getModifiedChunkKeys(seed: number): Promise<Set<ChunkKey>> {
    const db = await this.init();
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);

    const lower = `${seed}:`;
    const upper = `${seed}:\uffff`;
    const range = IDBKeyRange.bound(lower, upper);

    const keys = new Set<ChunkKey>();

    await new Promise<void>((resolve, reject) => {
      const cursorRequest = store.openCursor(range);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }

        const value = cursor.value as ChunkRecord;
        const key = chunkKeyFromRecordId(seed, value.id);
        if (key) {
          keys.add(key);
        }
        cursor.continue();
      };

      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to iterate chunk keys'));
    });

    await transactionDone(tx);
    return keys;
  }

  async loadChunk(seed: number, key: ChunkKey): Promise<Uint16Array | null> {
    const db = await this.init();
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);
    const id = chunkRecordId(seed, key);

    const value = await new Promise<ChunkRecord | undefined>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as ChunkRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error('Failed to read chunk from IndexedDB'));
    });

    await transactionDone(tx);

    if (!value) {
      return null;
    }

    const compressed = new Uint16Array(value.data);
    return decodeRle(compressed, CHUNK_VOLUME);
  }

  async saveChunk(seed: number, key: ChunkKey, blocks: Uint16Array): Promise<void> {
    const db = await this.init();
    const compressed = encodeRle(blocks);
    const compressedCopy = new Uint16Array(compressed);
    const record: ChunkRecord = {
      id: chunkRecordId(seed, key),
      data: compressedCopy.buffer
    };

    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);

    await new Promise<void>((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('Failed to save chunk to IndexedDB'));
    });

    await transactionDone(tx);
  }

  async clearSeed(seed: number): Promise<void> {
    const db = await this.init();
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);

    const lower = `${seed}:`;
    const upper = `${seed}:\uffff`;
    const range = IDBKeyRange.bound(lower, upper);

    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to clear seed data'));
    });

    await transactionDone(tx);
  }
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}
