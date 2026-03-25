import * as THREE from 'three';
import {
  AIR_CONTROL_FACTOR,
  GRAVITY,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH
} from './constants';
import { VoxelWorld } from './world';

const EPS = 1e-4;

export class PlayerController {
  readonly position = new THREE.Vector3(8, 80, 8);
  readonly velocity = new THREE.Vector3();
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private pitch = 0;
  private onGround = false;
  private readonly keys = new Set<string>();
  private readonly domElement: HTMLElement;
  private moveSpeedMultiplier = 1;
  private flyEnabled = false;
  private destroyed = false;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.camera.rotation.order = 'YXZ';

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('click', this.onClickToLock);
  }

  dispose(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('click', this.onClickToLock);
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  getEyePosition(target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(this.position);
    target.y += PLAYER_EYE_HEIGHT;
    return target;
  }

  getLookDirection(target = new THREE.Vector3()): THREE.Vector3 {
    this.camera.getWorldDirection(target);
    return target.normalize();
  }

  setMoveSpeedMultiplier(value: number): void {
    this.moveSpeedMultiplier = THREE.MathUtils.clamp(value, 0.4, 3);
  }

  setFlyEnabled(enabled: boolean): void {
    this.flyEnabled = enabled;
    this.onGround = false;
    this.velocity.y = 0;
  }

  update(dt: number, world: VoxelWorld): void {
    if (!world.isChunkLoadedAtWorld(this.position.x, this.position.z)) {
      this.syncCamera();
      return;
    }

    const moveX = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const moveZ = Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'));
    const input = new THREE.Vector2(moveX, moveZ);
    if (input.lengthSq() > 1) {
      input.normalize();
    }

    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const baseSpeed = MOVE_SPEED * this.moveSpeedMultiplier;
    const desiredX = (input.x * cosYaw + input.y * sinYaw) * baseSpeed;
    const desiredZ = (input.y * cosYaw - input.x * sinYaw) * baseSpeed;

    if (this.flyEnabled) {
      const rise = Number(this.keys.has('Space'));
      const fall = Number(this.keys.has('ShiftLeft') || this.keys.has('ControlLeft'));
      const desiredY = (rise - fall) * baseSpeed;

      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desiredX, Math.min(1, 10 * dt));
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, desiredZ, Math.min(1, 10 * dt));
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, desiredY, Math.min(1, 10 * dt));

      this.position.addScaledVector(this.velocity, dt);
      this.syncCamera();
      return;
    }

    const control = this.onGround ? 1 : AIR_CONTROL_FACTOR;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desiredX, Math.min(1, 12 * dt * control));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, desiredZ, Math.min(1, 12 * dt * control));
    this.velocity.y -= GRAVITY * dt;

    if (this.keys.has('Space') && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    this.position.x += this.velocity.x * dt;
    this.resolveCollisions('x', world);

    this.position.y += this.velocity.y * dt;
    this.onGround = false;
    this.resolveCollisions('y', world);

    this.position.z += this.velocity.z * dt;
    this.resolveCollisions('z', world);

    if (this.position.y < -20) {
      this.position.set(8, 90, 8);
      this.velocity.set(0, 0, 0);
    }

    this.syncCamera();
  }

  intersectsBlock(bx: number, by: number, bz: number): boolean {
    const minX = this.position.x - PLAYER_WIDTH * 0.5;
    const maxX = this.position.x + PLAYER_WIDTH * 0.5;
    const minY = this.position.y;
    const maxY = this.position.y + PLAYER_HEIGHT;
    const minZ = this.position.z - PLAYER_WIDTH * 0.5;
    const maxZ = this.position.z + PLAYER_WIDTH * 0.5;

    return !(
      maxX <= bx ||
      minX >= bx + 1 ||
      maxY <= by ||
      minY >= by + 1 ||
      maxZ <= bz ||
      minZ >= bz + 1
    );
  }

  private resolveCollisions(axis: 'x' | 'y' | 'z', world: VoxelWorld): void {
    const halfW = PLAYER_WIDTH * 0.5;
    const minX = this.position.x - halfW;
    const maxX = this.position.x + halfW;
    const minY = this.position.y;
    const maxY = this.position.y + PLAYER_HEIGHT;
    const minZ = this.position.z - halfW;
    const maxZ = this.position.z + halfW;

    const startX = Math.floor(minX);
    const endX = Math.floor(maxX - EPS);
    const startY = Math.floor(minY);
    const endY = Math.floor(maxY - EPS);
    const startZ = Math.floor(minZ);
    const endZ = Math.floor(maxZ - EPS);

    let collided = false;

    for (let y = startY; y <= endY; y++) {
      for (let z = startZ; z <= endZ; z++) {
        for (let x = startX; x <= endX; x++) {
          if (!world.hasSolidBlock(x, y, z)) {
            continue;
          }

          collided = true;
          if (axis === 'x') {
            if (this.velocity.x > 0) {
              this.position.x = Math.min(this.position.x, x - halfW - EPS);
            } else if (this.velocity.x < 0) {
              this.position.x = Math.max(this.position.x, x + 1 + halfW + EPS);
            }
          } else if (axis === 'y') {
            if (this.velocity.y > 0) {
              this.position.y = Math.min(this.position.y, y - PLAYER_HEIGHT - EPS);
            } else if (this.velocity.y < 0) {
              this.position.y = Math.max(this.position.y, y + 1 + EPS);
              this.onGround = true;
            }
          } else {
            if (this.velocity.z > 0) {
              this.position.z = Math.min(this.position.z, z - halfW - EPS);
            } else if (this.velocity.z < 0) {
              this.position.z = Math.max(this.position.z, z + 1 + halfW + EPS);
            }
          }
        }
      }
    }

    if (!collided) {
      return;
    }

    if (axis === 'x') {
      this.velocity.x = 0;
    } else if (axis === 'y') {
      this.velocity.y = 0;
    } else {
      this.velocity.z = 0;
    }
  }

  private syncCamera(): void {
    this.camera.position.copy(this.position);
    this.camera.position.y += PLAYER_EYE_HEIGHT;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private readonly onClickToLock = (): void => {
    void this.domElement.requestPointerLock();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isPointerLocked()) {
      return;
    }

    const sensitivity = 0.0022;
    this.yaw -= event.movementX * sensitivity;
    this.pitch -= event.movementY * sensitivity;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };
}
