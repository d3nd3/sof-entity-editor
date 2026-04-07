import * as THREE from "three";
import { quakeToThree } from "./coords";

/** p_client.cpp `PutClientInServer` → `ent->mins` / `ent->maxs`; gamex86 `PutClientInServer` sets -16,-16,-24 / 16,16,40 (IDA). */
export const PLAYER_SPAWN_HULL_QUAKE = {
  mins: [-16, -16, -24] as const,
  maxs: [16, 16, 40] as const,
};

/** Axis-aligned Quake bbox → Three `BoxGeometry` size and local center offset (feet at entity origin). */
export function quakeAabbToThreeBox(
  mins: readonly [number, number, number],
  maxs: readonly [number, number, number],
  size: THREE.Vector3,
  centerLocal: THREE.Vector3,
) {
  const mx = mins[0],
    my = mins[1],
    mz = mins[2];
  const Mx = maxs[0],
    My = maxs[1],
    Mz = maxs[2];
  size.set(Mx - mx, Mz - mz, My - my);
  centerLocal.copy(quakeToThree((mx + Mx) / 2, (my + My) / 2, (mz + Mz) / 2));
}
