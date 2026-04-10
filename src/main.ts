import "./style.css";
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { buildWorldMeshData, parseBsp, readModel0, type BspFile } from "./bsp/parse";
import {
  type EntityBlock,
  formatOrigin,
  getPair,
  parseEntityString,
  parseOrigin,
  parseYawDegrees,
  serializeEntityString,
  setPair,
} from "./entities";
import { quakeToThree, threeToQuake } from "./coords";
import { PLAYER_SPAWN_HULL_QUAKE, quakeAabbToThreeBox } from "./playerHull";
import {
  buildSpawnflagsEditor,
  formatSpawnflags,
  getEntityDefQuakedMeta,
  parseSpawnflagsString,
} from "./spawnflagsCatalog";
import {
  buildProfileMapEntityZip,
  getBundledMapEntityText,
  getCurrentProfileSlug,
  listBundledMapTxts,
  listBundledProfileSlugs,
  sanitizeMapRelPath,
  sanitizeProfileSlug,
  setCurrentProfileSlug,
  zipRelToMapPath,
} from "./entityProfiles";
import {
  getAllQrkClassnames,
  getEntityEditorTooltip,
  getEntityFieldNames,
  getEntityFieldValueOptions,
  getToolboxRoot,
  type ToolboxNode,
} from "./qrkCatalog";
import {
  addEntryToActive,
  addPlaylist,
  deletePlaylist,
  exportMapListsJson,
  getActiveId,
  getActivePlaylist,
  getCurrentIndex,
  getLastLoadedZipRel,
  getPlaylistLabel,
  getPlaylists,
  goNext,
  goPrev,
  importMapListsJson,
  initBundledMapLists,
  jumpToEntryIndex,
  MAP_ENTRY_COLORS,
  reorderActiveEntry,
  removeEntryAt,
  setActiveEntryColor,
  setActiveEntryNote,
  setActivePlaylistId,
  setLastLoadedZipRel,
} from "./mapPlaylists";
import { fetchBspFromSof1mapsZip, resolveSof1mapsZipPath, SOF1MAPS_FOLDERS } from "./sof1maps";
import {
  applyMapCacheToUi,
  getLastZipRel,
  loadAutoloadCheckbox,
  populateMapRecentSelect,
  recordSof1mapsOpen,
  saveAutoloadCheckbox,
} from "./mapCache";
import { scheduleProfileEntityFileSync } from "./profileDiskSync";

const MAP_PL_COLOR_LABELS: Record<string, string> = {
  sky: "Sky",
  mint: "Mint",
  amber: "Amber",
  rose: "Rose",
  violet: "Violet",
  lime: "Lime",
  ocean: "Ocean",
  slate: "Slate",
};

/** Map list DnD: source row index while dragging (grip), or -1. */
let mapPlDragFrom = -1;
let mapPlColorPopover: HTMLDivElement | null = null;
let mapPlColorPopoverIdx = -1;
let mapPlColorPopoverCleanup: (() => void) | null = null;

function closeMapPlColorPopover() {
  mapPlColorPopoverCleanup?.();
  mapPlColorPopoverCleanup = null;
  mapPlColorPopover?.remove();
  mapPlColorPopover = null;
  mapPlColorPopoverIdx = -1;
}

function openMapPlColorPopover(anchor: HTMLElement, li: HTMLLIElement, index: number) {
  closeMapPlColorPopover();
  const pop = document.createElement("div");
  pop.className = "map-pl-color-popover";
  pop.setAttribute("role", "listbox");
  pop.setAttribute("aria-label", "Choose row colour");
  const mk = (colorId: string, label: string, cls: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `map-pl-swatch ${cls}`;
    b.dataset.color = colorId;
    b.title = label;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setActiveEntryColor(index, colorId || null);
      syncMapEntryRowColor(li, index);
      closeMapPlColorPopover();
    });
    pop.appendChild(b);
  };
  mk("", "No colour", "map-pl-swatch--none");
  for (const c of MAP_ENTRY_COLORS) mk(c, MAP_PL_COLOR_LABELS[c] ?? c, `map-pl-swatch--${c}`);
  document.body.appendChild(pop);
  mapPlColorPopover = pop;
  mapPlColorPopoverIdx = index;
  const ar = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top = `${ar.bottom + 4}px`;
  pop.style.zIndex = "4000";
  const place = () => {
    const pr = pop.getBoundingClientRect();
    let left = ar.left;
    if (pr.width && left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    if (left < 8) left = 8;
    pop.style.left = `${left}px`;
    if (pr.bottom > window.innerHeight - 8) pop.style.top = `${Math.max(8, ar.top - pr.height - 4)}px`;
  };
  requestAnimationFrame(place);

  const onDoc = (e: MouseEvent) => {
    const t = e.target as Node;
    if (pop.contains(t) || anchor.contains(t)) return;
    closeMapPlColorPopover();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeMapPlColorPopover();
  };
  queueMicrotask(() => document.addEventListener("mousedown", onDoc));
  document.addEventListener("keydown", onKey);
  mapPlColorPopoverCleanup = () => {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("keydown", onKey);
  };
}

let entityBlocks: EntityBlock[] = [];
/** Filled in `initUI` — redraws the sof1maps recent list after loads. */
let refreshRecentMapsUi: () => void = () => {};
let bspName = "map";
/** Map file id for profile paths, e.g. `dm/iraq_small` from `dm/iraq_small.zip`. */
let mapEntityRel = "map";
function scheduleProfileFileSync() {
  scheduleProfileEntityFileSync({ getBlocks: () => entityBlocks, mapEntityRel });
}

/** Map tab + last sof1maps zip → profile path (`dm/iraq_small`); clipboard/.txt loads skip BSP `loadBspBuffer`. */
function syncMapEntityRelFromSof1mapsUi() {
  let folder = "dm";
  let mapIn = "";
  try {
    folder = ($("#sof1maps-folder") as HTMLSelectElement).value;
    mapIn = ($("#sof1maps-map") as HTMLInputElement).value.trim();
  } catch {
    /* DOM */
  }
  let rel = resolveSof1mapsZipPath(folder, mapIn);
  if (!rel || !rel.toLowerCase().endsWith(".zip")) {
    rel = getLastZipRel() ?? getLastLoadedZipRel() ?? "";
  }
  if (rel && rel.toLowerCase().endsWith(".zip")) mapEntityRel = zipRelToMapPath(rel);
}
let internalEntityText = "";
const markers: THREE.Object3D[] = [];
let selectedIdx: number | null = null;
/** For “mimic height” insert: last entity that was selected (by list or 3D). */
let lastHeightRefIdx: number | null = null;
/** Quake origin of the last inserted entity (for flat ΔX/ΔY chaining). */
let lastSpawnedOrigin: [number, number, number] | null = null;
/** Live list: false = map / entity index order; true = alphabetical by classname. */
let entityListSortAlphabetical = false;
let entityListSortRefreshTimer: number | null = null;
/** First inspector apply after selection change records undo snapshot once. */
let pendingInspectorCommit = false;

const MAX_UNDO = 64;
let undoStack: EntityBlock[][] = [];
let redoStack: EntityBlock[][] = [];
let multiSelected = new Set<number>();

function cloneEntityBlocks(blocks: EntityBlock[]): EntityBlock[] {
  return blocks.map((b) => ({ pairs: b.pairs.map((p) => [...p] as [string, string]) }));
}

function updateUndoRedoUi() {
  const u = document.getElementById("undo-btn") as HTMLButtonElement | null;
  const r = document.getElementById("redo-btn") as HTMLButtonElement | null;
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

function commitHistoryBeforeChange() {
  undoStack.push(cloneEntityBlocks(entityBlocks));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoUi();
}

function applyEntityState(blocks: EntityBlock[]) {
  entityBlocks = cloneEntityBlocks(blocks);
  lastSpawnedOrigin = null;
  if (selectedIdx !== null && selectedIdx >= entityBlocks.length) {
    selectedIdx = entityBlocks.length ? entityBlocks.length - 1 : null;
  }
  pendingInspectorCommit = selectedIdx !== null;
  fillEntityList();
  refreshMarkers();
  refreshProfileExportHints();
  scheduleProfileFileSync();
}

function undoEntityEdit() {
  if (undoStack.length === 0) return;
  redoStack.push(cloneEntityBlocks(entityBlocks));
  applyEntityState(undoStack.pop()!);
  setStatus("Undo");
  updateUndoRedoUi();
}

function redoEntityEdit() {
  if (redoStack.length === 0) return;
  undoStack.push(cloneEntityBlocks(entityBlocks));
  applyEntityState(redoStack.pop()!);
  setStatus("Redo");
  updateUndoRedoUi();
}

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let transform: TransformControls;
/** FPS-style yaw (Y) / pitch (X), radians. Camera rotates in place — no orbit pivot. */
let lookYaw = 0;
let lookPitch = 0;
let lookDrag = false;
let panDrag = false;
const LOOK_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
let rootGroup: THREE.Group;
let meshGroup: THREE.Group;
let entGroup: THREE.Group;
let groupGizmoAnchor: THREE.Object3D | null = null;
let raycaster: THREE.Raycaster;
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const keysDown = new Set<string>();
let shiftKeyHeld = false;
let gizmoLastValidPos: THREE.Vector3 | null = null;
let suppressGizmoSnap = false;
let groupGizmoLastPos: THREE.Vector3 | null = null;
if (typeof window !== "undefined") {
  const syncShift = (e: KeyboardEvent | PointerEvent | MouseEvent) => (shiftKeyHeld = !!e.shiftKey);
  window.addEventListener("keydown", syncShift, true);
  window.addEventListener("keyup", syncShift, true);
  window.addEventListener("pointerdown", syncShift, true);
  window.addEventListener("pointermove", syncShift, true);
}

function isTypingInField(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}

/** Simple AABB intersection in Quake space. */
function aabbIntersects(
  aMins: [number, number, number],
  aMaxs: [number, number, number],
  bMins: [number, number, number],
  bMaxs: [number, number, number],
): boolean {
  return !(
    aMaxs[0] <= bMins[0] ||
    aMins[0] >= bMaxs[0] ||
    aMaxs[1] <= bMins[1] ||
    aMins[1] >= bMaxs[1] ||
    aMaxs[2] <= bMins[2] ||
    aMins[2] >= bMaxs[2]
  );
}

function getEntityAabbForOrigin(
  classname: string,
  origin: [number, number, number],
): { mins: [number, number, number]; maxs: [number, number, number] } {
  const meta = getEntityDefQuakedMeta(classname);
  const hull = meta?.bboxQuake ?? { mins: [-16, -16, -16] as [number, number, number], maxs: [16, 16, 16] as [number, number, number] };
  const [ox, oy, oz] = origin;
  return {
    mins: [ox + hull.mins[0], oy + hull.mins[1], oz + hull.mins[2]],
    maxs: [ox + hull.maxs[0], oy + hull.maxs[1], oz + hull.maxs[2]],
  };
}

function otherEntityOverlapsAabb(
  idx: number,
  thisClass: string,
  thisOrigin: [number, number, number],
): boolean {
  const selfBox = getEntityAabbForOrigin(thisClass, thisOrigin);
  for (let i = 0; i < entityBlocks.length; i++) {
    if (i === idx) continue;
    const o = getPair(entityBlocks[i]!, "origin");
    if (!o) continue;
    const p = parseOrigin(o);
    if (!p) continue;
    const cn = getPair(entityBlocks[i]!, "classname") ?? "?";
    const box = getEntityAabbForOrigin(cn, p);
    if (aabbIntersects(selfBox.mins, selfBox.maxs, box.mins, box.maxs)) return true;
  }
  return false;
}

function quantizeQuakeCoord(n: number): number {
  return Math.round(n);
}

function $(sel: string) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el as HTMLElement;
}

function meshFromBspData(buffer: ArrayBuffer, lumps: BspFile["lumps"]) {
  const { positions, colors, indices } = buildWorldMeshData(buffer, lumps);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const maxIdx = indices.reduce((a, b) => Math.max(a, b), 0);
  if (maxIdx > 65535) geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  else geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function isInfoPlayer(classname: string) {
  return classname.startsWith("info_player_");
}

const ANGLE_FACE_COLOR = 0xffffff;

function setMarkerEmissive(root: THREE.Object3D, hex: number) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = o.material;
      const list = Array.isArray(mats) ? mats : [mats];
      for (const m of list) (m as THREE.MeshLambertMaterial).emissive.setHex(hex);
    }
  });
}

function makeBoxMaterials(
  base: THREE.Color,
  transp?: { transparent: boolean; opacity: number; depthWrite: boolean },
): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial(
    transp ? { color: base, ...transp } : { color: base },
  );
}

/** After `rotation.y = yaw`, local +X is world-forward — highlight BoxGeometry face 0 only (not `faceIndexForYawDegrees`, which would double-apply yaw). */
function makeBoxMaterialsLocalForwardFace(
  base: THREE.Color,
  transp?: { transparent: boolean; opacity: number; depthWrite: boolean },
): THREE.MeshLambertMaterial[] {
  const mats: THREE.MeshLambertMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    const col = i === 0 ? new THREE.Color(ANGLE_FACE_COLOR) : base.clone();
    mats.push(
      new THREE.MeshLambertMaterial(
        transp ? { color: col, ...transp } : { color: col },
      ),
    );
  }
  return mats;
}

/** Matches `makeMarker` base color — for Live list classname styling. */
function entityListClassnameColor(classname: string): string {
  const meta = getEntityDefQuakedMeta(classname);
  if (meta?.colorRgb != null) {
    const c = new THREE.Color(meta.colorRgb[0], meta.colorRgb[1], meta.colorRgb[2]);
    return `#${c.getHexString()}`;
  }
  const hue = hashHue(classname);
  return `#${new THREE.Color().setHSL(hue / 360, 0.65, 0.5).getHexString()}`;
}

function makeMarker(classname: string, yawDeg: number | null): THREE.Object3D {
  const meta = getEntityDefQuakedMeta(classname);
  const hue = hashHue(classname);
  const c =
    meta?.colorRgb != null
      ? new THREE.Color(meta.colorRgb[0], meta.colorRgb[1], meta.colorRgb[2])
      : new THREE.Color().setHSL(hue / 360, 0.65, 0.5);
  if (isInfoPlayer(classname)) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    quakeAabbToThreeBox(PLAYER_SPAWN_HULL_QUAKE.mins, PLAYER_SPAWN_HULL_QUAKE.maxs, size, center);
    const transp = { transparent: true, opacity: 0.4, depthWrite: false };
    const mat = yawDeg === null ? makeBoxMaterials(c, transp) : makeBoxMaterialsLocalForwardFace(c, transp);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(center);
    const g = new THREE.Group();
    g.add(mesh);
    g.userData.classname = classname;
    if (yawDeg !== null) g.rotation.y = (yawDeg * Math.PI) / 180;
    return g;
  }
  if (meta?.bboxQuake) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    quakeAabbToThreeBox(meta.bboxQuake.mins, meta.bboxQuake.maxs, size, center);
    const mat = yawDeg === null ? makeBoxMaterials(c) : makeBoxMaterialsLocalForwardFace(c);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(center);
    const g = new THREE.Group();
    g.add(mesh);
    g.userData.classname = classname;
    if (yawDeg !== null) g.rotation.y = (yawDeg * Math.PI) / 180;
    return g;
  }
  const mat = yawDeg === null ? makeBoxMaterials(c) : makeBoxMaterialsLocalForwardFace(c);
  const m = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), mat);
  m.userData.classname = classname;
  if (yawDeg !== null) m.rotation.y = (yawDeg * Math.PI) / 180;
  return m;
}

function refreshMarkers(skipInspector = false) {
  markers.length = 0;
  entGroup.clear();
  if (groupGizmoAnchor) entGroup.add(groupGizmoAnchor);

  entityBlocks.forEach((block, idx) => {
    const origin = getPair(block, "origin");
    if (!origin) return;
    const p = parseOrigin(origin);
    if (!p) return;
    const cn = getPair(block, "classname") ?? "?";
    const mesh = makeMarker(cn, parseYawDegrees(block));
    mesh.position.copy(quakeToThree(p[0], p[1], p[2]));
    mesh.userData.entityIndex = idx;
    entGroup.add(mesh);
    markers.push(mesh);
  });
  multiSelected = new Set([...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length));
  if (selectedIdx !== null && !multiSelected.has(selectedIdx)) selectedIdx = null;
  if (selectedIdx !== null && !markers.some((m) => m.userData.entityIndex === selectedIdx)) selectedIdx = null;
  if (selectedIdx === null && multiSelected.size > 0) selectedIdx = [...multiSelected].sort((a, b) => a - b).at(-1) ?? null;
  selectEntity(selectedIdx, { skipInspector, preserveSelection: true });
}

let showSidebarPanel: (panel: string) => void = () => {};

function selectEntity(idx: number | null, opts?: { skipInspector?: boolean; additive?: boolean; preserveSelection?: boolean }) {
  const prevSelected = selectedIdx;
  if (opts?.preserveSelection) {
    multiSelected = new Set([...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length));
    selectedIdx = selectedIdx !== null && multiSelected.has(selectedIdx) ? selectedIdx : idx;
  } else if (opts?.additive && idx !== null) {
    if (multiSelected.has(idx)) multiSelected.delete(idx);
    else multiSelected.add(idx);
    selectedIdx = multiSelected.size ? ([...multiSelected].sort((a, b) => a - b).at(-1) ?? null) : null;
  } else {
    multiSelected.clear();
    if (idx !== null) multiSelected.add(idx);
    selectedIdx = idx;
  }
  const changed = selectedIdx !== prevSelected;
  if (selectedIdx !== null) lastHeightRefIdx = selectedIdx;
  if (changed) pendingInspectorCommit = selectedIdx !== null;
  transform.detach();
  for (const m of markers) setMarkerEmissive(m, 0);
  const list = $("#entity-list");
  list.querySelectorAll("li").forEach((li) => {
    const i = Number((li as HTMLElement).dataset.index);
    li.classList.toggle("selected", multiSelected.has(i));
  });
  if (selectedIdx !== null) {
    showSidebarPanel("live");
    list.querySelector(`li[data-index="${selectedIdx}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const sel = [...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length);
  if (sel.length > 1) {
    if (groupGizmoAnchor) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let count = 0;
      for (const i of sel) {
        const mk = markers.find((m) => m.userData.entityIndex === i);
        if (!mk) continue;
        setMarkerEmissive(mk, 0x333333);
        cx += mk.position.x;
        cy += mk.position.y;
        cz += mk.position.z;
        count++;
      }
      if (count > 0) {
        groupGizmoAnchor.position.set(cx / count, cy / count, cz / count);
        transform.attach(groupGizmoAnchor);
      }
    }
  } else if (selectedIdx !== null && selectedIdx >= 0 && selectedIdx < entityBlocks.length) {
    const mk = markers.find((m) => m.userData.entityIndex === selectedIdx);
    if (mk) {
      transform.attach(mk);
      setMarkerEmissive(mk, 0x333333);
    }
  }
  if (!opts?.skipInspector) renderEntityInspector();
}

function entityListRowText(idx: number) {
  const b = entityBlocks[idx]!;
  const cn = getPair(b, "classname") ?? "?";
  const o = getPair(b, "origin") ?? "";
  return `${idx}: ${cn}${o ? ` @ ${o}` : ""}`;
}

function getEntityListDisplayIndices(): number[] {
  const n = entityBlocks.length;
  const inds = Array.from({ length: n }, (_, i) => i);
  if (!entityListSortAlphabetical) return inds;
  return inds.sort((a, b) => {
    const ca = (getPair(entityBlocks[a]!, "classname") ?? "?").toLowerCase();
    const cb = (getPair(entityBlocks[b]!, "classname") ?? "?").toLowerCase();
    const cmp = ca.localeCompare(cb, undefined, { sensitivity: "base" });
    return cmp !== 0 ? cmp : a - b;
  });
}

function updateEntityListSortButton() {
  const btn = document.getElementById("entity-list-sort") as HTMLButtonElement | null;
  if (!btn) return;
  btn.textContent = entityListSortAlphabetical ? "Order: A–Z" : "Order: map";
}

function scheduleEntityListRefreshIfSorted() {
  if (!entityListSortAlphabetical) return;
  if (entityListSortRefreshTimer !== null) window.clearTimeout(entityListSortRefreshTimer);
  entityListSortRefreshTimer = window.setTimeout(() => {
    entityListSortRefreshTimer = null;
    fillEntityList();
  }, 200);
}

function setEntityListRowContent(li: HTMLLIElement, idx: number) {
  const b = entityBlocks[idx]!;
  const cn = getPair(b, "classname") ?? "?";
  const o = getPair(b, "origin") ?? "";
  const t = entityListRowText(idx);
  li.replaceChildren();
  const iSpan = document.createElement("span");
  iSpan.className = "entity-list-idx";
  iSpan.textContent = `${idx}: `;
  const cnSpan = document.createElement("span");
  cnSpan.className = "entity-list-cn";
  cnSpan.textContent = cn;
  cnSpan.style.color = entityListClassnameColor(cn);
  const rest = document.createElement("span");
  rest.className = "entity-list-rest";
  rest.textContent = o ? ` @ ${o}` : "";
  li.append(iSpan, cnSpan, rest);
  li.title = `Select this entity in the view and inspector — ${t}`;
}

function fillEntityList() {
  if (entityListSortRefreshTimer !== null) {
    window.clearTimeout(entityListSortRefreshTimer);
    entityListSortRefreshTimer = null;
  }
  const list = $("#entity-list");
  list.innerHTML = "";
  for (const i of getEntityListDisplayIndices()) {
    const li = document.createElement("li");
    li.dataset.index = String(i);
    setEntityListRowContent(li, i);
    li.classList.toggle("selected", multiSelected.has(i));
    li.addEventListener("click", (e) => {
      const ev = e as MouseEvent;
      selectEntity(i, { additive: ev.ctrlKey || ev.metaKey });
    });
    list.appendChild(li);
  }
}

function updateEntityListRow(idx: number) {
  const item = $("#entity-list").querySelector(`li[data-index="${idx}"]`);
  if (item) setEntityListRowContent(item as HTMLLIElement, idx);
  scheduleEntityListRefreshIfSorted();
}

function readInspectorPairs(): [string, string][] {
  const root = $("#entity-fields");
  const rows = root.querySelectorAll(".field-row");
  const out: [string, string][] = [];
  rows.forEach((row) => {
    const k = (row.querySelector(".field-key") as HTMLInputElement)?.value ?? "";
    const sf = row.querySelector(".spawnflags-int") as HTMLInputElement | null;
    const valEl = row.querySelector("select.field-val, input.field-val") as HTMLInputElement | HTMLSelectElement | null;
    const v = sf
      ? formatSpawnflags(parseSpawnflagsString(sf.value))
      : valEl?.tagName === "SELECT"
        ? (valEl as HTMLSelectElement).value
        : ((valEl as HTMLInputElement | null)?.value ?? "");
    out.push([k, v]);
  });
  return out;
}

function updateGotoButtonState() {
  const btn = document.getElementById("entity-goto") as HTMLButtonElement | null;
  if (!btn || selectedIdx === null || selectedIdx < 0 || selectedIdx >= entityBlocks.length) return;
  const org = getPair(entityBlocks[selectedIdx]!, "origin");
  btn.disabled = !org || !parseOrigin(org);
}

function renderEntityInspector() {
  const panel = $("#entity-inspector");
  const fields = $("#entity-fields");
  const sum = $("#entity-inspector-summary");
  const descEl = document.getElementById("entity-inspector-desc");
  if (selectedIdx === null || selectedIdx < 0 || selectedIdx >= entityBlocks.length) {
    panel.classList.add("is-hidden");
    panel.setAttribute("aria-hidden", "true");
    fields.innerHTML = "";
    sum.textContent = "";
    sum.classList.remove("has-tooltip");
    if (descEl) {
      descEl.textContent = "";
      descEl.hidden = true;
    }
    return;
  }
  panel.classList.remove("is-hidden");
  panel.setAttribute("aria-hidden", "false");
  const b = entityBlocks[selectedIdx]!;
  const cn = getPair(b, "classname") ?? "?";
  sum.textContent = `${cn} · #${selectedIdx} · ${b.pairs.length} field(s)`;
  sum.classList.remove("has-tooltip");
  const descText = getEntityEditorTooltip(cn);
  if (descEl) {
    descEl.textContent = descText;
    descEl.hidden = !descText;
  }
  const keyDl = document.getElementById("entity-fieldnames") as HTMLDataListElement | null;
  if (keyDl) {
    keyDl.innerHTML = "";
    for (const name of getEntityFieldNames(cn)) {
      const opt = document.createElement("option");
      opt.value = name;
      keyDl.appendChild(opt);
    }
  }
  fields.innerHTML = "";
  b.pairs.forEach(([k, v], i) => {
    const row = document.createElement("div");
    row.className = "field-row";
    row.dataset.index = String(i);
    const ki = document.createElement("input");
    ki.className = "field-key";
    ki.type = "text";
    ki.spellcheck = false;
    ki.setAttribute("list", "entity-fieldnames");
    ki.value = k;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "field-del";
    del.title = "Remove field";
    del.textContent = "×";
    if (k === "spawnflags") {
      const valCell = document.createElement("div");
      valCell.className = "field-val-cell";
      valCell.append(buildSpawnflagsEditor(v, cn, () => applyInspectorToScene()));
      row.append(ki, valCell, del);
    } else {
      const opts = getEntityFieldValueOptions(cn, k);
      if (opts?.length) {
        const sel = document.createElement("select");
        sel.className = "field-val field-val-select";
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "—";
        sel.appendChild(ph);
        let matched = false;
        for (const o of opts) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          if (o.value === v) {
            opt.selected = true;
            matched = true;
          }
          sel.appendChild(opt);
        }
        if (v && !matched) {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = v;
          opt.selected = true;
          sel.appendChild(opt);
        }
        row.append(ki, sel, del);
      } else {
        const vi = document.createElement("input");
        vi.className = "field-val";
        vi.type = "text";
        vi.spellcheck = false;
        vi.value = v;
        row.append(ki, vi, del);
      }
    }
    fields.appendChild(row);
  });
  updateGotoButtonState();
}

function applyInspectorToScene() {
  if (selectedIdx === null) return;
  if (pendingInspectorCommit) {
    commitHistoryBeforeChange();
    pendingInspectorCommit = false;
  }
  entityBlocks[selectedIdx]!.pairs = readInspectorPairs();
  refreshMarkers(true);
  updateEntityListRow(selectedIdx);
  updateGotoButtonState();
  scheduleProfileFileSync();
}

function syncOriginFromMarker(marker: THREE.Object3D) {
  if (suppressGizmoSnap) return;
  const idx = marker.userData.entityIndex as number;
  if (idx === undefined || idx < 0 || idx >= entityBlocks.length) return;
  const b = entityBlocks[idx]!;
  const cn = getPair(b, "classname") ?? "?";
  let [qx, qy, qz] = threeToQuake(marker.position);
  if (shiftKeyHeld) {
    if (otherEntityOverlapsAabb(idx, cn, [qx, qy, qz])) {
      if (gizmoLastValidPos) {
        suppressGizmoSnap = true;
        marker.position.copy(gizmoLastValidPos);
        suppressGizmoSnap = false;
        [qx, qy, qz] = threeToQuake(marker.position);
      }
    } else {
      if (!gizmoLastValidPos) gizmoLastValidPos = marker.position.clone();
      else gizmoLastValidPos.copy(marker.position);
    }
  }
  qx = quantizeQuakeCoord(qx);
  qy = quantizeQuakeCoord(qy);
  qz = quantizeQuakeCoord(qz);
  setPair(b, "origin", formatOrigin(qx, qy, qz));
  updateEntityListRow(idx);
  renderEntityInspector();
  scheduleProfileFileSync();
}

function syncOriginsFromGroupGizmo(anchor: THREE.Object3D) {
  if (!groupGizmoLastPos) {
    groupGizmoLastPos = anchor.position.clone();
    return;
  }
  const d = anchor.position.clone().sub(groupGizmoLastPos);
  if (d.lengthSq() < 1e-12) return;
  const sel = [...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length);
  for (const i of sel) {
    const mk = markers.find((m) => m.userData.entityIndex === i);
    if (!mk) continue;
    mk.position.add(d);
    const [qx0, qy0, qz0] = threeToQuake(mk.position);
    const qx = quantizeQuakeCoord(qx0);
    const qy = quantizeQuakeCoord(qy0);
    const qz = quantizeQuakeCoord(qz0);
    mk.position.copy(quakeToThree(qx, qy, qz));
    setPair(entityBlocks[i]!, "origin", formatOrigin(qx, qy, qz));
    updateEntityListRow(i);
  }
  groupGizmoLastPos.copy(anchor.position);
  renderEntityInspector();
  scheduleProfileFileSync();
}

function setStatus(msg: string, err?: boolean) {
  const el = $("#status");
  el.textContent = msg;
  el.style.color = err ? "#e88" : "";
}

function syncCameraLook() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = lookYaw;
  camera.rotation.x = lookPitch;
}

function gotoSelectedEntity() {
  if (selectedIdx === null) return;
  const b = entityBlocks[selectedIdx]!;
  const o = getPair(b, "origin");
  if (!o) {
    setStatus("No origin on this entity", true);
    return;
  }
  const p = parseOrigin(o);
  if (!p) {
    setStatus("Invalid origin", true);
    return;
  }
  const target = quakeToThree(p[0], p[1], p[2]);
  const d = 280;
  camera.position.copy(target).add(new THREE.Vector3(d * 0.45, d * 0.38, d * 0.48));
  camera.lookAt(target);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  lookPitch = e.x;
  lookYaw = e.y;
  syncCameraLook();
  setStatus(`Camera → #${selectedIdx} (${getPair(b, "classname") ?? "?"})`);
}

/** Area-weighted mean of triangle centroids (shell “center of mass” for uniform density). */
function triangleAreaWeightedCentroid(geo: THREE.BufferGeometry): THREE.Vector3 | null {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  const idx = geo.index;
  const pa = pos?.array as Float32Array | undefined;
  if (!pos?.count || !pa || !idx || idx.count < 3) return null;
  const ia = idx.array as Uint32Array | Uint16Array;
  let sx = 0,
    sy = 0,
    sz = 0,
    wsum = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const o0 = ia[t]! * 3,
      o1 = ia[t + 1]! * 3,
      o2 = ia[t + 2]! * 3;
    const x0 = pa[o0]!,
      y0 = pa[o0 + 1]!,
      z0 = pa[o0 + 2]!;
    const x1 = pa[o1]!,
      y1 = pa[o1 + 1]!,
      z1 = pa[o1 + 2]!;
    const x2 = pa[o2]!,
      y2 = pa[o2 + 1]!,
      z2 = pa[o2 + 2]!;
    const mx = (x0 + x1 + x2) / 3,
      my = (y0 + y1 + y2) / 3,
      mz = (z0 + z1 + z2) / 3;
    const abx = x1 - x0,
      aby = y1 - y0,
      abz = z1 - z0;
    const acx = x2 - x0,
      acy = y2 - y0,
      acz = z2 - z0;
    const cx = aby * acz - abz * acy,
      cy = abz * acx - abx * acz,
      cz = abx * acy - aby * acx;
    const w = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (w > 1e-12) {
      sx += mx * w;
      sy += my * w;
      sz += mz * w;
      wsum += w;
    }
  }
  if (wsum < 1e-20) return null;
  return new THREE.Vector3(sx / wsum, sy / wsum, sz / wsum);
}

function vertexMeanCenter(geo: THREE.BufferGeometry): THREE.Vector3 | null {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  const pa = pos?.array as Float32Array | undefined;
  if (!pos?.count || !pa) return null;
  const n = pos.count;
  let sx = 0,
    sy = 0,
    sz = 0;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    sx += pa[o]!;
    sy += pa[o + 1]!;
    sz += pa[o + 2]!;
  }
  const inv = 1 / n;
  return new THREE.Vector3(sx * inv, sy * inv, sz * inv);
}

function model0BoundsCenterThree(buffer: ArrayBuffer, lumps: BspFile["lumps"]): THREE.Vector3 | null {
  try {
    const m = readModel0(buffer, lumps);
    const qx = (m.mins[0] + m.maxs[0]) * 0.5;
    const qy = (m.mins[1] + m.maxs[1]) * 0.5;
    const qz = (m.mins[2] + m.maxs[2]) * 0.5;
    return quakeToThree(qx, qy, qz);
  } catch {
    return null;
  }
}

/** Camera at map center of mass; short look-ahead so view matrix is stable (not degenerate lookAt). */
function frameCameraToMap(mesh: THREE.Mesh, buffer: ArrayBuffer, lumps: BspFile["lumps"]) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const com =
    triangleAreaWeightedCentroid(geo) ?? vertexMeanCenter(geo) ?? model0BoundsCenterThree(buffer, lumps) ?? bb.getCenter(new THREE.Vector3());
  const size = new THREE.Vector3();
  bb.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 64);
  const step = Math.max(maxDim * 0.06, 48);
  camera.position.copy(com);
  camera.lookAt(com.x + step * 0.65, com.y + maxDim * 0.025, com.z + step * 0.55);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  lookPitch = e.x;
  lookYaw = e.y;
  syncCameraLook();
}

function loadBspBuffer(buf: ArrayBuffer, name: string, opts?: { mapEntityRel?: string; statusExtra?: string }) {
  commitHistoryBeforeChange();
  bspName = name.replace(/\.bsp$/i, "") || "map";
  mapEntityRel = opts?.mapEntityRel ?? sanitizeMapRelPath(bspName);
  meshGroup.clear();
  const bsp = parseBsp(buf);
  const mesh = meshFromBspData(bsp.buffer, bsp.lumps);
  meshGroup.add(mesh);
  frameCameraToMap(mesh, bsp.buffer, bsp.lumps);
  internalEntityText = bsp.entityString;
  entityBlocks = parseEntityString(sanitizeEntText(internalEntityText));
  lastSpawnedOrigin = null;
  fillEntityList();
  refreshMarkers();
  refreshProfileExportHints();
  const extra = opts?.statusExtra;
  setStatus(
    `Loaded ${name} (${entityBlocks.length} entities)${extra ? ` — ${extra}` : ""}`,
  );
  void tryLoadProfileMapEntities();
}

async function loadSof1mapsZipRel(rel: string, opts?: { disableFetchBtn?: boolean }) {
  const disableBtn = opts?.disableFetchBtn !== false;
  const btn = $("#sof1maps-fetch") as HTMLButtonElement;
  if (disableBtn) btn.disabled = true;
  setStatus(`Fetching plowsof/sof1maps: ${rel}…`);
  try {
    const { bspName: bn, bsp, zipFromCache } = await fetchBspFromSof1mapsZip(rel);
    const cacheHint = zipFromCache
      ? "zip from IndexedDB cache"
      : "zip downloaded (stored in IndexedDB for next time)";
    loadBspBuffer(bsp, bn, {
      mapEntityRel: zipRelToMapPath(rel),
      statusExtra: `sof1maps ${rel}; ${cacheHint}`,
    });
    setLastLoadedZipRel(rel);
    recordSof1mapsOpen(rel);
    applySof1mapsFieldsFromRel(rel);
    refreshRecentMapsUi();
    refreshMapPlaylistUi();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    throw e;
  } finally {
    if (disableBtn) btn.disabled = false;
  }
}

async function loadBspFromSof1maps() {
  const folder = ($("#sof1maps-folder") as HTMLSelectElement).value;
  const mapIn = ($("#sof1maps-map") as HTMLInputElement).value.trim();
  const rel = resolveSof1mapsZipPath(folder, mapIn || "doom2sof");
  if (!rel || !rel.toLowerCase().endsWith(".zip")) {
    setStatus("Enter a map name (e.g. doom2sof) or full path ending in .zip", true);
    return;
  }
  await loadSof1mapsZipRel(rel);
}

function applySof1mapsFieldsFromRel(rel: string) {
  const parts = rel.split("/").filter(Boolean);
  const zipFile = parts[parts.length - 1] ?? "";
  const stem = zipFile.replace(/\.zip$/i, "");
  if (parts.length >= 2) {
    const folder = parts[0]!;
    const folderSel = $("#sof1maps-folder") as HTMLSelectElement;
    if ([...folderSel.options].some((o) => o.value === folder)) folderSel.value = folder;
  }
  ($("#sof1maps-map") as HTMLInputElement).value = stem;
}

/** Gap index 0..n for drop (n = after last row). */
function playlistDropIndexFromPoint(e: DragEvent, ul: HTMLElement, n: number): number {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const li = el?.closest?.(".map-pl-entry") as HTMLElement | null;
  if (li && ul.contains(li)) {
    const i = Number(li.dataset.plIdx);
    if (Number.isFinite(i)) {
      const r = li.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      return e.clientY < mid ? i : i + 1;
    }
  }
  const rows = ul.querySelectorAll<HTMLElement>(".map-pl-entry");
  if (!rows.length) return 0;
  const first = rows[0]!.getBoundingClientRect();
  const last = rows[rows.length - 1]!.getBoundingClientRect();
  if (e.clientY < first.top) return 0;
  if (e.clientY > last.bottom) return n;
  return n;
}

function syncMapEntryRowColor(li: HTMLLIElement, index: number) {
  const pl = getActivePlaylist();
  const col = pl?.entries[index]?.color;
  const valid = !!(col && (MAP_ENTRY_COLORS as readonly string[]).includes(col));
  for (const c of MAP_ENTRY_COLORS) li.classList.remove(`map-pl-entry--c-${c}`);
  if (valid) li.classList.add(`map-pl-entry--c-${col}`);
  const cb = li.querySelector(".map-pl-entry-color-btn");
  if (cb) {
    cb.className =
      "map-pl-entry-color-btn" + (valid ? ` map-pl-entry-color-btn--${col}` : " map-pl-entry-color-btn--none");
  }
}

function refreshMapPlaylistUi() {
  const sel = $("#map-pl-select") as HTMLSelectElement;
  const pos = $("#map-pl-pos");
  const ul = $("#map-pl-entries");
  const prev = $("#map-pl-prev") as HTMLButtonElement;
  const next = $("#map-pl-next") as HTMLButtonElement;
  const lists = getPlaylists();
  const wantedId = getActiveId();
  sel.innerHTML = "";
  for (const pl of lists) {
    const o = document.createElement("option");
    o.value = pl.id;
    o.textContent = `${pl.name} (${pl.entries.length})`;
    sel.appendChild(o);
  }
  if (!lists.length) {
    sel.disabled = true;
    pos.textContent = "—";
    closeMapPlColorPopover();
    ul.innerHTML = "";
    prev.disabled = true;
    next.disabled = true;
    return;
  }
  sel.disabled = false;
  const pick = wantedId && lists.some((p) => p.id === wantedId) ? wantedId : lists[0]!.id;
  sel.value = pick;
  if (pick !== wantedId) setActivePlaylistId(pick);
  pos.textContent = getPlaylistLabel();
  const pl = getActivePlaylist();
  const n = pl?.entries.length ?? 0;
  const ci = getCurrentIndex();
  prev.disabled = !n;
  next.disabled = !n;
  closeMapPlColorPopover();
  ul.innerHTML = "";
  if (!pl?.entries.length) return;
  pl.entries.forEach((ent, i) => {
    const path = ent.path;
    const li = document.createElement("li");
    li.className = "map-pl-entry" + (ci >= 0 && i === ci ? " map-pl-entry--current" : "");
    li.dataset.plIdx = String(i);
    const grip = document.createElement("span");
    grip.className = "map-pl-entry-grip";
    grip.title = "Drag to reorder";
    grip.textContent = "⋮⋮";
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
      mapPlDragFrom = i;
      e.dataTransfer?.setData("text/plain", String(i));
      e.dataTransfer!.effectAllowed = "move";
      li.classList.add("map-pl-entry--dragging");
    });
    grip.addEventListener("dragend", () => {
      mapPlDragFrom = -1;
      li.classList.remove("map-pl-entry--dragging");
    });
    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "map-pl-entry-color-btn map-pl-entry-color-btn--none";
    colorBtn.title = "Choose row colour";
    colorBtn.draggable = false;
    colorBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (mapPlColorPopoverIdx === i) closeMapPlColorPopover();
      else openMapPlColorPopover(colorBtn, li, i);
    });
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "map-pl-entry-path";
    loadBtn.title = "Load this map";
    loadBtn.textContent = path;
    loadBtn.draggable = false;
    loadBtn.addEventListener("click", () => void loadPlaylistMapAtIndex(i));
    const noteIn = document.createElement("input");
    noteIn.type = "text";
    noteIn.className = "map-pl-entry-note";
    noteIn.spellcheck = false;
    noteIn.placeholder = "Note…";
    noteIn.title = "Short note (saved when you leave the field or press Enter)";
    noteIn.value = ent.note ?? "";
    noteIn.draggable = false;
    noteIn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        noteIn.blur();
      }
    });
    noteIn.addEventListener("blur", () => {
      if (noteIn.value.trim() !== (ent.note ?? "").trim()) setActiveEntryNote(i, noteIn.value);
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "map-pl-entry-rm";
    rm.title = "Remove from list";
    rm.textContent = "×";
    rm.draggable = false;
    rm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeEntryAt(i);
      refreshMapPlaylistUi();
    });
    li.append(grip, colorBtn, loadBtn, noteIn, rm);
    syncMapEntryRowColor(li, i);
    ul.appendChild(li);
  });
}

async function loadPlaylistMap(go: () => string | null) {
  const rel = go();
  if (!rel) {
    setStatus("This list has no maps yet.", true);
    return;
  }
  try {
    await loadSof1mapsZipRel(rel, { disableFetchBtn: true });
    applySof1mapsFieldsFromRel(rel);
    refreshMapPlaylistUi();
  } catch {
    refreshMapPlaylistUi();
  }
}

async function loadPlaylistMapAtIndex(i: number) {
  const rel = jumpToEntryIndex(i);
  if (!rel) {
    setStatus("This list has no maps yet.", true);
    return;
  }
  try {
    await loadSof1mapsZipRel(rel, { disableFetchBtn: true });
    applySof1mapsFieldsFromRel(rel);
    refreshMapPlaylistUi();
  } catch {
    refreshMapPlaylistUi();
  }
}

function sanitizeEntText(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let raw of lines) {
    let line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (trimmed.startsWith("//")) continue;
    if (trimmed === "`" || trimmed === "```") continue;
    let inQuote = false;
    let result = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') inQuote = !inQuote;
      if (!inQuote && c === "/" && line[i + 1] === "/") {
        break;
      }
      result += c;
    }
    if (result.trim()) out.push(result);
  }
  return out.join("\n");
}

function loadEntText(text: string, statusMsg?: string) {
  syncMapEntityRelFromSof1mapsUi();
  commitHistoryBeforeChange();
  entityBlocks = parseEntityString(sanitizeEntText(text));
  lastSpawnedOrigin = null;
  fillEntityList();
  refreshMarkers();
  refreshProfileExportHints();
  setStatus(statusMsg ?? `Entity file — ${entityBlocks.length} blocks`);
  scheduleProfileFileSync();
}

/**
 * Dev: GET `/api/load-entity-profile` reads `entity-profiles/…` from disk (writes are ignored by Vite glob).
 * Prod / preview: `import.meta.glob` bundle only.
 */
async function tryLoadProfileMapEntities() {
  const slug = getCurrentProfileSlug();
  if (!slug || !mapEntityRel) {
    refreshProfileExportHints();
    scheduleProfileFileSync();
    return;
  }
  const p = sanitizeProfileSlug(slug);
  const mr = sanitizeMapRelPath(mapEntityRel);
  let text: string | undefined;
  if (import.meta.env.DEV) {
    try {
      const r = await fetch(
        `/api/load-entity-profile?profile=${encodeURIComponent(p)}&mapRel=${encodeURIComponent(mr)}`
      );
      if (r.ok) text = await r.text();
    } catch {
      /* offline */
    }
  }
  if (text === undefined) text = getBundledMapEntityText(p, mr);
  if (getCurrentProfileSlug() !== slug || sanitizeMapRelPath(mapEntityRel) !== mr) return;
  if (text !== undefined) {
    commitHistoryBeforeChange();
    entityBlocks = parseEntityString(sanitizeEntText(text));
    lastSpawnedOrigin = null;
    fillEntityList();
    refreshMarkers();
    refreshProfileExportHints();
    setStatus(`Loaded entity-profiles/${p}/${mr}.txt (${entityBlocks.length} blocks)`);
  } else {
    refreshProfileExportHints();
  }
  scheduleProfileFileSync();
}

async function loadEntFromClipboard() {
  if (!navigator.clipboard?.readText) {
    setStatus("Clipboard API not available in this browser/context", true);
    return;
  }
  try {
    const txt = await navigator.clipboard.readText();
    const t = txt.trim();
    if (!t) {
      setStatus("Clipboard is empty", true);
      return;
    }
    bspName = "clipboard";
    loadEntText(t);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Failed to read clipboard", true);
  }
}

function loadInternalEntities() {
  if (!internalEntityText.trim()) {
    setStatus("No BSP internal entities loaded yet", true);
    return;
  }
  loadEntText(internalEntityText);
  setStatus(`Loaded internal BSP entities (${entityBlocks.length} blocks)`);
}

function exportEnt() {
  const text = serializeEntityString(entityBlocks);
  const slug = getCurrentProfileSlug();
  if (slug) {
    const p = sanitizeProfileSlug(slug);
    const mr = sanitizeMapRelPath(mapEntityRel);
    const zip = buildProfileMapEntityZip(slug, mapEntityRel, text);
    const blob = new Blob([zip], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${p}-${mr.replace(/\//g, "_")}-entities.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Exported zip — unpack at repo root → ${p}/${mr}.txt`);
  } else {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${bspName}_ent.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Exported ${bspName}_ent.txt`);
  }
}

function refreshEntityClassnamesDatalist() {
  const dl = $("#entity-classnames");
  dl.innerHTML = "";
  for (const name of getAllQrkClassnames()) {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  }
}

function refreshProfileExportHints() {
  const slug = getCurrentProfileSlug();
  const sSlug = slug ? sanitizeProfileSlug(slug) : "";
  const mr = sanitizeMapRelPath(mapEntityRel);
  const ex = document.getElementById("entities-export-hint");
  if (ex) {
    ex.textContent = slug
      ? `Profile “${sSlug}”: zip contains ${sSlug}/${mr}.txt (unpack at repo root). Map id: ${mr}.`
      : "No profile: single .txt download.";
  }
  const ph = document.getElementById("ent-profile-path-hint");
  if (ph) {
    ph.textContent = slug
      ? `Edit: entity-profiles/${sSlug}/${mr}.txt · Export zip: ${sSlug}/${mr}.txt${
          import.meta.env.DEV ? " · Dev server writes this file as you edit." : ""
        }`
      : "Pick a profile to group entity files by map path (e.g. dm/iraq_small).";
  }
}

function populateProfileSelect() {
  const sel = $("#ent-profile-current") as HTMLSelectElement;
  const cur = getCurrentProfileSlug();
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "(none)";
  sel.appendChild(o0);
  const slugs = new Set(listBundledProfileSlugs());
  if (cur) slugs.add(cur);
  for (const s of [...slugs].sort((a, b) => a.localeCompare(b))) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    sel.appendChild(o);
  }
  sel.value = cur ?? "";
}

/** Fly: move in camera space (WASD + Q/E). No separate orbit target — view is FPS rotation. */
function applyViewNavigation(dt: number) {
  if (transform.dragging) return;
  if (isTypingInField()) return;
  const base = (keysDown.has("AltLeft") || keysDown.has("AltRight") ? 2.75 : 1) * 420 * dt;
  const v = new THREE.Vector3();
  if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) v.z -= 1;
  if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) v.z += 1;
  if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) v.x -= 1;
  if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) v.x += 1;
  if (keysDown.has("KeyQ")) v.y -= 1;
  if (keysDown.has("KeyE")) v.y += 1;
  if (v.lengthSq() < 1e-8) return;
  v.normalize().multiplyScalar(base);
  v.applyQuaternion(camera.quaternion);
  camera.position.add(v);
}

/** Short forward offset so the entity spawns just in front of the view (not at the crosshair far plane). */
const INSERT_DIST_IN_FRONT = 96;
const INSERT_DIST_AHEAD = 320;

function readInsertFlatOffset(): { dx: number; dy: number; stride: number } {
  const dx = parseFloat((document.getElementById("insert-offset-dx") as HTMLInputElement)?.value ?? "0");
  const dy = parseFloat((document.getElementById("insert-offset-dy") as HTMLInputElement)?.value ?? "0");
  const stride = parseFloat((document.getElementById("insert-offset-stride") as HTMLInputElement)?.value ?? "64");
  return {
    dx: Number.isFinite(dx) ? dx : 0,
    dy: Number.isFinite(dy) ? dy : 0,
    stride: Number.isFinite(stride) && stride > 0 ? stride : 64,
  };
}

function bumpInsertFlatOffset(axis: "x" | "y", sign: 1 | -1) {
  const id = axis === "x" ? "insert-offset-dx" : "insert-offset-dy";
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const { stride } = readInsertFlatOffset();
  const cur = parseFloat(el.value || "0");
  el.value = String((Number.isFinite(cur) ? cur : 0) + sign * stride);
}

function insertEntityAlongView(units: number) {
  const cn = (($("#insert-class") as HTMLInputElement).value || "").trim();
  if (!cn) {
    setStatus("Enter a classname to insert.", true);
    return;
  }
  commitHistoryBeforeChange();
  pendingInspectorCommit = false;
  const aim = new THREE.Vector3();
  camera.getWorldDirection(aim);
  const worldAim = camera.position.clone().addScaledVector(aim, units);
  const relEl = document.getElementById("insert-spawn-relative") as HTMLInputElement | null;
  const wantRel = !!relEl?.checked;
  const { dx, dy } = readInsertFlatOffset();
  const anchor = lastSpawnedOrigin;
  let fromLastSpawn = false;
  let qx: number;
  let qy: number;
  let qz: number;
  if (wantRel && anchor) {
    qx = anchor[0] + dx;
    qy = anchor[1] + dy;
    qz = anchor[2];
    fromLastSpawn = true;
  } else {
    [qx, qy, qz] = threeToQuake(worldAim);
  }
  const mimicEl = document.getElementById("insert-mimic-height") as HTMLInputElement | null;
  if (mimicEl?.checked && lastHeightRefIdx !== null && lastHeightRefIdx < entityBlocks.length) {
    const ref = entityBlocks[lastHeightRefIdx]!;
    const org = getPair(ref, "origin");
    const p = org && parseOrigin(org);
    if (p) {
      qz = p[2];
      const refCn = getPair(ref, "classname") ?? "?";
      const minsZ = getEntityDefQuakedMeta(refCn)?.bboxQuake?.mins[2] ?? 0;
      if (minsZ < 0) qz += minsZ;
    }
  }
  entityBlocks.push({
    pairs: [
      ["classname", cn],
      ["origin", formatOrigin(qx, qy, qz)],
    ],
  });
  lastSpawnedOrigin = [qx, qy, qz];
  fillEntityList();
  refreshMarkers();
  selectEntity(entityBlocks.length - 1);
  const base = `Inserted ${cn} @ ${formatOrigin(qx, qy, qz)} (${fromLastSpawn ? "last spawn + ΔX/ΔY" : `${units}u from camera`})`;
  setStatus(wantRel && !anchor ? `${base} — no prior spawn yet, used camera.` : base, !!(wantRel && !anchor));
  scheduleProfileFileSync();
}

function cloneSelectedEntity() {
  const indices = multiSelected.size
    ? [...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length).sort((a, b) => a - b)
    : selectedIdx !== null && selectedIdx >= 0 && selectedIdx < entityBlocks.length
      ? [selectedIdx]
      : [];
  if (!indices.length) {
    setStatus("Select one or more entities to duplicate.", true);
    return;
  }
  commitHistoryBeforeChange();
  pendingInspectorCommit = false;
  const blocks: EntityBlock[] = [];
  for (const i of indices) {
    const src = entityBlocks[i]!;
    blocks.push({ pairs: src.pairs.map((p) => [...p] as [string, string]) });
  }
  const insertAt = indices[indices.length - 1] + 1;
  entityBlocks.splice(insertAt, 0, ...blocks);
  const lastDup = blocks[blocks.length - 1]!;
  const org = getPair(lastDup, "origin");
  const p = org ? parseOrigin(org) : null;
  if (p) lastSpawnedOrigin = p;
  fillEntityList();
  refreshMarkers();
  refreshProfileExportHints();
  multiSelected = new Set<number>();
  const newIndices: number[] = [];
  for (let j = 0; j < blocks.length; j++) {
    newIndices.push(insertAt + j);
    multiSelected.add(insertAt + j);
  }
  const primary = newIndices[newIndices.length - 1]!;
  selectedIdx = primary;
  selectEntity(primary, { skipInspector: false });
  setStatus(
    blocks.length === 1
      ? `Duplicated #${indices[0]} → #${primary} (${getPair(lastDup, "classname") ?? "?"}) — same origin`
      : `Duplicated ${blocks.length} entities starting at #${indices[0]} → #${insertAt}`,
  );
  scheduleProfileFileSync();
}

function deleteSelectedEntity() {
  const indices = multiSelected.size
    ? [...multiSelected].filter((i) => i >= 0 && i < entityBlocks.length).sort((a, b) => a - b)
    : selectedIdx !== null && selectedIdx >= 0 && selectedIdx < entityBlocks.length
      ? [selectedIdx]
      : [];
  if (!indices.length) {
    setStatus("Select one or more entities to remove.", true);
    return;
  }
  commitHistoryBeforeChange();
  pendingInspectorCommit = false;
  for (let k = indices.length - 1; k >= 0; k--) {
    const i = indices[k]!;
    entityBlocks.splice(i, 1);
    if (lastHeightRefIdx !== null) {
      if (lastHeightRefIdx === i) lastHeightRefIdx = null;
      else if (lastHeightRefIdx > i) lastHeightRefIdx--;
    }
  }
  fillEntityList();
  refreshMarkers();
  refreshProfileExportHints();
  const n = entityBlocks.length;
  multiSelected.clear();
  if (n === 0) {
    selectEntity(null);
  } else {
    const next = Math.min(indices[0]!, n - 1);
    selectEntity(next);
  }
  scheduleProfileFileSync();
}

function initThree() {
  const container = $("#viewport");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1f);

  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 1e6);
  camera.position.set(0, 400, 1200);
  lookYaw = 0;
  lookPitch = -0.15;
  syncCameraLook();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const el = renderer.domElement;
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener(
    "wheel",
    (e) => {
      if (isTypingInField() || transform.dragging) return;
      e.preventDefault();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const step = Math.sign(e.deltaY) * Math.min(120, Math.abs(e.deltaY)) * 1.8;
      camera.position.addScaledVector(dir, -step);
    },
    { passive: false }
  );

  el.addEventListener("pointerdown", (e: PointerEvent) => {
    if (isTypingInField() || transform.dragging) return;
    if (e.button === 2) {
      lookDrag = true;
      el.setPointerCapture(e.pointerId);
    } else if (e.button === 1) {
      panDrag = true;
      el.setPointerCapture(e.pointerId);
    }
  });
  el.addEventListener("pointermove", (e: PointerEvent) => {
    if (transform.dragging) return;
    if (lookDrag) {
      lookYaw -= e.movementX * LOOK_SENS;
      lookPitch -= e.movementY * LOOK_SENS;
      lookPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, lookPitch));
      syncCameraLook();
    } else if (panDrag) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const up = camera.up.clone();
      camera.position.addScaledVector(right, -e.movementX * 0.35);
      camera.position.addScaledVector(up, e.movementY * 0.35);
    }
  });
  el.addEventListener("pointerup", (e: PointerEvent) => {
    if (e.button === 2) lookDrag = false;
    if (e.button === 1) panDrag = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
  });
  el.addEventListener("pointercancel", () => {
    lookDrag = false;
    panDrag = false;
  });

  transform = new TransformControls(camera, renderer.domElement);
  transform.setMode("translate");
  transform.addEventListener("objectChange", () => {
    const o = transform.object;
    if (!o) return;
    if (o === groupGizmoAnchor) syncOriginsFromGroupGizmo(o);
    else syncOriginFromMarker(o);
  });
  transform.addEventListener("dragging-changed", (e) => {
    if (e.value === true) {
      commitHistoryBeforeChange();
      pendingInspectorCommit = false;
      gizmoLastValidPos = transform.object?.position.clone() ?? null;
      if (transform.object === groupGizmoAnchor) groupGizmoLastPos = transform.object.position.clone();
    }
    if (e.value === false) {
      gizmoLastValidPos = null;
      groupGizmoLastPos = null;
    }
  });
  scene.add(transform.getHelper());

  scene.add(new THREE.AmbientLight(0x606070));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(1, 2, 1);
  scene.add(dl);

  rootGroup = new THREE.Group();
  scene.add(rootGroup);
  meshGroup = new THREE.Group();
  entGroup = new THREE.Group();
  rootGroup.add(meshGroup);
  rootGroup.add(entGroup);
  groupGizmoAnchor = new THREE.Object3D();
  groupGizmoAnchor.visible = false;
  entGroup.add(groupGizmoAnchor);

  scene.add(new THREE.GridHelper(10_000, 100, 0x444444, 0x333333));

  raycaster = new THREE.Raycaster();

  const dz = $("#drop-zone");
  dz.addEventListener("pointerdown", () => dz.focus());
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && !isTypingInField()) {
      selectEntity(null);
      e.preventDefault();
      return;
    }
    if (isTypingInField()) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redoEntityEdit();
      else undoEntityEdit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
      e.preventDefault();
      redoEntityEdit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      cloneSelectedEntity();
      return;
    }
    if (e.code === "Delete") {
      if (selectedIdx === null) return;
      e.preventDefault();
      deleteSelectedEntity();
      return;
    }
    keysDown.add(e.code);
  });
  window.addEventListener("keyup", (e) => keysDown.delete(e.code));

  $("#view-hint").innerHTML =
    "<strong>Look</strong> hold <strong>right mouse</strong> drag (FPS mouselook)<br>" +
    "<strong>Fly</strong> WASD · Q/E · <strong>Alt</strong> faster · <strong>wheel</strong> zoom along view · <strong>middle drag</strong> pan<br>" +
    "<strong>Entity</strong> left-click marker or <strong>Live</strong> list · <strong>Esc</strong> deselect · <strong>Delete</strong> remove · <strong>Ctrl+Shift+D</strong> duplicate · <strong>gizmo</strong> moves selection";

  el.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    if (transform.dragging) return;
    const r = container.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Do not raycast transform.getHelper(): it includes a huge internal drag plane that
    // blocks picking entities behind/along the ray. TransformControls runs first and sets
    // dragging when a handle is used; we only pick markers here.
    const hits = raycaster.intersectObjects(markers, true);
    if (hits.length > 0) {
      let o: THREE.Object3D | null = hits[0]!.object;
      while (o && o.userData.entityIndex === undefined) o = o.parent;
      const idx = o?.userData.entityIndex as number | undefined;
      if (typeof idx === "number") selectEntity(idx, { additive: ev.ctrlKey || ev.metaKey });
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const mapNameHud = $("#map-name-hud");
  const hud = $("#camera-pos-hud");

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    applyViewNavigation(dt);
    mapNameHud.textContent = bspName;
    const [qx, qy, qz] = threeToQuake(camera.position);
    const r = (n: number) => n.toFixed(2);
    hud.innerHTML = `<span class="label">Camera (game units)</span>${r(qx)} ${r(qy)} ${r(qz)}`;
    renderer.render(scene, camera);
  }
  animate();
}

function refreshEntProfileBundledList() {
  const list = listBundledMapTxts();
  $("#ent-profile-bundled-count").textContent = String(list.length);
  const ul = $("#ent-profile-bundled-list");
  ul.innerHTML = "";
  const max = 100;
  for (let i = 0; i < Math.min(list.length, max); i++) {
    const f = list[i]!;
    const li = document.createElement("li");
    li.textContent = f.repoPath;
    li.title = f.text.trim().slice(0, 400);
    ul.appendChild(li);
  }
  if (list.length > max) {
    const li = document.createElement("li");
    li.textContent = `… ${list.length - max} more`;
    ul.appendChild(li);
  }
}

function renderToolboxClassPicker(container: HTMLElement, node: ToolboxNode) {
  if (node.type === "entity") return;
  for (const ch of node.children) {
    if (ch.type === "folder") {
      const det = document.createElement("details");
      det.className = "class-group";
      const sum = document.createElement("summary");
      sum.textContent = ch.label;
      sum.title = `Expand or collapse “${ch.label}” classnames`;
      det.appendChild(sum);
      const body = document.createElement("div");
      body.className = "class-group-body";
      renderToolboxClassPicker(body, ch);
      det.appendChild(body);
      container.appendChild(det);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "class-pick";
      btn.textContent = ch.classname;
      btn.title = ch.desc
        ? `${ch.desc} — Click to fill the classname field below.`
        : `Click to fill the classname field with “${ch.classname}”.`;
      btn.addEventListener("click", () => {
        ($("#insert-class") as HTMLInputElement).value = ch.classname;
        setStatus(`Class: ${ch.classname}`);
      });
      container.appendChild(btn);
    }
  }
}

function initSidebarTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar-tab"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".sidebar-panel"));
  function show(panel: string) {
    tabs.forEach((tab) => {
      const on = tab.dataset.panel === panel;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => {
      const id = p.id.replace("sidebar-panel-", "");
      p.hidden = id !== panel;
    });
  }
  showSidebarPanel = show;
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => show(tab.dataset.panel ?? "map"));
  });
}

function initUI() {
  initSidebarTabs();

  $("#entity-list-sort").addEventListener("click", () => {
    entityListSortAlphabetical = !entityListSortAlphabetical;
    updateEntityListSortButton();
    fillEntityList();
  });
  updateEntityListSortButton();

  const folderSel = $("#sof1maps-folder") as HTMLSelectElement;
  const mapInEl = $("#sof1maps-map") as HTMLInputElement;
  for (const f of SOF1MAPS_FOLDERS) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f;
    folderSel.appendChild(o);
  }
  applyMapCacheToUi(folderSel, mapInEl);

  const recentSel = document.getElementById("map-recent-select") as HTMLSelectElement | null;
  refreshRecentMapsUi = () => {
    if (recentSel) populateMapRecentSelect(recentSel);
  };
  refreshRecentMapsUi();
  recentSel?.addEventListener("change", () => {
    const v = recentSel.value.trim();
    if (!v) return;
    void loadSof1mapsZipRel(v).finally(() => {
      if (recentSel) recentSel.selectedIndex = 0;
    });
  });

  refreshEntityClassnamesDatalist();
  renderToolboxClassPicker($("#entity-class-groups"), getToolboxRoot());

  $("#sof1maps-fetch").addEventListener("click", () => void loadBspFromSof1maps());
  const autoloadEl = $("#sof1maps-autoload") as HTMLInputElement;
  autoloadEl.checked = loadAutoloadCheckbox();
  autoloadEl.addEventListener("change", () => saveAutoloadCheckbox(autoloadEl.checked));
  $("#map-pl-select").addEventListener("change", () => {
    setActivePlaylistId(($("#map-pl-select") as HTMLSelectElement).value || null);
    refreshMapPlaylistUi();
  });
  $("#map-pl-new-btn").addEventListener("click", () => {
    const name = ($("#map-pl-new-name") as HTMLInputElement).value.trim();
    addPlaylist(name || "Untitled");
    ($("#map-pl-new-name") as HTMLInputElement).value = "";
    refreshMapPlaylistUi();
  });
  $("#map-pl-add").addEventListener("click", () => {
    const folder = ($("#sof1maps-folder") as HTMLSelectElement).value;
    const mapIn = ($("#sof1maps-map") as HTMLInputElement).value.trim();
    let rel = getLastLoadedZipRel();
    if (!rel) rel = resolveSof1mapsZipPath(folder, mapIn || "");
    if (!rel || !rel.toLowerCase().endsWith(".zip")) {
      setStatus("No zip path: load a map via sof1maps first, or set folder + map name.", true);
      return;
    }
    const r = addEntryToActive(rel);
    if (r === "no-playlist") {
      setStatus("Create a map list (New list) or select one.", true);
      return;
    }
    if (r === "duplicate") setStatus(`Already in list: ${rel}`, true);
    else if (r === "bad-path") setStatus("Path must end in .zip", true);
    else setStatus(`Added to list: ${rel}`);
    refreshMapPlaylistUi();
  });
  $("#map-pl-del").addEventListener("click", () => {
    const id = ($("#map-pl-select") as HTMLSelectElement).value;
    if (!id || !confirm("Delete this map list?")) return;
    deletePlaylist(id);
    refreshMapPlaylistUi();
  });
  const mapPlUl = $("#map-pl-entries");
  mapPlUl.addEventListener("dragover", (e) => {
    if (mapPlDragFrom < 0) return;
    const pl = getActivePlaylist();
    if (!pl?.entries.length) return;
    e.preventDefault();
    (e as DragEvent).dataTransfer!.dropEffect = "move";
  });
  mapPlUl.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = mapPlDragFrom;
    if (from < 0) return;
    const pl = getActivePlaylist();
    if (!pl?.entries.length) return;
    const di = playlistDropIndexFromPoint(e as DragEvent, mapPlUl, pl.entries.length);
    if (reorderActiveEntry(from, di)) refreshMapPlaylistUi();
  });
  $("#map-pl-export").addEventListener("click", () => {
    const json = exportMapListsJson();
    const d = new Date();
    const name = `sof-entity-editor-map-lists-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Exported map lists (${name})`);
  });
  const mapPlImport = $("#map-pl-import-input") as HTMLInputElement;
  mapPlImport.addEventListener("change", () => {
    const file = mapPlImport.files?.[0];
    mapPlImport.value = "";
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const text = typeof fr.result === "string" ? fr.result : "";
      if (!text) {
        setStatus("Import file empty.", true);
        return;
      }
      const mode = confirm(
        "Replace all map lists with this file?\n\nOK = replace everything\nCancel = merge into existing lists",
      )
        ? "replace"
        : "merge";
      const r = importMapListsJson(text, mode);
      if (!r.ok) {
        setStatus(`Import failed: ${r.error}`, true);
        return;
      }
      refreshMapPlaylistUi();
      setStatus(`Imported ${r.count} list(s) (${r.mode})`);
    };
    fr.onerror = () => setStatus("Could not read import file.", true);
    fr.readAsText(file);
  });
  $("#map-pl-prev").addEventListener("click", () => void loadPlaylistMap(goPrev));
  $("#map-pl-next").addEventListener("click", () => void loadPlaylistMap(goNext));
  refreshMapPlaylistUi();
  void initBundledMapLists().then(() => refreshMapPlaylistUi());

  refreshEntProfileBundledList();
  populateProfileSelect();
  refreshProfileExportHints();
  $("#ent-profile-current").addEventListener("change", () => {
    const v = ($("#ent-profile-current") as HTMLSelectElement).value;
    setCurrentProfileSlug(v || null);
    refreshProfileExportHints();
    void tryLoadProfileMapEntities();
  });
  $("#ent-profile-set-custom").addEventListener("click", () => {
    const raw = ($("#ent-profile-custom-slug") as HTMLInputElement).value.trim();
    if (!raw) {
      setStatus("Enter a folder name.", true);
      return;
    }
    const slug = sanitizeProfileSlug(raw);
    setCurrentProfileSlug(slug);
    ($("#ent-profile-custom-slug") as HTMLInputElement).value = "";
    populateProfileSelect();
    refreshProfileExportHints();
    void tryLoadProfileMapEntities();
    setStatus(`Current profile: ${slug}`);
  });
  $("#ent-profile-clear").addEventListener("click", () => {
    setCurrentProfileSlug(null);
    populateProfileSelect();
    refreshProfileExportHints();
    setStatus("Profile cleared.");
  });

  $("#insert-btn-camera").addEventListener("click", () => insertEntityAlongView(INSERT_DIST_IN_FRONT));
  $("#insert-btn").addEventListener("click", () => insertEntityAlongView(INSERT_DIST_AHEAD));

  $("#insert-step-nx").addEventListener("click", () => bumpInsertFlatOffset("x", -1));
  $("#insert-step-px").addEventListener("click", () => bumpInsertFlatOffset("x", 1));
  $("#insert-step-ny").addEventListener("click", () => bumpInsertFlatOffset("y", -1));
  $("#insert-step-py").addEventListener("click", () => bumpInsertFlatOffset("y", 1));

  $("#undo-btn").addEventListener("click", () => undoEntityEdit());
  $("#redo-btn").addEventListener("click", () => redoEntityEdit());
  updateUndoRedoUi();

  if (autoloadEl.checked) {
    const last = getLastZipRel();
    if (last) void loadSof1mapsZipRel(last).catch(() => void loadBspFromSof1maps());
    else void loadBspFromSof1maps();
  }

  $("#bsp-input").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    f.arrayBuffer().then((buf) => loadBspBuffer(buf, f.name));
  });

  $("#ent-input").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    bspName = f.name.replace(/\.txt$/i, "") || "map";
    f.text().then(loadEntText);
  });

  $("#ent-clipboard").addEventListener("click", () => void loadEntFromClipboard());
  $("#ent-internal").addEventListener("click", loadInternalEntities);

  $("#export-btn").addEventListener("click", exportEnt);

  $("#entity-fields").addEventListener("input", () => applyInspectorToScene());
  $("#entity-fields").addEventListener("change", (e) => {
    applyInspectorToScene();
    if ((e.target as HTMLElement).classList.contains("field-key")) renderEntityInspector();
  });
  $("#entity-goto").addEventListener("click", () => gotoSelectedEntity());
  $("#entity-clone").addEventListener("click", () => cloneSelectedEntity());
  $("#entity-delete").addEventListener("click", () => deleteSelectedEntity());
  $("#entity-fields").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("field-del")) return;
    e.preventDefault();
    if (selectedIdx === null) return;
    const row = t.closest(".field-row");
    if (!row) return;
    commitHistoryBeforeChange();
    pendingInspectorCommit = false;
    const b = entityBlocks[selectedIdx]!;
    b.pairs = readInspectorPairs();
    const ix = Number((row as HTMLElement).dataset.index);
    if (ix >= 0 && ix < b.pairs.length) b.pairs.splice(ix, 1);
    renderEntityInspector();
    refreshMarkers(true);
    updateEntityListRow(selectedIdx);
    scheduleProfileFileSync();
  });
  $("#entity-add-field").addEventListener("click", () => {
    if (selectedIdx === null) return;
    commitHistoryBeforeChange();
    pendingInspectorCommit = false;
    const b = entityBlocks[selectedIdx]!;
    b.pairs = readInspectorPairs();
    b.pairs.push(["", ""]);
    renderEntityInspector();
    refreshMarkers(true);
    updateEntityListRow(selectedIdx);
    scheduleProfileFileSync();
    const keys = $("#entity-fields").querySelectorAll(".field-key");
    (keys[keys.length - 1] as HTMLInputElement | undefined)?.focus();
  });

  const drop = $("#drop-zone");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".bsp")) file.arrayBuffer().then((buf) => loadBspBuffer(buf, file.name));
    else if (file.name.toLowerCase().endsWith(".txt")) {
      bspName = file.name.replace(/\.txt$/i, "") || "map";
      file.text().then(loadEntText);
    }
  });
}

initThree();
initUI();
