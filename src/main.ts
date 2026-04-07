import "./style.css";
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import entitiesTxt from "../entities.txt?raw";
import { parseEntityCatalog } from "./entityCatalog";
import { buildWorldMeshData, parseBsp, type BspFile } from "./bsp/parse";
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
import { faceIndexForYawDegrees, quakeToThree, threeToQuake } from "./coords";
import { PLAYER_SPAWN_HULL_QUAKE, quakeAabbToThreeBox } from "./playerHull";
import { buildSpawnflagsEditor, formatSpawnflags, parseSpawnflagsString } from "./spawnflagsCatalog";
import { fetchBspFromSof1mapsZip, resolveSof1mapsZipPath, SOF1MAPS_FOLDERS } from "./sof1maps";

let entityBlocks: EntityBlock[] = [];
let bspName = "map";
let internalEntityText = "";
const markers: THREE.Object3D[] = [];
let selectedIdx: number | null = null;

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
let raycaster: THREE.Raycaster;
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const keysDown = new Set<string>();

function isTypingInField(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
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
  yawDeg: number | null,
  transp?: { transparent: boolean; opacity: number; depthWrite: boolean },
): THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] {
  if (yawDeg === null) {
    return new THREE.MeshLambertMaterial(
      transp ? { color: base, ...transp } : { color: base },
    );
  }
  const fi = faceIndexForYawDegrees(yawDeg);
  const mats: THREE.MeshLambertMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    const col = i === fi ? new THREE.Color(ANGLE_FACE_COLOR) : base.clone();
    mats.push(
      new THREE.MeshLambertMaterial(
        transp ? { color: col, ...transp } : { color: col },
      ),
    );
  }
  return mats;
}

function makeMarker(classname: string, yawDeg: number | null): THREE.Object3D {
  const hue = hashHue(classname);
  const c = new THREE.Color().setHSL(hue / 360, 0.65, 0.5);
  if (isInfoPlayer(classname)) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    quakeAabbToThreeBox(PLAYER_SPAWN_HULL_QUAKE.mins, PLAYER_SPAWN_HULL_QUAKE.maxs, size, center);
    const transp = { transparent: true, opacity: 0.4, depthWrite: false };
    const mat = makeBoxMaterials(c, yawDeg, transp);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(center);
    const g = new THREE.Group();
    g.add(mesh);
    g.userData.classname = classname;
    return g;
  }
  const mat = makeBoxMaterials(c, yawDeg);
  const m = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), mat);
  m.userData.classname = classname;
  return m;
}

function refreshMarkers(skipInspector = false) {
  markers.length = 0;
  entGroup.clear();

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
  if (selectedIdx !== null && !markers.some((m) => m.userData.entityIndex === selectedIdx)) selectedIdx = null;
  selectEntity(selectedIdx, { skipInspector });
}

function selectEntity(idx: number | null, opts?: { skipInspector?: boolean }) {
  selectedIdx = idx;
  transform.detach();
  for (const m of markers) setMarkerEmissive(m, 0);
  const list = $("#entity-list");
  list.querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("selected", idx !== null && i === idx);
  });
  if (idx !== null) {
    list.querySelector(`li[data-index="${idx}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (idx !== null && idx >= 0 && idx < entityBlocks.length) {
    const mk = markers.find((m) => m.userData.entityIndex === idx);
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

function fillEntityList() {
  const list = $("#entity-list");
  list.innerHTML = "";
  entityBlocks.forEach((_, i) => {
    const li = document.createElement("li");
    li.textContent = entityListRowText(i);
    li.dataset.index = String(i);
    li.classList.toggle("selected", selectedIdx !== null && i === selectedIdx);
    li.addEventListener("click", () => selectEntity(i));
    list.appendChild(li);
  });
}

function updateEntityListRow(idx: number) {
  const item = $("#entity-list").querySelector(`li[data-index="${idx}"]`);
  if (item) item.textContent = entityListRowText(idx);
}

function readInspectorPairs(): [string, string][] {
  const root = $("#entity-fields");
  const rows = root.querySelectorAll(".field-row");
  const out: [string, string][] = [];
  rows.forEach((row) => {
    const k = (row.querySelector(".field-key") as HTMLInputElement)?.value ?? "";
    const sf = row.querySelector(".spawnflags-int") as HTMLInputElement | null;
    const v = sf
      ? formatSpawnflags(parseSpawnflagsString(sf.value))
      : ((row.querySelector(".field-val") as HTMLInputElement)?.value ?? "");
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
  if (selectedIdx === null || selectedIdx < 0 || selectedIdx >= entityBlocks.length) {
    panel.classList.add("is-hidden");
    panel.setAttribute("aria-hidden", "true");
    fields.innerHTML = "";
    sum.textContent = "";
    return;
  }
  panel.classList.remove("is-hidden");
  panel.setAttribute("aria-hidden", "false");
  const b = entityBlocks[selectedIdx]!;
  const cn = getPair(b, "classname") ?? "?";
  sum.textContent = `Index ${selectedIdx} · ${b.pairs.length} field(s)`;
  fields.innerHTML = "";
  b.pairs.forEach(([k, v], i) => {
    const row = document.createElement("div");
    row.className = "field-row";
    row.dataset.index = String(i);
    const ki = document.createElement("input");
    ki.className = "field-key";
    ki.type = "text";
    ki.spellcheck = false;
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
      const vi = document.createElement("input");
      vi.className = "field-val";
      vi.type = "text";
      vi.spellcheck = false;
      vi.value = v;
      row.append(ki, vi, del);
    }
    fields.appendChild(row);
  });
  updateGotoButtonState();
}

function applyInspectorToScene() {
  if (selectedIdx === null) return;
  entityBlocks[selectedIdx]!.pairs = readInspectorPairs();
  refreshMarkers(true);
  updateEntityListRow(selectedIdx);
  updateGotoButtonState();
}

function syncOriginFromMarker(marker: THREE.Object3D) {
  const idx = marker.userData.entityIndex as number;
  if (idx === undefined || idx < 0 || idx >= entityBlocks.length) return;
  const b = entityBlocks[idx]!;
  const [qx, qy, qz] = threeToQuake(marker.position);
  setPair(b, "origin", formatOrigin(qx, qy, qz));
  updateEntityListRow(idx);
  renderEntityInspector();
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

function frameCameraToMap(mesh: THREE.Mesh) {
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  if (!bb) return;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bb.getCenter(center);
  bb.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 64);
  camera.position.set(center.x + maxDim * 0.55, center.y + maxDim * 0.42, center.z + maxDim * 1.05);
  camera.lookAt(center);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  lookPitch = e.x;
  lookYaw = e.y;
  syncCameraLook();
}

function loadBspBuffer(buf: ArrayBuffer, name: string) {
  bspName = name.replace(/\.bsp$/i, "") || "map";
  meshGroup.clear();
  const bsp = parseBsp(buf);
  const mesh = meshFromBspData(bsp.buffer, bsp.lumps);
  meshGroup.add(mesh);
  frameCameraToMap(mesh);
  internalEntityText = bsp.entityString;
  entityBlocks = parseEntityString(sanitizeEntText(internalEntityText));
  fillEntityList();
  refreshMarkers();
  setStatus(`Loaded ${name} (${entityBlocks.length} entities)`);
}

async function loadBspFromSof1maps() {
  const folder = ($("#sof1maps-folder") as HTMLSelectElement).value;
  const mapIn = ($("#sof1maps-map") as HTMLInputElement).value.trim();
  const rel = resolveSof1mapsZipPath(folder, mapIn || "doom2sof");
  if (!rel || !rel.toLowerCase().endsWith(".zip")) {
    setStatus("Enter a map name (e.g. doom2sof) or full path ending in .zip", true);
    return;
  }
  const btn = $("#sof1maps-fetch") as HTMLButtonElement;
  btn.disabled = true;
  setStatus(`Fetching plowsof/sof1maps: ${rel}…`);
  try {
    const { bspName: bn, bsp, zipFromCache } = await fetchBspFromSof1mapsZip(rel);
    loadBspBuffer(bsp, bn);
    const cacheHint = zipFromCache
      ? "zip from IndexedDB cache"
      : "zip downloaded (stored in IndexedDB for next time)";
    setStatus(`Loaded ${bn} from ${rel} (${entityBlocks.length} entities) — ${cacheHint}`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btn.disabled = false;
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

function loadEntText(text: string) {
  entityBlocks = parseEntityString(sanitizeEntText(text));
  fillEntityList();
  refreshMarkers();
  setStatus(`Entity file — ${entityBlocks.length} blocks`);
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
  const blob = new Blob([serializeEntityString(entityBlocks)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${bspName}_ent.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
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

function insertEntityAtViewCenter() {
  const cn = (($("#insert-class") as HTMLInputElement).value || "").trim();
  if (!cn) {
    setStatus("Enter a classname to insert.", true);
    return;
  }
  const aim = new THREE.Vector3();
  camera.getWorldDirection(aim);
  const worldAim = camera.position.clone().addScaledVector(aim, 320);
  const [qx, qy, qz] = threeToQuake(worldAim);
  entityBlocks.push({
    pairs: [
      ["classname", cn],
      ["origin", formatOrigin(qx, qy, qz)],
    ],
  });
  fillEntityList();
  refreshMarkers();
  selectEntity(entityBlocks.length - 1);
  setStatus(`Inserted ${cn} @ ${formatOrigin(qx, qy, qz)}`);
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
      if (isTypingInField()) return;
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
  transform.addEventListener("objectChange", () => {
    const o = transform.object;
    if (o) syncOriginFromMarker(o);
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
    keysDown.add(e.code);
  });
  window.addEventListener("keyup", (e) => keysDown.delete(e.code));

  $("#view-hint").innerHTML =
    "<strong>Look</strong> hold <strong>right mouse</strong> drag (FPS mouselook)<br>" +
    "<strong>Fly</strong> WASD · Q/E · <strong>Alt</strong> faster · <strong>wheel</strong> zoom along view · <strong>middle drag</strong> pan<br>" +
    "<strong>Entity</strong> left-click marker or list · <strong>Esc</strong> deselect · <strong>gizmo</strong> moves selection";

  el.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const r = container.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(markers, true);
    if (hits.length > 0) {
      let o: THREE.Object3D | null = hits[0]!.object;
      while (o && o.userData.entityIndex === undefined) o = o.parent;
      const idx = o?.userData.entityIndex as number | undefined;
      if (typeof idx === "number") selectEntity(idx);
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const hud = $("#camera-pos-hud");

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    applyViewNavigation(dt);
    const [qx, qy, qz] = threeToQuake(camera.position);
    const r = (n: number) => n.toFixed(2);
    hud.innerHTML = `<span class="label">Camera (game units)</span>${r(qx)} ${r(qy)} ${r(qz)}`;
    renderer.render(scene, camera);
  }
  animate();
}

function initUI() {
  const folderSel = $("#sof1maps-folder") as HTMLSelectElement;
  for (const f of SOF1MAPS_FOLDERS) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f;
    folderSel.appendChild(o);
  }
  folderSel.value = "dm";
  ($("#sof1maps-map") as HTMLInputElement).value = "doom2sof";

  const dl = $("#entity-classnames");
  for (const name of parseEntityCatalog(entitiesTxt)) {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  }

  $("#sof1maps-fetch").addEventListener("click", () => void loadBspFromSof1maps());
  $("#insert-btn").addEventListener("click", () => insertEntityAtViewCenter());

  if (($("#sof1maps-autoload") as HTMLInputElement).checked) void loadBspFromSof1maps();

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
  $("#entity-fields").addEventListener("change", () => applyInspectorToScene());
  $("#entity-goto").addEventListener("click", () => gotoSelectedEntity());
  $("#entity-fields").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("field-del")) return;
    e.preventDefault();
    if (selectedIdx === null) return;
    const row = t.closest(".field-row");
    if (!row) return;
    const b = entityBlocks[selectedIdx]!;
    b.pairs = readInspectorPairs();
    const ix = Number((row as HTMLElement).dataset.index);
    if (ix >= 0 && ix < b.pairs.length) b.pairs.splice(ix, 1);
    renderEntityInspector();
    refreshMarkers(true);
    updateEntityListRow(selectedIdx);
  });
  $("#entity-add-field").addEventListener("click", () => {
    if (selectedIdx === null) return;
    const b = entityBlocks[selectedIdx]!;
    b.pairs = readInspectorPairs();
    b.pairs.push(["", ""]);
    renderEntityInspector();
    refreshMarkers(true);
    updateEntityListRow(selectedIdx);
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
