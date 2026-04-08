# SoF item / weapon pickup bounds (server)

Source: **Hex-Rays decompilation** of `gamex86.so` (Linux 1.06a), function **`I_Spawn(edict_s *, Pickup *)`** at **`0x1bf9f8`** (`I_Spawn__FP7edict_sP6Pickup`).

Map entities such as `weapon_*` and `item_*` are turned into touchable edicts through this path: `MakeItem` → `G_Spawn` → **`I_Spawn`**, which assigns **axis-aligned bounding boxes** (`mins` / `maxs`) on the edict before registering touch handlers (`itemWeaponTouch`, `itemAmmoTouch`, etc.).

## Default box (most pickups, including weapons)

Immediately after the CTF flag checks, the code assigns six floats on the edict (indexed as `float` offsets **71–76** in the decompilation — i.e. three `mins` then three `maxs`):

| Component | Value |
|-----------|--------|
| mins.x, mins.y, mins.z | **-8**, **-8**, **-8** |
| maxs.x, maxs.y, maxs.z | **8**, **8**, **8** |

So the **default pickup hull is a 16×16×16 Quake-unit cube** centered on the entity origin (same extent on all axes before scaling / special cases).

Constants in pseudocode match IEEE-754 hex:

- `-1056964608` → `0xC1000000` → **-8.0f**
- `1090519040` → `0x41000000` → **8.0f**

## Scale

If the **`Pickup`** record supplies a **scale** (decompilation reads **`((float *)s2 + 59)`**, i.e. float index **59** on the `Pickup *`), **all six** mins/maxs components are multiplied by that scale when the model init path runs (see block ending at `LABEL_49`).

So per-item size differences in data files are mostly **uniform scale**, not different per-axis defaults, unless overridden below.

## Z min override from `Pickup`

After scaling, the decompilation assigns:

- `((float *)s + 73) = *((float *)s2 + 62);`

Offset **73** is the **third mins component** (typically **mins.z**). Offset **62** on the **`Pickup`** object is therefore a **per-definition Z extent** (or related float) pulled from the pickup table on disk — inspect `Pickup` / `PickupInst` layout in the binary or `.itm` / GSQ data for the exact meaning.

## CTF / control flags (special case)

When the pickup type is flag-related (`Pickup` type **3** and subtype **36** or **39**), the code replaces the bounds with a **larger** box (before scale), e.g.:

- mins: **-20**, **-20**, **-10**
- maxs: **20**, **20**, **30**

(Exact literals appear as `-20.0`, `-10.0`, `20.0`, `30.0` and matching hex floats in the same six-slot pattern.)

## Shotgun specifically

There is **no separate shotgun-only AABB** in `I_Spawn`: **all weapon pickups** use **`Pickup` type 1** → touch **`itemWeaponTouch`**. The **shotgun** (and other guns) use the **same default ±8** box unless the **`Pickup`** entry for that weapon applies **scale** or the **Z** override above.

Spawn names like `weapon_shotgun` are resolved via **`PickupList::GetPickupFromSpawnName`** (see `MakeItem`); the **`Pickup`** record drives model, scale, and the extra floats.

## Practical notes for tools / WebGL

- **Editor / renderer** can use **mins (-8,-8,-8) maxs (8,8,8)** as a reasonable default for unknown `item_*` / `weapon_*` entities if no per-class bbox is available.
- **Accurate** per-item bounds require either **game data** (pickup lists) or **matching server logic** (scale + Z override).
- **BSP** does not store these mins/maxs in the entity string; they are **runtime** on the server.

## IDA references

| Binary | Symbol | Address |
|--------|--------|---------|
| `gamex86.so` | `I_Spawn__FP7edict_sP6Pickup` | `0x1bf9f8` |
| `gamex86.so` | `MakeItem__FPcPf` | `0x1c04e0` |
| `gamex86.so` | `itemWeaponTouch__FP7edict_sT0P8cplane_sP10mtexinfo_s` | `0x1bdec0` |

## SDK

This workspace clone did not include **`sof-sdk`** sources on disk; if you have them locally, search for **`I_Spawn`**, **`Pickup`**, **`itemWeaponTouch`**, and pickup data loaders for the same constants and struct fields (offsets **59**, **62** on `Pickup` in the 1.06a Linux build).
