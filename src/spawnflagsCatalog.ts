/**
 * Spawnflag checkbox labels come only from `sof-sdk/Bin/entities.def`.
 * On each QUAKED line: every `(...)` group is skipped (color / bbox / …); optional `?`;
 * then space-separated tokens in order = bit 0, bit 1, … (masks 1, 2, 4, …).
 * Token `x` = that bit is unused in the .def (still may appear in maps — edit via integer).
 */

import entitiesDefText from "../sof-sdk/Bin/entities.def?raw";

export type SpawnflagBitDef = { mask: number; name: string; doc?: string; unused?: boolean };

function skipBalancedParen(s: string, start: number): number {
  if (s[start] !== "(") return -1;
  let d = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "(") d++;
    else if (c === ")") {
      d--;
      if (d === 0) return i + 1;
    }
  }
  return -1;
}

/** First line of a QUAKED block: classname, then any number of `(…)` groups, optional `?`, flag tokens. */
function parseQuakedFirstLine(line: string): { classname: string; tokens: string[] } | null {
  const t = line.trimStart();
  if (!t.startsWith("/*QUAKED")) return null;
  let rest = t.slice("/*QUAKED".length).trimStart();
  const sp = rest.search(/\s/);
  if (sp <= 0) return null;
  const classname = rest.slice(0, sp);
  rest = rest.slice(sp + 1).trimEnd().replace(/\s*\*\/\s*$/, "");
  let pos = 0;
  while (pos < rest.length) {
    while (pos < rest.length && /\s/.test(rest[pos]!)) pos++;
    if (pos >= rest.length) break;
    if (rest[pos] !== "(") break;
    const end = skipBalancedParen(rest, pos);
    if (end < 0) return null;
    pos = end;
  }
  while (pos < rest.length && /\s/.test(rest[pos]!)) pos++;
  let tail = rest.slice(pos).trim();
  if (tail.startsWith("?")) tail = tail.slice(1).trim();
  const tokens = tail.split(/\s+/).filter(Boolean);
  return { classname, tokens };
}

function buildDefMap(text: string): Map<string, SpawnflagBitDef[]> {
  const map = new Map<string, SpawnflagBitDef[]>();
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf("/*QUAKED", from);
    if (at < 0) break;
    const lineEnd = text.indexOf("\n", at);
    const line = (lineEnd < 0 ? text.slice(at) : text.slice(at, lineEnd)).trimEnd();
    from = at + 9;
    const p = parseQuakedFirstLine(line);
    if (!p) continue;
    const defs: SpawnflagBitDef[] = p.tokens.map((tok, bitIndex) => {
      const mask = 1 << bitIndex;
      const isX = tok.toLowerCase() === "x";
      return {
        mask,
        name: isX ? `x · bit ${bitIndex}` : tok,
        doc: isX ? "Unused slot in entities.def (mask still valid for .map)" : `entities.def · bit ${bitIndex} = 0x${mask.toString(16)}`,
        unused: isX,
      };
    });
    map.set(p.classname.trim().toLowerCase(), defs);
  }
  return map;
}

let _map: Map<string, SpawnflagBitDef[]> | undefined;

function defMap(): Map<string, SpawnflagBitDef[]> {
  if (!_map) _map = buildDefMap(entitiesDefText);
  return _map;
}

export function parseSpawnflagsString(s: string): number {
  const n = Math.trunc(Number(String(s).trim()));
  return Number.isFinite(n) ? n : 0;
}

export function formatSpawnflags(n: number): string {
  return String(Math.trunc(n) || 0);
}

export function getSpawnflagBitsForClassname(classname: string): SpawnflagBitDef[] {
  const row = defMap().get(classname.trim().toLowerCase());
  return row ? [...row] : [];
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
