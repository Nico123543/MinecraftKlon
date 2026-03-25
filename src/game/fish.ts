import * as THREE from 'three';
import { CHUNK_SIZE_Y } from './constants';
import { isWater } from '../shared/blocks';
import { VoxelWorld } from './world';

interface FishAgent {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  turnTimer: number;
  phase: number;
  color: THREE.Color;
  active: boolean;
}

const MAX_FISH = 56;
const SCHOOL_RADIUS = 52;

export class FishSchool {
  private readonly world: VoxelWorld;
  private readonly mesh: THREE.InstancedMesh;
  private readonly fish: FishAgent[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly target = new THREE.Vector3();
  private readonly random = new THREE.Vector3();
  private enabled = true;

  constructor(scene: THREE.Scene, world: VoxelWorld) {
    this.world = world;

    const geometry = new THREE.ConeGeometry(0.16, 0.62, 8, 1);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, 0.18);

    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      vertexColors: true,
      emissive: new THREE.Color(0x1a2838),
      emissiveIntensity: 0.5,
      shininess: 80
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_FISH);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = MAX_FISH;
    this.mesh.renderOrder = 3;

    for (let i = 0; i < MAX_FISH; i++) {
      this.fish.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(1, 0, 0),
        speed: 1.2 + Math.random() * 1.6,
        turnTimer: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        color: new THREE.Color().setHSL(0.04 + Math.random() * 0.12, 0.9, 0.62),
        active: false
      });
    }

    scene.add(this.mesh);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      for (const material of this.mesh.material) {
        material.dispose();
      }
    } else {
      this.mesh.material.dispose();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mesh.visible = enabled;
    if (enabled) {
      return;
    }
    for (let i = 0; i < this.fish.length; i++) {
      this.fish[i].active = false;
      this.writeHiddenInstance(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    if (!this.enabled) {
      return;
    }

    this.ensurePopulation(playerPosition);

    const t = performance.now() * 0.001;
    for (let i = 0; i < this.fish.length; i++) {
      const fish = this.fish[i];
      if (!fish.active) {
        this.writeHiddenInstance(i);
        continue;
      }

      fish.turnTimer -= dt;
      if (fish.turnTimer <= 0) {
        fish.turnTimer = 0.8 + Math.random() * 2.2;
        this.random.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
        fish.velocity.addScaledVector(this.random, 0.7).normalize();
      }

      const toPlayer = this.target.copy(playerPosition).sub(fish.position);
      const distXZ = Math.hypot(toPlayer.x, toPlayer.z);
      if (distXZ > SCHOOL_RADIUS) {
        toPlayer.normalize();
        fish.velocity.lerp(toPlayer, 0.05).normalize();
      }

      fish.position.addScaledVector(fish.velocity, fish.speed * dt);

      const fishX = Math.floor(fish.position.x);
      const fishY = Math.floor(fish.position.y);
      const fishZ = Math.floor(fish.position.z);
      const inWater = isWater(this.world.getBlock(fishX, fishY, fishZ));
      if (!inWater || fish.position.y < 4 || fish.position.y > CHUNK_SIZE_Y - 4) {
        if (!this.relocateFish(fish, playerPosition, 24)) {
          fish.active = false;
          this.writeHiddenInstance(i);
          continue;
        }
      }

      const surfaceY = this.findWaterSurface(fishX, fishZ);
      if (surfaceY >= 0) {
        const minY = surfaceY - 5;
        const maxY = surfaceY - 0.5;
        fish.position.y = THREE.MathUtils.clamp(fish.position.y, minY, maxY);
      }

      const swim = Math.sin(t * 3.2 + fish.phase) * 0.25;
      fish.velocity.y = THREE.MathUtils.clamp(fish.velocity.y + swim * dt * 0.65, -0.35, 0.35);
      fish.velocity.normalize();

      this.target.copy(fish.position).add(fish.velocity);
      this.dummy.position.copy(fish.position);
      this.dummy.lookAt(this.target);
      const scale = 0.9 + Math.sin(t * 8 + fish.phase) * 0.08;
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, fish.color);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private ensurePopulation(playerPosition: THREE.Vector3): void {
    let activeCount = 0;
    for (const fish of this.fish) {
      if (fish.active) activeCount++;
    }
    if (activeCount >= MAX_FISH * 0.7) {
      return;
    }

    for (const fish of this.fish) {
      if (fish.active) {
        continue;
      }
      if (!this.relocateFish(fish, playerPosition, SCHOOL_RADIUS) && !this.relocateFish(fish, playerPosition, SCHOOL_RADIUS * 2)) {
        continue;
      }

      fish.active = true;
      fish.velocity.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      fish.turnTimer = 0.5 + Math.random() * 2;
      fish.speed = 1.1 + Math.random() * 1.7;
      if (++activeCount >= MAX_FISH * 0.92) {
        break;
      }
    }
  }

  private relocateFish(fish: FishAgent, playerPosition: THREE.Vector3, radius: number): boolean {
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 4 + Math.random() * radius;
      const x = Math.floor(playerPosition.x + Math.cos(angle) * dist);
      const z = Math.floor(playerPosition.z + Math.sin(angle) * dist);
      if (!this.world.isChunkLoadedAtWorld(x, z)) continue;

      const surfaceY = this.findWaterSurface(x, z);
      if (surfaceY < 2) continue;

      const depth = 1 + Math.floor(Math.random() * 3);
      const y = surfaceY - depth;
      if (!isWater(this.world.getBlock(x, y, z))) continue;
      fish.position.set(x + 0.5, y + 0.35, z + 0.5);
      return true;
    }
    return false;
  }

  private findWaterSurface(wx: number, wz: number): number {
    for (let y = CHUNK_SIZE_Y - 3; y >= 2; y--) {
      const block = this.world.getBlock(wx, y, wz);
      if (!isWater(block)) continue;
      if (isWater(this.world.getBlock(wx, y + 1, wz))) continue;
      return y;
    }
    return -1;
  }

  private writeHiddenInstance(index: number): void {
    this.dummy.position.set(0, -10_000, 0);
    this.dummy.scale.set(0.001, 0.001, 0.001);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.mesh.setColorAt(index, new THREE.Color(0, 0, 0));
  }
}
