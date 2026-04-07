# Soldier of Fortune BSP (IBSP v46)

This document summarizes the on-disk BSP format used by the SoF game code, as declared in [`sof-sdk/Source/Game/qcommon/qfiles.h`](../sof-sdk/Source/Game/qcommon/qfiles.h). Stock **Quake II** maps use **19** lumps and a different face record size; SoF uses **version 46** and **22** lumps.

## Header

| Field | Type | Notes |
|-------|------|--------|
| `ident` | `int32` LE | Little-endian `0x50534249` (`"IBSP"`) |
| `version` | `int32` LE | **46** (`BSPVERSION`) |
| `lumps` | `lump_t[22]` | Each lump: `fileofs`, `filelen` (`int32` each) |

Total header size: 8 + 22 × 8 = **184** bytes.

## Lump indices (`HEADER_LUMPS` = 22)

| Index | Name |
|------:|------|
| 0 | `ENTITIES` |
| 1 | `PLANES` |
| 2 | `VERTEXES` |
| 3 | `VISIBILITY` |
| 4 | `NODES` |
| 5 | `TEXINFO` |
| 6 | `FACES` |
| 7 | `LIGHTING` |
| 8 | `LEAFS` |
| 9 | `LEAFFACES` |
| 10 | `LEAFBRUSHES` |
| 11 | `EDGES` |
| 12 | `SURFEDGES` |
| 13 | `MODELS` |
| 14 | `BRUSHES` |
| 15 | `BRUSHSIDES` |
| 16 | `POP` |
| 17 | `AREAS` |
| 18 | `AREAPORTALS` |
| **19** | **`REGIONFACES`** (not in stock Q2) |
| **20** | **`LIGHTS`** (not in stock Q2) |
| **21** | **`REGIONS`** (not in stock Q2) |

## Struct sizes (runtime `qfiles.h`)

| Struct | Size (GCC, typical) | Notes |
|--------|----------------------|--------|
| `dvertex_t` | 12 | `float point[3]` |
| `dedge_t` | 4 | `unsigned short v[2]` |
| `dface_t` | **44** | SoF-specific fields; **not** the same as Q2 `dface_t` |
| `texinfo_t` | 76 | Same idea as Q2 but verify with engine if porting old tools |
| `dmodel_t` | 48 | First model = world; `firstface` / `numfaces` drive world surfaces |

## `dface_t` vs Quake II

SoF’s `dface_t` adds (among other fields) **`region`**, **`first_regionface`**, **`num_regionfaces`**, **`lightmip_*`** bytes after `styles[]`, and uses **`MAXLIGHTMAPS` = 4** for `styles`. A parser that assumes the older, smaller Q2 face stride will read the wrong `firstedge` / `numedges` for every face after the first.

The web loader in `src/bsp/parse.ts` uses stride **44** bytes per face (`DFACE_SIZE`).

## Obtaining maps in the web UI

The editor can fetch map packs from **`https://raw.githubusercontent.com/plowsof/sof1maps/main/<path>.zip`**, unzip with `fflate`, and load the contained `.bsp` (see `src/sof1maps.ts`). Listing uses the **GitHub Contents API** (`/repos/plowsof/sof1maps/contents/<folder>`). Both endpoints allow browser `fetch` (CORS).

## Coordinates (engine vs this viewer)

SoF / Quake2 map data uses **Z-up** (X,Y ground, Z height). The web viewer converts to **Three.js Y-up** with a **handedness fix** so the view matches the game: map `(x,y,z)` to `(x, z, -y)`. Entity `origin` strings remain in **game (Z-up) units** in memory and in exported files.

## Entities lump

`LUMP_ENTITIES` is a single **NUL-terminated** ASCII (or UTF-8-compatible) string of Quake-style blocks:

```text
{
"classname" "worldspawn"
...
}
{
"origin" "0 0 0"
"classname" "info_player_deathmatch"
}
```

## Runtime verification (IDA: `sof-bin`)

Cross-checked against the Linux `sof-bin` binary (IDA MCP instance `sof-bin` / `CM_LoadLump__FPci` @ `0x81153e0`, `CM_LoadMap__FPci` @ `0x81197a4`).

| Check | Result |
|--------|--------|
| Header read size | **184** bytes (`FS_Read(..., 184, ...)`) — matches `sizeof(dheader_t)` with **22** lumps |
| `version` field | Compared to **46**; failure path: `Mod_LoadBrushModel: %s has wrong version number (%i should be %i)` with expected **46** |
| `LUMP_ENTITIES` = **0** | `CM_GetLumpbase(..., 0, ...)` loads `map_entitystring` / `numentitychars` |
| `LUMP_*` order | `CM_LoadMap` passes lump indices **1, 3, 4, 5, 6, 8, 10, 13–18, 21** in the same order as the `LUMP_*` enum in `qfiles.h` (e.g. **5** = texinfo/surfaces, **6** = faces, **21** = regions) |

IDA’s structure export was unavailable in this database (`ida_struct` / `struct_module_missing`), so struct sizes (e.g. `dface_t` = 44) remain **confirmed from the SDK header + GCC `sizeof`**, not from IDA’s type library.

## References

- Engine / tools header: [`../sof-sdk/Source/Game/qcommon/qfiles.h`](../sof-sdk/Source/Game/qcommon/qfiles.h)
- Legacy SoFData tool headers (`BSPVERSION` 38, 19 lumps) do **not** match the shipping game format; use the Game `qfiles.h` for loaders.
