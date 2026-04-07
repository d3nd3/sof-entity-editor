import * as THREE from "three";

/**
 * SoF / Quake2 BSP: X,Y horizontal, Z up. Three.js: Y up, XZ horizontal.
 * Use (x, z, -y) so handedness matches the game (avoids left–right mirror vs ref_gl).
 */
export function quakeToThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

export function threeToQuake(v: THREE.Vector3): [number, number, number] {
  return [v.x, -v.z, v.y];
}

/** Horizontal facing in Three (Y up): 0° → +X (red), 90° → −Z (blue negative), in XZ plane. */
export function yawDegreesToHorizontalDirThree(yawDeg: number): THREE.Vector3 {
  const r = (yawDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(r), 0, -Math.sin(r));
}

/** Matches `BoxGeometry` group order: +X, −X, +Y, −Y, +Z, −Z. */
const BOX_FACE_NORMALS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export function faceIndexForDirection(dir: THREE.Vector3): number {
  const d = dir.clone().normalize();
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const dot = d.dot(BOX_FACE_NORMALS[i]!);
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

export function faceIndexForYawDegrees(yawDeg: number): number {
  return faceIndexForDirection(yawDegreesToHorizontalDirThree(yawDeg));
}
