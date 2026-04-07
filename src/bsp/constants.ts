/** Soldier of Fortune BSP — see sof-sdk/Source/Game/qcommon/qfiles.h */
export const IDBSP = 0x50534249; // little-endian "IBSP"
export const BSPVERSION = 46;
export const HEADER_LUMPS = 22;
export const DFACE_SIZE = 44;
export const DTEXINFO_SIZE = 76;
export const DMODEL_SIZE = 48;
export const DVERTEX_SIZE = 12;
export const DEDGE_SIZE = 4;
export const DPLANE_SIZE = 20;

export enum Lump {
  ENTITIES = 0,
  PLANES = 1,
  VERTEXES = 2,
  VISIBILITY = 3,
  NODES = 4,
  TEXINFO = 5,
  FACES = 6,
  LIGHTING = 7,
  LEAFS = 8,
  LEAFFACES = 9,
  LEAFBRUSHES = 10,
  EDGES = 11,
  SURFEDGES = 12,
  MODELS = 13,
  BRUSHES = 14,
  BRUSHSIDES = 15,
  POP = 16,
  AREAS = 17,
  AREAPORTALS = 18,
  REGIONFACES = 19,
  LIGHTS = 20,
  REGIONS = 21,
}
