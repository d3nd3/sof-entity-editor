import {
  BSPVERSION,
  DEDGE_SIZE,
  DFACE_SIZE,
  DMODEL_SIZE,
  DVERTEX_SIZE,
  HEADER_LUMPS,
  IDBSP,
  Lump,
} from "./constants";

export type LumpInfo = { offset: number; length: number };

export type BspFile = {
  buffer: ArrayBuffer;
  lumps: LumpInfo[];
  /** Raw entity lump (NUL-terminated string) */
  entityString: string;
};

function readLumps(dv: DataView): LumpInfo[] {
  const lumps: LumpInfo[] = [];
  let o = 8;
  for (let i = 0; i < HEADER_LUMPS; i++) {
    lumps.push({ offset: dv.getInt32(o, true), length: dv.getInt32(o + 4, true) });
    o += 8;
  }
  return lumps;
}

export function parseBsp(buffer: ArrayBuffer): BspFile {
  const dv = new DataView(buffer);
  const ident = dv.getUint32(0, true);
  const version = dv.getInt32(4, true);
  if (ident !== IDBSP) throw new Error(`Invalid BSP ident 0x${ident.toString(16)} (expected IBSP)`);
  if (version !== BSPVERSION) throw new Error(`Unsupported BSP version ${version} (expected ${BSPVERSION})`);

  const lumps = readLumps(dv);
  const ent = lumps[Lump.ENTITIES];
  const entityBytes = new Uint8Array(buffer, ent.offset, ent.length);
  const nul = entityBytes.indexOf(0);
  const entityString = new TextDecoder("utf-8", { fatal: false }).decode(
    entityBytes.subarray(0, nul >= 0 ? nul : entityBytes.length)
  );

  return { buffer, lumps, entityString };
}

export function readModel0(buffer: ArrayBuffer, lumps: LumpInfo[]) {
  const lm = lumps[Lump.MODELS];
  if (lm.length < DMODEL_SIZE) throw new Error("MODELS lump too small");
  const dv = new DataView(buffer, lm.offset, DMODEL_SIZE);
  return {
    mins: [dv.getFloat32(0, true), dv.getFloat32(4, true), dv.getFloat32(8, true)] as [number, number, number],
    maxs: [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)] as [number, number, number],
    origin: [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)] as [number, number, number],
    headnode: dv.getInt32(36, true),
    firstface: dv.getUint32(40, true),
    numfaces: dv.getUint32(44, true),
  };
}

/** SoF dface_t — stride DFACE_SIZE */
export function readFace(dv: DataView, faceIndex: number) {
  const o = faceIndex * DFACE_SIZE;
  return {
    planenum: dv.getUint16(o, true),
    side: dv.getInt16(o + 2, true),
    firstedge: dv.getInt32(o + 4, true),
    numedges: dv.getInt16(o + 8, true),
    texinfo: dv.getInt16(o + 10, true),
    region: dv.getInt16(o + 12, true),
    first_regionface: dv.getInt32(o + 16, true),
    num_regionfaces: dv.getInt16(o + 20, true),
    lightofs: dv.getInt32(o + 28, true),
  };
}

export function getSurfedges(buffer: ArrayBuffer, lumps: LumpInfo[]): Int32Array {
  const l = lumps[Lump.SURFEDGES];
  const n = Math.floor(l.length / 4);
  return new Int32Array(buffer, l.offset, n);
}

export function getEdges(buffer: ArrayBuffer, lumps: LumpInfo[]): Uint16Array {
  const l = lumps[Lump.EDGES];
  const n = Math.floor(l.length / DEDGE_SIZE) * 2;
  return new Uint16Array(buffer, l.offset, n);
}

export function getVertices(buffer: ArrayBuffer, lumps: LumpInfo[]): Float32Array {
  const l = lumps[Lump.VERTEXES];
  const n = Math.floor(l.length / DVERTEX_SIZE) * 3;
  return new Float32Array(buffer, l.offset, n);
}

export function buildWorldMeshData(buffer: ArrayBuffer, lumps: LumpInfo[]) {
  const model = readModel0(buffer, lumps);
  const facesL = lumps[Lump.FACES];
  const numFaces = Math.floor(facesL.length / DFACE_SIZE);
  const faceDv = new DataView(buffer, facesL.offset, facesL.length);
  const surfedges = getSurfedges(buffer, lumps);
  const edges = getEdges(buffer, lumps);
  const verts = getVertices(buffer, lumps);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCursor = 0;

  const pushVert = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    positions.push(x, y, z);
    colors.push(r, g, b);
    return vertCursor++;
  };

  const hueToRgb = (texinfo: number) => {
    const h = (texinfo * 0.618033988749895) % 1;
    const s = 0.45;
    const l = 0.55;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h + 1 / 3;
    const f = (t: number) => (t < 0 ? t + 1 : t > 1 ? t - 1 : t);
    const tr = f(hk);
    const tg = f(h);
    const tb = f(h - 1 / 3);
    const c = (t: number) => (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
    return [c(tr), c(tg), c(tb)] as const;
  };

  for (let fi = 0; fi < model.numfaces; fi++) {
    const faceIndex = model.firstface + fi;
    if (faceIndex >= numFaces) continue;
    const face = readFace(faceDv, faceIndex);
    if (face.numedges < 3) continue;

    const [r, g, b] = hueToRgb(face.texinfo >= 0 ? face.texinfo : 0);
    const polyIdx: number[] = [];
    for (let e = 0; e < face.numedges; e++) {
      const se = surfedges[face.firstedge + e];
      const ei = Math.abs(se);
      const v0 = edges[ei * 2];
      const v1 = edges[ei * 2 + 1];
      const vi = se >= 0 ? v0 : v1;
      polyIdx.push(vi);
    }

    const triBase: number[] = [];
    for (const vi of polyIdx) {
      const qx = verts[vi * 3];
      const qy = verts[vi * 3 + 1];
      const qz = verts[vi * 3 + 2];
      // Quake Z-up → Three Y-up, same as coords.quakeToThree: (qx, qz, -qy)
      triBase.push(pushVert(qx, qz, -qy, r, g, b));
    }
    for (let t = 1; t < triBase.length - 1; t++) {
      indices.push(triBase[0], triBase[t], triBase[t + 1]);
    }
  }

  return { positions, colors, indices };
}
