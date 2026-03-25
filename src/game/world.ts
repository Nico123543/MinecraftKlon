import * as THREE from 'three';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  LOAD_RADIUS,
  MAX_NEW_CHUNK_REQUESTS_PER_TICK,
  MESH_UPLOADS_PER_FRAME
} from './constants';
import { WorldPersistence } from './persistence';
import { type MeshResult, WorldWorkerPool } from './workerPool';
import { BlockId, isSolid } from '../shared/blocks';
import { affectedChunkKeysForLocalEdit, chunkKey, linearIndex, type ChunkKey, worldToChunkCoord } from '../shared/chunkMath';

interface ChunkRuntime {
  key: ChunkKey;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  solidMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null;
  waterSurfaceMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> | null;
  lavaMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> | null;
  floraMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null;
  modified: boolean;
  needsRemesh: boolean;
  quadCount: number;
  waterSurfaceQuadCenters: Float32Array | null;
  lavaQuadCenters: Float32Array | null;
}

interface WantedChunk {
  cx: number;
  cz: number;
  key: ChunkKey;
  d2: number;
}

interface WaterVisualPreset {
  name: string;
  opacity: number;
  color: number;
  emissive: number;
  emissiveBase: number;
  emissivePulse: number;
  shininess: number;
  specular: number;
}

const WATER_VISUAL_PRESETS: WaterVisualPreset[] = [
  {
    name: 'Classic Blue',
    opacity: 0.72,
    color: 0x8ec8ff,
    emissive: 0x12365e,
    emissiveBase: 0.26,
    emissivePulse: 0.05,
    shininess: 88,
    specular: 0xd9f2ff
  },
  {
    name: 'Calm Lagoon',
    opacity: 0.66,
    color: 0x9edfff,
    emissive: 0x184d66,
    emissiveBase: 0.2,
    emissivePulse: 0.04,
    shininess: 72,
    specular: 0xe9fbff
  },
  {
    name: 'Deep Ocean',
    opacity: 0.78,
    color: 0x74b0ee,
    emissive: 0x0d2b4a,
    emissiveBase: 0.3,
    emissivePulse: 0.06,
    shininess: 98,
    specular: 0xc6e7ff
  }
];

export interface WorldRuntimeStats {
  loadedChunks: number;
  pendingGenerate: number;
  pendingMesh: number;
  uploadedQuads: number;
}

export class VoxelWorld {
  readonly stats: WorldRuntimeStats = {
    loadedChunks: 0,
    pendingGenerate: 0,
    pendingMesh: 0,
    uploadedQuads: 0
  };

  private readonly scene: THREE.Scene;
  private readonly seed: number;
  private readonly pool: WorldWorkerPool;
  private readonly persistence = new WorldPersistence();

  private readonly chunks = new Map<ChunkKey, ChunkRuntime>();
  private readonly pendingGenerate = new Set<ChunkKey>();
  private readonly pendingMesh = new Set<ChunkKey>();
  private readonly pendingSavedLoads = new Set<ChunkKey>();
  private readonly meshUploadQueue: MeshResult[] = [];
  private readonly dirtyChunkKeys = new Set<ChunkKey>();
  private readonly persistedKeys = new Set<ChunkKey>();
  private readonly pendingFaceSortChunks = new Set<ChunkKey>();

  private readonly frustum = new THREE.Frustum();
  private readonly projScreenMatrix = new THREE.Matrix4();
  private readonly worldSphere = new THREE.Sphere();

  private readonly solidMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.FrontSide
  });
  private waterPresetIndex = 0;
  private readonly waterMaterial = createWaterMaterial(WATER_VISUAL_PRESETS[0]);
  private readonly lavaMaterial = createLavaMaterial();
  private readonly floraMaterial = createFloraMaterial();
  private waterEnabled = true;
  private waterTransparencyEnabled = true;
  private waterShineEnabled = true;
  private waterPulseEnabled = true;
  private waterSurfaceLayerEnabled = true;
  private waterSortingEnabled = false;
  private waterDepthWriteEnabled = true;
  private lastTransparencySortX = Number.NaN;
  private lastTransparencySortY = Number.NaN;
  private lastTransparencySortZ = Number.NaN;
  private lastTransparencyChunkX = Number.NaN;
  private lastTransparencyChunkZ = Number.NaN;

  readonly loadRadius = LOAD_RADIUS;
  readonly unloadRadius = LOAD_RADIUS + 2;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.seed = seed;

    const hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const workerCount = Math.max(1, Math.min(6, hw - 2));
    this.pool = new WorldWorkerPool(workerCount);
  }

  async init(): Promise<void> {
    await this.persistence.init();
    const persisted = await this.persistence.getModifiedChunkKeys(this.seed);
    persisted.forEach((key) => this.persistedKeys.add(key));
  }

  async dispose(): Promise<void> {
    await this.flushDirtyChunks();

    for (const chunk of this.chunks.values()) {
      this.disposeChunkMeshes(chunk);
    }
    this.chunks.clear();

    this.pool.dispose();
    this.solidMaterial.dispose();
    this.waterMaterial.dispose();
    this.lavaMaterial.dispose();
    this.floraMaterial.dispose();
  }

  update(playerPosition: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    const center = worldToChunkCoord(playerPosition.x, playerPosition.z);
    this.ensureChunkSet(center.cx, center.cz);
    this.unloadFarChunks(center.cx, center.cz);
    this.applyMeshUploads();
    this.updateVisibility(playerPosition, camera);
    this.animateWaterMaterial();
    this.sortTransparentMeshesIfNeeded(playerPosition, camera.position);

    this.stats.loadedChunks = this.chunks.size;
    this.stats.pendingGenerate = this.pendingGenerate.size + this.pendingSavedLoads.size;
    this.stats.pendingMesh = this.pendingMesh.size;
  }

  getBlock(wx: number, wy: number, wz: number): BlockId {
    const y = Math.floor(wy);
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return BlockId.Air;
    }

    const { cx, cz, lx, lz } = worldToChunkCoord(wx, wz);
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      return BlockId.Air;
    }

    return chunk.blocks[linearIndex(lx, y, lz)] as BlockId;
  }

  hasSolidBlock(wx: number, wy: number, wz: number): boolean {
    return isSolid(this.getBlock(wx, wy, wz));
  }

  isChunkLoadedAtWorld(wx: number, wz: number): boolean {
    const { cx, cz } = worldToChunkCoord(wx, wz);
    return this.chunks.has(chunkKey(cx, cz));
  }

  isWaterEnabled(): boolean {
    return this.waterEnabled;
  }

  setWaterEnabled(enabled: boolean): void {
    this.waterEnabled = enabled;
    for (const chunk of this.chunks.values()) {
      if (chunk.waterSurfaceMesh) {
        chunk.waterSurfaceMesh.visible = enabled && this.waterSurfaceLayerEnabled;
      }
    }
  }

  setWaterSurfaceLayerEnabled(enabled: boolean): void {
    this.waterSurfaceLayerEnabled = enabled;
    for (const chunk of this.chunks.values()) {
      if (chunk.waterSurfaceMesh) {
        chunk.waterSurfaceMesh.visible = this.waterEnabled && enabled;
      }
    }
  }

  setWaterTransparencyEnabled(enabled: boolean): void {
    this.waterTransparencyEnabled = enabled;
    this.applyWaterMaterialState();
  }

  setWaterShineEnabled(enabled: boolean): void {
    this.waterShineEnabled = enabled;
    this.applyWaterMaterialState();
  }

  setWaterPulseEnabled(enabled: boolean): void {
    this.waterPulseEnabled = enabled;
    this.applyWaterMaterialState();
  }

  setWaterSortingEnabled(enabled: boolean): void {
    this.waterSortingEnabled = enabled;
    if (enabled) {
      for (const chunk of this.chunks.values()) {
        if (chunk.waterSurfaceMesh) {
          this.pendingFaceSortChunks.add(chunk.key);
        }
      }
    }
  }

  setWaterDepthWriteEnabled(enabled: boolean): void {
    this.waterDepthWriteEnabled = enabled;
    this.applyWaterMaterialState();
  }

  getWaterStyleName(): string {
    return WATER_VISUAL_PRESETS[this.waterPresetIndex].name;
  }

  cycleWaterStyle(): string {
    const next = (this.waterPresetIndex + 1) % WATER_VISUAL_PRESETS.length;
    this.applyWaterStyle(next);
    return this.getWaterStyleName();
  }

  setBlock(wx: number, wy: number, wz: number, block: BlockId): boolean {
    const y = Math.floor(wy);
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return false;
    }

    const { cx, cz, lx, lz } = worldToChunkCoord(wx, wz);
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      return false;
    }

    const index = linearIndex(lx, y, lz);
    const current = chunk.blocks[index] as BlockId;
    if (current === block) {
      return false;
    }

    chunk.blocks[index] = block;
    chunk.modified = true;
    this.dirtyChunkKeys.add(key);

    for (const affectedKey of affectedChunkKeysForLocalEdit(cx, cz, lx, lz)) {
      const affected = this.chunks.get(affectedKey);
      if (!affected) {
        continue;
      }
      this.requestMesh(affected);
    }

    return true;
  }

  async flushDirtyChunks(maxCount = Number.POSITIVE_INFINITY): Promise<void> {
    const keys = [...this.dirtyChunkKeys];
    let saved = 0;

    for (const key of keys) {
      if (saved >= maxCount) {
        break;
      }

      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.modified) {
        this.dirtyChunkKeys.delete(key);
        continue;
      }

      await this.persistence.saveChunk(this.seed, key, chunk.blocks);
      this.persistedKeys.add(key);
      this.dirtyChunkKeys.delete(key);
      saved++;
    }
  }

  private ensureChunkSet(centerCx: number, centerCz: number): void {
    const wanted = this.collectWantedChunks(centerCx, centerCz);

    let createdThisTick = 0;
    for (const item of wanted) {
      if (createdThisTick >= MAX_NEW_CHUNK_REQUESTS_PER_TICK) {
        break;
      }
      if (this.chunks.has(item.key) || this.pendingGenerate.has(item.key) || this.pendingSavedLoads.has(item.key)) {
        continue;
      }

      createdThisTick++;
      if (this.persistedKeys.has(item.key)) {
        this.loadSavedChunk(item.cx, item.cz, item.key);
      } else {
        this.generateChunk(item.cx, item.cz, item.key);
      }
    }
  }

  private collectWantedChunks(centerCx: number, centerCz: number): WantedChunk[] {
    const wanted: WantedChunk[] = [];

    for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
      for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > this.loadRadius * this.loadRadius) {
          continue;
        }

        const cx = centerCx + dx;
        const cz = centerCz + dz;
        wanted.push({ cx, cz, key: chunkKey(cx, cz), d2 });
      }
    }

    wanted.sort((a, b) => a.d2 - b.d2);
    return wanted;
  }

  private loadSavedChunk(cx: number, cz: number, key: ChunkKey): void {
    this.pendingSavedLoads.add(key);

    void this.persistence
      .loadChunk(this.seed, key)
      .then((blocks) => {
        if (!blocks) {
          this.persistedKeys.delete(key);
          this.generateChunk(cx, cz, key);
          return;
        }

        const chunk: ChunkRuntime = {
          key,
          cx,
          cz,
          blocks,
          solidMesh: null,
          waterSurfaceMesh: null,
          lavaMesh: null,
          floraMesh: null,
          modified: true,
          needsRemesh: false,
          quadCount: 0,
          waterSurfaceQuadCenters: null,
          lavaQuadCenters: null
        };
        this.chunks.set(key, chunk);
        this.requestMesh(chunk);
      })
      .catch((error) => {
        console.error('Failed to load saved chunk', key, error);
      })
      .finally(() => {
        this.pendingSavedLoads.delete(key);
      });
  }

  private generateChunk(cx: number, cz: number, key: ChunkKey): void {
    this.pendingGenerate.add(key);

    void this.pool
      .generateChunk(key, cx, cz, this.seed)
      .then((result) => {
        if (this.chunks.has(result.key)) {
          return;
        }

        const chunk: ChunkRuntime = {
          key: result.key,
          cx,
          cz,
          blocks: result.blocks,
          solidMesh: null,
          waterSurfaceMesh: null,
          lavaMesh: null,
          floraMesh: null,
          modified: false,
          needsRemesh: false,
          quadCount: 0,
          waterSurfaceQuadCenters: null,
          lavaQuadCenters: null
        };

        this.chunks.set(result.key, chunk);
        this.requestMesh(chunk);
      })
      .catch((error) => {
        console.error('Chunk generation failed', key, error);
      })
      .finally(() => {
        this.pendingGenerate.delete(key);
      });
  }

  private requestMesh(chunk: ChunkRuntime): void {
    if (this.pendingMesh.has(chunk.key)) {
      chunk.needsRemesh = true;
      return;
    }

    this.pendingMesh.add(chunk.key);

    void this.pool
      .meshChunk(chunk.key, chunk.blocks)
      .then((result) => {
        this.meshUploadQueue.push(result);
      })
      .catch((error) => {
        console.error('Chunk meshing failed', chunk.key, error);
      })
      .finally(() => {
        this.pendingMesh.delete(chunk.key);
        const latest = this.chunks.get(chunk.key);
        if (latest?.needsRemesh) {
          latest.needsRemesh = false;
          this.requestMesh(latest);
        }
      });
  }

  private applyMeshUploads(): void {
    let budget = MESH_UPLOADS_PER_FRAME;

    while (budget > 0 && this.meshUploadQueue.length > 0) {
      const result = this.meshUploadQueue.shift();
      if (!result) {
        return;
      }

      const chunk = this.chunks.get(result.key);
      if (!chunk) {
        continue;
      }

      this.applyMeshToChunk(chunk, result);
      budget--;
    }
  }

  private applyMeshToChunk(chunk: ChunkRuntime, result: MeshResult): void {
    chunk.quadCount =
      result.solid.quadCount +
      result.water.quadCount +
      result.lava.quadCount +
      result.flora.quadCount;

    this.applyLayerMesh(
      chunk,
      'solid',
      result.solid.positions,
      result.solid.normals,
      result.solid.colors,
      result.solid.indices
    );
    this.applyLayerMesh(
      chunk,
      'waterSurface',
      result.water.positions,
      result.water.normals,
      result.water.colors,
      result.water.indices
    );
    this.applyLayerMesh(
      chunk,
      'lava',
      result.lava.positions,
      result.lava.normals,
      result.lava.colors,
      result.lava.indices
    );
    this.applyLayerMesh(
      chunk,
      'flora',
      result.flora.positions,
      result.flora.normals,
      result.flora.colors,
      result.flora.indices
    );

    if (result.lava.quadCount > 0 || (this.waterSortingEnabled && result.water.quadCount > 0)) {
      this.pendingFaceSortChunks.add(chunk.key);
    }

    this.stats.uploadedQuads += chunk.quadCount;
  }

  private unloadFarChunks(centerCx: number, centerCz: number): void {
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - centerCx;
      const dz = chunk.cz - centerCz;
      if (dx * dx + dz * dz <= this.unloadRadius * this.unloadRadius) {
        continue;
      }

      if (chunk.modified && this.dirtyChunkKeys.has(chunk.key)) {
        void this.persistence
          .saveChunk(this.seed, chunk.key, chunk.blocks)
          .then(() => this.persistedKeys.add(chunk.key))
          .catch((error) => console.error('Failed to save chunk on unload', chunk.key, error));
        this.dirtyChunkKeys.delete(chunk.key);
      }

      this.disposeChunkMeshes(chunk);
      this.chunks.delete(chunk.key);
      this.pendingFaceSortChunks.delete(chunk.key);
    }
  }

  private updateVisibility(playerPosition: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const maxDistance = (this.loadRadius + 1) * CHUNK_SIZE_X;
    const maxDistanceSq = maxDistance * maxDistance;

    for (const chunk of this.chunks.values()) {
      if (!chunk.solidMesh && !chunk.waterSurfaceMesh && !chunk.lavaMesh && !chunk.floraMesh) {
        continue;
      }

      const cx = chunk.cx * CHUNK_SIZE_X + CHUNK_SIZE_X * 0.5;
      const cz = chunk.cz * CHUNK_SIZE_Z + CHUNK_SIZE_Z * 0.5;
      const dx = cx - playerPosition.x;
      const dz = cz - playerPosition.z;
      const distSq = dx * dx + dz * dz;

      if (distSq > maxDistanceSq) {
        if (chunk.solidMesh) chunk.solidMesh.visible = false;
        if (chunk.waterSurfaceMesh) chunk.waterSurfaceMesh.visible = false;
        if (chunk.lavaMesh) chunk.lavaMesh.visible = false;
        if (chunk.floraMesh) chunk.floraMesh.visible = false;
        continue;
      }

      if (chunk.solidMesh) {
        chunk.solidMesh.visible = this.isMeshVisible(chunk.solidMesh);
      }
      if (chunk.waterSurfaceMesh) {
        chunk.waterSurfaceMesh.visible = this.waterEnabled && this.waterSurfaceLayerEnabled && this.isMeshVisible(chunk.waterSurfaceMesh);
      }
      if (chunk.lavaMesh) {
        chunk.lavaMesh.visible = this.isMeshVisible(chunk.lavaMesh);
      }
      if (chunk.floraMesh) {
        chunk.floraMesh.visible = this.isMeshVisible(chunk.floraMesh);
      }
    }
  }

  private applyLayerMesh(
    chunk: ChunkRuntime,
    layer: 'solid' | 'waterSurface' | 'lava' | 'flora',
    positions: Float32Array,
    normals: Int8Array,
    colors: Uint8Array,
    indices: Uint32Array
  ): void {
    const existing =
      layer === 'solid'
        ? chunk.solidMesh
        : layer === 'waterSurface'
          ? chunk.waterSurfaceMesh
          : layer === 'lava'
            ? chunk.lavaMesh
            : chunk.floraMesh;

    if (indices.length === 0) {
      if (!existing) {
        return;
      }
      this.scene.remove(existing);
      existing.geometry.dispose();
      if (layer === 'solid') {
        chunk.solidMesh = null;
      } else if (layer === 'waterSurface') {
        chunk.waterSurfaceMesh = null;
        chunk.waterSurfaceQuadCenters = null;
      } else if (layer === 'lava') {
        chunk.lavaMesh = null;
        chunk.lavaQuadCenters = null;
      } else {
        chunk.floraMesh = null;
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Int8BufferAttribute(normals, 3, true));
    geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 3, true));
    if (layer === 'waterSurface') {
      chunk.waterSurfaceQuadCenters = computeQuadCenters(positions);
    } else if (layer === 'lava') {
      chunk.lavaQuadCenters = computeQuadCenters(positions);
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    if (!existing) {
      if (layer === 'solid') {
        const mesh = new THREE.Mesh(geometry, this.solidMaterial);
        mesh.position.set(chunk.cx * CHUNK_SIZE_X, 0, chunk.cz * CHUNK_SIZE_Z);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        chunk.solidMesh = mesh;
        this.scene.add(mesh);
      } else if (layer === 'waterSurface') {
        const mesh = new THREE.Mesh(geometry, this.waterMaterial);
        mesh.position.set(chunk.cx * CHUNK_SIZE_X, 0, chunk.cz * CHUNK_SIZE_Z);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 2000;
        mesh.visible = this.waterEnabled && this.waterSurfaceLayerEnabled;
        chunk.waterSurfaceMesh = mesh;
        this.scene.add(mesh);
      } else if (layer === 'lava') {
        const mesh = new THREE.Mesh(geometry, this.lavaMaterial);
        mesh.position.set(chunk.cx * CHUNK_SIZE_X, 0, chunk.cz * CHUNK_SIZE_Z);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 2100;
        chunk.lavaMesh = mesh;
        this.scene.add(mesh);
      } else {
        const mesh = new THREE.Mesh(geometry, this.floraMaterial);
        mesh.position.set(chunk.cx * CHUNK_SIZE_X, 0, chunk.cz * CHUNK_SIZE_Z);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 1;
        chunk.floraMesh = mesh;
        this.scene.add(mesh);
      }
      return;
    }

    existing.geometry.dispose();
    existing.geometry = geometry;
  }

  private isMeshVisible(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>): boolean {
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) {
      return true;
    }
    this.worldSphere.copy(sphere);
    this.worldSphere.center.add(mesh.position);
    return this.frustum.intersectsSphere(this.worldSphere);
  }

  private disposeChunkMeshes(chunk: ChunkRuntime): void {
    if (chunk.solidMesh) {
      this.scene.remove(chunk.solidMesh);
      chunk.solidMesh.geometry.dispose();
      chunk.solidMesh = null;
    }
    if (chunk.waterSurfaceMesh) {
      this.scene.remove(chunk.waterSurfaceMesh);
      chunk.waterSurfaceMesh.geometry.dispose();
      chunk.waterSurfaceMesh = null;
    }
    chunk.waterSurfaceQuadCenters = null;
    if (chunk.lavaMesh) {
      this.scene.remove(chunk.lavaMesh);
      chunk.lavaMesh.geometry.dispose();
      chunk.lavaMesh = null;
    }
    chunk.lavaQuadCenters = null;
    if (chunk.floraMesh) {
      this.scene.remove(chunk.floraMesh);
      chunk.floraMesh.geometry.dispose();
      chunk.floraMesh = null;
    }
  }

  private applyWaterStyle(index: number): void {
    this.waterPresetIndex = Math.max(0, Math.min(WATER_VISUAL_PRESETS.length - 1, index));
    this.applyWaterMaterialState();
  }

  private animateWaterMaterial(): void {
    const t = performance.now() * 0.001;
    const preset = WATER_VISUAL_PRESETS[this.waterPresetIndex];
    this.waterMaterial.emissiveIntensity = this.waterPulseEnabled
      ? preset.emissiveBase + Math.sin(t * 1.7) * preset.emissivePulse
      : preset.emissiveBase;
    this.lavaMaterial.emissiveIntensity = 0.44 + Math.sin(t * 2.8) * 0.09;
  }

  private sortTransparentMeshesIfNeeded(playerPosition: THREE.Vector3, cameraPosition: THREE.Vector3): void {
    const blockX = Math.floor(playerPosition.x);
    const blockY = Math.floor(playerPosition.y);
    const blockZ = Math.floor(playerPosition.z);
    const playerChunk = worldToChunkCoord(playerPosition.x, playerPosition.z);

    const movedBlock =
      blockX !== this.lastTransparencySortX || blockY !== this.lastTransparencySortY || blockZ !== this.lastTransparencySortZ;
    const movedChunk = playerChunk.cx !== this.lastTransparencyChunkX || playerChunk.cz !== this.lastTransparencyChunkZ;

    if (movedBlock) {
      this.lastTransparencySortX = blockX;
      this.lastTransparencySortY = blockY;
      this.lastTransparencySortZ = blockZ;
      this.pendingFaceSortChunks.add(chunkKey(playerChunk.cx, playerChunk.cz));
    }

    if (movedChunk) {
      this.lastTransparencyChunkX = playerChunk.cx;
      this.lastTransparencyChunkZ = playerChunk.cz;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          this.pendingFaceSortChunks.add(chunkKey(playerChunk.cx + dx, playerChunk.cz + dz));
        }
      }
    }

    if (movedBlock || movedChunk) {
      const entries: Array<{ distSq: number; chunk: ChunkRuntime }> = [];
      for (const chunk of this.chunks.values()) {
        if (!chunk.waterSurfaceMesh && !chunk.lavaMesh) continue;
        const cx = chunk.cx * CHUNK_SIZE_X + CHUNK_SIZE_X * 0.5;
        const cz = chunk.cz * CHUNK_SIZE_Z + CHUNK_SIZE_Z * 0.5;
        const dx = cx - cameraPosition.x;
        const dz = cz - cameraPosition.z;
        entries.push({ distSq: dx * dx + dz * dz, chunk });
      }

      entries.sort((a, b) => b.distSq - a.distSq);
      let order = 2000;
      for (const entry of entries) {
        if (this.waterEnabled && entry.chunk.waterSurfaceMesh) {
          if (this.waterSortingEnabled) {
            entry.chunk.waterSurfaceMesh.renderOrder = order++;
          } else {
            entry.chunk.waterSurfaceMesh.renderOrder = 2000;
          }
        }
        if (entry.chunk.lavaMesh) {
          entry.chunk.lavaMesh.renderOrder = order++;
        }
      }
    }

    if (!this.waterSortingEnabled) {
      for (const chunk of this.chunks.values()) {
        if (chunk.waterSurfaceMesh) {
          chunk.waterSurfaceMesh.renderOrder = 2000;
        }
      }
    }

    this.processTransparentFaceSortQueue(cameraPosition, movedChunk ? 12 : movedBlock ? 6 : 2);
  }

  private processTransparentFaceSortQueue(cameraPosition: THREE.Vector3, budget: number): void {
    if (budget <= 0 || this.pendingFaceSortChunks.size === 0) {
      return;
    }

    const processed: ChunkKey[] = [];
    let count = 0;
    for (const key of this.pendingFaceSortChunks) {
      const chunk = this.chunks.get(key);
      if (chunk) {
        this.sortTransparentFacesInChunk(chunk, cameraPosition);
      }
      processed.push(key);
      count++;
      if (count >= budget) break;
    }

    for (const key of processed) {
      this.pendingFaceSortChunks.delete(key);
    }
  }

  private sortTransparentFacesInChunk(chunk: ChunkRuntime, cameraPosition: THREE.Vector3): void {
    if (this.waterSortingEnabled && this.waterEnabled && chunk.waterSurfaceMesh && chunk.waterSurfaceQuadCenters) {
      sortMeshQuadsBackToFront(chunk.waterSurfaceMesh, chunk.waterSurfaceQuadCenters, cameraPosition);
    }
    if (chunk.lavaMesh && chunk.lavaQuadCenters) {
      sortMeshQuadsBackToFront(chunk.lavaMesh, chunk.lavaQuadCenters, cameraPosition);
    }
  }

  private applyWaterMaterialState(): void {
    const preset = WATER_VISUAL_PRESETS[this.waterPresetIndex];
    this.waterMaterial.color.setHex(preset.color);
    this.waterMaterial.emissive.setHex(preset.emissive);
    this.waterMaterial.transparent = this.waterTransparencyEnabled;
    this.waterMaterial.opacity = this.waterTransparencyEnabled ? preset.opacity : 1;
    this.waterMaterial.depthWrite = this.waterDepthWriteEnabled;
    if (this.waterShineEnabled) {
      this.waterMaterial.shininess = preset.shininess;
      this.waterMaterial.specular.setHex(preset.specular);
    } else {
      this.waterMaterial.shininess = 0;
      this.waterMaterial.specular.setRGB(0, 0, 0);
    }
    if (!this.waterPulseEnabled) {
      this.waterMaterial.emissiveIntensity = preset.emissiveBase;
    }
    this.waterMaterial.needsUpdate = true;
  }
}

function computeQuadCenters(positions: Float32Array): Float32Array {
  const quadCount = Math.floor(positions.length / 12);
  const centers = new Float32Array(quadCount * 3);

  for (let q = 0; q < quadCount; q++) {
    const p = q * 12;
    const cx = (positions[p] + positions[p + 3] + positions[p + 6] + positions[p + 9]) * 0.25;
    const cy = (positions[p + 1] + positions[p + 4] + positions[p + 7] + positions[p + 10]) * 0.25;
    const cz = (positions[p + 2] + positions[p + 5] + positions[p + 8] + positions[p + 11]) * 0.25;
    const c = q * 3;
    centers[c] = cx;
    centers[c + 1] = cy;
    centers[c + 2] = cz;
  }

  return centers;
}

function sortMeshQuadsBackToFront(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
  quadCenters: Float32Array,
  cameraPosition: THREE.Vector3
): void {
  const index = mesh.geometry.getIndex();
  if (!index) {
    return;
  }

  const quadCount = Math.floor(quadCenters.length / 3);
  if (quadCount === 0) {
    return;
  }

  const order = new Array<number>(quadCount);
  for (let i = 0; i < quadCount; i++) {
    order[i] = i;
  }

  const ox = mesh.position.x;
  const oy = mesh.position.y;
  const oz = mesh.position.z;
  order.sort((a, b) => {
    const a3 = a * 3;
    const b3 = b * 3;
    const adx = quadCenters[a3] + ox - cameraPosition.x;
    const ady = quadCenters[a3 + 1] + oy - cameraPosition.y;
    const adz = quadCenters[a3 + 2] + oz - cameraPosition.z;
    const bdx = quadCenters[b3] + ox - cameraPosition.x;
    const bdy = quadCenters[b3 + 1] + oy - cameraPosition.y;
    const bdz = quadCenters[b3 + 2] + oz - cameraPosition.z;
    return bdx * bdx + bdy * bdy + bdz * bdz - (adx * adx + ady * ady + adz * adz);
  });

  const indexArray = index.array as Uint16Array | Uint32Array;
  if (indexArray.length < quadCount * 6) {
    return;
  }

  let write = 0;
  for (let i = 0; i < order.length; i++) {
    const base = order[i] * 4;
    indexArray[write++] = base;
    indexArray[write++] = base + 1;
    indexArray[write++] = base + 2;
    indexArray[write++] = base;
    indexArray[write++] = base + 2;
    indexArray[write++] = base + 3;
  }
  index.needsUpdate = true;
}

function createWaterMaterial(preset: WaterVisualPreset): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    vertexColors: false,
    color: preset.color,
    emissive: preset.emissive,
    emissiveIntensity: preset.emissiveBase,
    transparent: true,
    opacity: preset.opacity,
    shininess: preset.shininess,
    specular: new THREE.Color(preset.specular),
    side: THREE.FrontSide,
    depthWrite: true
  });
}

function createLavaMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    vertexColors: true,
    color: 0xffffff,
    emissive: 0x49150a,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.66,
    shininess: 34,
    specular: new THREE.Color(0xffd9b5),
    side: THREE.FrontSide,
    depthWrite: false
  });
}

function createFloraMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
    depthWrite: true
  });
}
