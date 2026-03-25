import * as THREE from 'three';
import { AUTOSAVE_INTERVAL_MS, FIXED_TICK_SECONDS, RAYCAST_MAX_DISTANCE, WORLD_SEED } from './constants';
import { FishSchool } from './fish';
import { Hud } from './hud';
import { PerfTracker } from './perf';
import { PlayerController } from './player';
import { voxelRaycast } from './raycast';
import { VoxelWorld } from './world';
import { BlockId, isWater, PLACEABLE_BLOCKS } from '../shared/blocks';

export class GameApp {
  private static readonly SKY_COLOR = new THREE.Color(0xcde3ef);
  private static readonly UNDERWATER_COLOR = new THREE.Color(0x3f77a2);

  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: VoxelWorld;
  private readonly player: PlayerController;
  private readonly fishSchool: FishSchool;
  private readonly hud: Hud;
  private readonly perf = new PerfTracker();

  private selectedBlock: BlockId = PLACEABLE_BLOCKS[0];
  private rafId = 0;
  private running = false;
  private accumulator = 0;
  private lastFrameMs = 0;
  private autosaveElapsedMs = 0;
  private waterFogEnabled = true;

  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.root = root;

    this.scene = new THREE.Scene();
    this.scene.background = GameApp.SKY_COLOR.clone();
    this.scene.fog = new THREE.Fog(0xcde3ef, 90, 180);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0xcde3ef);
    this.root.append(this.renderer.domElement);

    this.addLights();

    this.world = new VoxelWorld(this.scene, WORLD_SEED);
    this.player = new PlayerController(this.camera, this.renderer.domElement);
    this.fishSchool = new FishSchool(this.scene, this.world);
    this.hud = new Hud(this.root, PLACEABLE_BLOCKS, {
      onSpeedMultiplierChange: (value) => this.player.setMoveSpeedMultiplier(value),
      onFlyToggle: (enabled) => this.player.setFlyEnabled(enabled),
      onWaterToggle: (enabled) => {
        this.world.setWaterEnabled(enabled);
        this.fishSchool.setEnabled(enabled);
      },
      onWaterFogToggle: (enabled) => {
        this.waterFogEnabled = enabled;
      },
      onWaterSurfaceLayerToggle: (enabled) => {
        this.world.setWaterSurfaceLayerEnabled(enabled);
      },
      onWaterAlphaToggle: (enabled) => {
        this.world.setWaterTransparencyEnabled(enabled);
      },
      onWaterShineToggle: (enabled) => {
        this.world.setWaterShineEnabled(enabled);
      },
      onWaterPulseToggle: (enabled) => {
        this.world.setWaterPulseEnabled(enabled);
      },
      onWaterSortToggle: (enabled) => {
        this.world.setWaterSortingEnabled(enabled);
      },
      onWaterDepthToggle: (enabled) => {
        this.world.setWaterDepthWriteEnabled(enabled);
      }
    });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onNumberKey);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.onResize();
  }

  async start(): Promise<void> {
    await this.world.init();
    this.hud.setWaterStyle(this.world.getWaterStyleName());
    this.running = true;
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  async dispose(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.rafId);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onNumberKey);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('beforeunload', this.onBeforeUnload);

    this.player.dispose();
    this.fishSchool.dispose(this.scene);
    await this.world.dispose();
    this.renderer.dispose();
  }

  private readonly onFrame = (nowMs: number): void => {
    if (!this.running) {
      return;
    }

    const frameMs = Math.min(100, nowMs - this.lastFrameMs);
    this.lastFrameMs = nowMs;

    this.accumulator += frameMs / 1000;
    while (this.accumulator >= FIXED_TICK_SECONDS) {
      this.tick(FIXED_TICK_SECONDS);
      this.accumulator -= FIXED_TICK_SECONDS;
    }

    this.world.update(this.player.position, this.camera);
    this.fishSchool.update(frameMs / 1000, this.player.position);
    this.updateAtmosphere();
    this.renderer.render(this.scene, this.camera);

    this.perf.pushFrame(frameMs);
    const perf = this.perf.snapshot();
    this.hud.updateStats({
      fps: perf.fps,
      onePercentLowFps: perf.onePercentLowFps,
      p95FrameMs: perf.p95FrameMs,
      loadedChunks: this.world.stats.loadedChunks,
      pendingGenerate: this.world.stats.pendingGenerate,
      pendingMesh: this.world.stats.pendingMesh
    });

    this.rafId = requestAnimationFrame(this.onFrame);
  };

  private tick(dt: number): void {
    this.player.update(dt, this.world);

    this.autosaveElapsedMs += dt * 1000;
    if (this.autosaveElapsedMs >= AUTOSAVE_INTERVAL_MS) {
      this.autosaveElapsedMs = 0;
      void this.world.flushDirtyChunks(16).catch((error) => {
        console.error('Autosave failed', error);
      });
    }
  }

  private tryInteraction(placeBlock: boolean): void {
    if (!this.player.isPointerLocked()) {
      return;
    }

    const origin = this.player.getEyePosition(this.rayOrigin);
    const direction = this.player.getLookDirection(this.rayDirection);
    const hit = voxelRaycast(origin, direction, RAYCAST_MAX_DISTANCE, (x, y, z) => this.world.getBlock(x, y, z));

    if (!hit) {
      return;
    }

    if (!placeBlock) {
      this.world.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
      return;
    }

    const tx = hit.x + hit.normal.x;
    const ty = hit.y + hit.normal.y;
    const tz = hit.z + hit.normal.z;

    if (this.player.intersectsBlock(tx, ty, tz)) {
      return;
    }

    this.world.setBlock(tx, ty, tz, this.selectedBlock);
  }

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xd8e9ff, 0x6a5a49, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(0.6, 1, 0.4).multiplyScalar(80);
    this.scene.add(sun);
  }

  private updateAtmosphere(): void {
    const eye = this.player.getEyePosition(this.rayOrigin);
    const underwater = this.waterFogEnabled && this.world.isWaterEnabled() && isWater(this.world.getBlock(eye.x, eye.y, eye.z));
    const targetColor = underwater ? GameApp.UNDERWATER_COLOR : GameApp.SKY_COLOR;
    const targetNear = underwater ? 10 : 90;
    const targetFar = underwater ? 72 : 180;

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(targetColor, 0.08);
      this.renderer.setClearColor(this.scene.background);
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.lerp(targetColor, 0.08);
      this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, targetNear, 0.08);
      this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, targetFar, 0.08);
    }
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.player.isPointerLocked()) {
      return;
    }

    if (event.button === 0) {
      this.tryInteraction(false);
    } else if (event.button === 2) {
      this.tryInteraction(true);
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onNumberKey = (event: KeyboardEvent): void => {
    if (event.code === 'KeyV') {
      const style = this.world.cycleWaterStyle();
      this.hud.setWaterStyle(style);
      return;
    }

    const code = event.code;
    if (!code.startsWith('Digit')) {
      return;
    }
    const digit = Number(code.slice(5));
    if (!Number.isInteger(digit)) {
      return;
    }

    const index = digit === 0 ? 9 : digit - 1;
    if (index < 0 || index >= PLACEABLE_BLOCKS.length) {
      return;
    }

    this.selectedBlock = PLACEABLE_BLOCKS[index];
    this.hud.setSelectedSlot(index);
  };

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private readonly onBeforeUnload = (): void => {
    void this.world.flushDirtyChunks().catch(() => undefined);
  };
}
