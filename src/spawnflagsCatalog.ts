/**
 * Spawnflags, bbox, and tooltips come from `SOFEntities.qrk` (Entity forms + toolbox `;desc`).
 */

export type { EntityDefQuakedMeta, SpawnflagBitDef } from "./qrkCatalog";
import {
  getMergedEntityDefMap,
  type EntityDefQuakedMeta,
  type SpawnflagBitDef,
} from "./qrkCatalog";

export { getEntityEditorTooltip } from "./qrkCatalog";

export function getEntityDefQuakedMeta(classname: string): EntityDefQuakedMeta | undefined {
  const e = getMergedEntityDefMap().get(classname.trim().toLowerCase());
  if (!e) return undefined;
  return { colorRgb: e.colorRgb, bboxQuake: e.bboxQuake };
}

export function parseSpawnflagsString(s: string): number {
  const n = Math.trunc(Number(String(s).trim()));
  return Number.isFinite(n) ? n : 0;
}

export function formatSpawnflags(n: number): string {
  return String(Math.trunc(n) || 0);
}

export function getSpawnflagBitsForClassname(classname: string): SpawnflagBitDef[] {
  const row = getMergedEntityDefMap().get(classname.trim().toLowerCase());
  return row ? [...row.spawnflags] : [];
}

export function buildSpawnflagsEditor(
  valueStr: string,
  classname: string,
  onChange: () => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "spawnflags-editor";

  let n = parseSpawnflagsString(valueStr);
  const bits = getSpawnflagBitsForClassname(classname);

  const num = document.createElement("input");
  num.type = "number";
  num.className = "spawnflags-int";
  num.step = "1";
  num.value = String(n);
  num.title = "spawnflags (integer)";

  const bitsEl = document.createElement("div");
  bitsEl.className = "spawnflags-bits";

  const syncCheckboxes = () => {
    n = parseSpawnflagsString(num.value);
    num.value = formatSpawnflags(n);
    bitsEl.querySelectorAll<HTMLInputElement>("input[data-mask]").forEach((cb) => {
      const m = Number(cb.dataset.mask);
      cb.checked = (n & m) !== 0;
    });
  };

  bits.forEach((def) => {
    const lab = document.createElement("label");
    lab.className = "sf-bit" + (def.unused ? " sf-bit-unused" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.mask = String(def.mask);
    cb.checked = (n & def.mask) !== 0;
    cb.disabled = !!def.unused;
    if (def.doc) cb.title = def.doc;
    cb.addEventListener("change", () => {
      if (def.unused) return;
      const m = Number(cb.dataset.mask);
      n = parseSpawnflagsString(num.value);
      if (cb.checked) n |= m;
      else n &= ~m;
      num.value = formatSpawnflags(n);
      onChange();
    });
    lab.append(cb, document.createTextNode(def.name));
    bitsEl.appendChild(lab);
  });

  num.addEventListener("input", () => {
    syncCheckboxes();
    onChange();
  });
  num.addEventListener("change", () => {
    syncCheckboxes();
    onChange();
  });

  wrap.append(num, bitsEl);
  return wrap;
}
