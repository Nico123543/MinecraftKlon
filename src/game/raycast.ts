import * as THREE from 'three';
import { BlockId, isSolid } from '../shared/blocks';

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  normal: THREE.Vector3;
  distance: number;
  block: BlockId;
}

export function voxelRaycast(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  getBlock: (x: number, y: number, z: number) => BlockId
): RaycastHit | null {
  const dir = direction.clone().normalize();
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x >= 0 ? 1 : -1;
  const stepY = dir.y >= 0 ? 1 : -1;
  const stepZ = dir.z >= 0 ? 1 : -1;

  const tDeltaX = dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x);
  const tDeltaY = dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y);
  const tDeltaZ = dir.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.z);

  const nextVoxelBoundaryX = x + (stepX > 0 ? 1 : 0);
  const nextVoxelBoundaryY = y + (stepY > 0 ? 1 : 0);
  const nextVoxelBoundaryZ = z + (stepZ > 0 ? 1 : 0);

  let tMaxX = dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs((nextVoxelBoundaryX - origin.x) / dir.x);
  let tMaxY = dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs((nextVoxelBoundaryY - origin.y) / dir.y);
  let tMaxZ = dir.z === 0 ? Number.POSITIVE_INFINITY : Math.abs((nextVoxelBoundaryZ - origin.z) / dir.z);

  let t = 0;
  const hitNormal = new THREE.Vector3(0, 0, 0);
  const maxSteps = 1024;

  for (let i = 0; i < maxSteps && t <= maxDistance; i++) {
    const block = getBlock(x, y, z);
    if (isSolid(block)) {
      return {
        x,
        y,
        z,
        normal: hitNormal.clone(),
        distance: t,
        block
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        hitNormal.set(-stepX, 0, 0);
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        hitNormal.set(0, 0, -stepZ);
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        hitNormal.set(0, -stepY, 0);
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        hitNormal.set(0, 0, -stepZ);
      }
    }
  }

  return null;
}
