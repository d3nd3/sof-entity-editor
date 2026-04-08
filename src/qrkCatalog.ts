/**
 * QuArK `SOFEntities.qrk`: toolbox folder tree (`*.qtxfolder`, `classname:[eb]`) + `Entity forms.fctx` (`*:form`).
 */

import qrkText from "../SOFEntities.qrk?raw";

export type SpawnflagBitDef = { mask: number; name: string; doc?: string; unused?: boolean };

export type EntityDefQuakedMeta = {
  colorRgb: [number, number, number] | null;
  bboxQuake: { mins: [number, number, number]; maxs: [number, number, number] } | null;
};

export type ToolboxNode =
  | { type: "folder"; label: string; children: ToolboxNode[] }
  | { type: "entity"; classname: string; desc?: string };

export type QrkFieldValueOption = { label: string; value: string };

export type QrkFormEntry = {
  helpText?: string;
  bboxQuake: EntityDefQuakedMeta["bboxQuake"];
  spawnflags: SpawnflagBitDef[];
  /** Field keys from the QuArK form, e.g. `targetname`, `message`, `wait`. */
  fieldNames: string[];
  /** Per-field `Items` / `values` pairs from QuArK choice blocks (key = lowercase field name). */
  fieldValueOptions: Map<string, QrkFieldValueOption[]>;
};

export type MergedEntityDef = QrkFormEntry & {
  colorRgb: [number, number, number] | null;
  toolboxDesc?: string;
};

/** Balanced `{`…`}` slice; ignores braces inside `"` / `'` strings (QuArK `help` / hints can contain `}`). */
function extractBraceBlock(s: string, openBraceIdx: number): [string, number] {
  if (s[openBraceIdx] !== "{") return ["", openBraceIdx];
  let depth = 0;
  let i = openBraceIdx;
  let inDbl = false;
  let inSgl = false;
  let esc = false;
  while (i < s.length) {
    const c = s[i]!;
    if (inDbl) {
      if (esc) {
        esc = false;
        i++;
        continue;
      }
      if (c === "\\") {
        esc = true;
        i++;
        continue;
      }
      if (c === '"') {
        inDbl = false;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (inSgl) {
      if (esc) {
        esc = false;
        i++;
        continue;
      }
      if (c === "\\") {
        esc = true;
        i++;
        continue;
      }
      if (c === "'") {
        inSgl = false;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inDbl = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSgl = true;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return [s.slice(openBraceIdx + 1, i), i + 1];
    }
    i++;
  }
  return [s.slice(openBraceIdx + 1), s.length];
}

function skipWsComments(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (s.slice(i, i + 2) === "//") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

function extractSemicolonDesc(block: string): string | undefined {
  const m = /;desc\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(block);
  if (!m) return undefined;
  return m[1]!.replace(/\\(.)/g, "$1").replace(/\$0D/g, "\n");
}

function parseToolboxBody(body: string): ToolboxNode[] {
  const children: ToolboxNode[] = [];
  let pos = 0;
  while (pos < body.length) {
    pos = skipWsComments(body, pos);
    if (pos >= body.length) break;
    const rest = body.slice(pos);
    const fm = /^([a-zA-Z0-9_]+)\.qtxfolder\s*=\s*\{/.exec(rest);
    if (fm && fm.index === 0) {
      const openIdx = pos + fm[0].length - 1;
      const [inner, endPos] = extractBraceBlock(body, openIdx);
      children.push({
        type: "folder",
        label: fm[1]!,
        children: parseToolboxBody(inner),
      });
      pos = endPos;
      continue;
    }
    const em = /^([a-zA-Z0-9_]+):[eb]\s*=\s*\{/.exec(rest);
    if (em && em.index === 0) {
      const openIdx = pos + em[0].length - 1;
      const [inner, endPos] = extractBraceBlock(body, openIdx);
      const desc = extractSemicolonDesc(inner);
      children.push({ type: "entity", classname: em[1]!, desc });
      pos = endPos;
      continue;
    }
    const nl = body.indexOf("\n", pos);
    if (nl < 0) break;
    pos = nl + 1;
  }
  return children;
}

function parseTyp(typ: string): number | null {
  const m = /^X(\d+)$/i.exec(typ.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unescapeQrkString(s: string): string {
  return s.replace(/\\(.)/g, "$1").replace(/\$0D/g, "\n");
}

function extractHelp(formBody: string): string | undefined {
  const m = /\bhelp\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(formBody);
  if (!m) return undefined;
  return unescapeQrkString(m[1]!);
}

function extractBbox(formBody: string): EntityDefQuakedMeta["bboxQuake"] {
  const m = /\bbbox\s*=\s*['"]([-0-9.eE+\s]+)['"]/.exec(formBody);
  if (!m) return null;
  const parts = m[1]!.trim().split(/\s+/).map(Number);
  if (parts.length < 6 || parts.some((x) => !Number.isFinite(x))) return null;
  return {
    mins: [parts[0]!, parts[1]!, parts[2]!],
    maxs: [parts[3]!, parts[4]!, parts[5]!],
  };
}

function extractSpawnflags(formBody: string): SpawnflagBitDef[] {
  const out: SpawnflagBitDef[] = [];
  let pos = 0;
  while (pos < formBody.length) {
    const ix = formBody.indexOf("spawnflags:", pos);
    if (ix < 0) break;
    const brace = formBody.indexOf("{", ix);
    if (brace < 0) break;
    const [block, next] = extractBraceBlock(formBody, brace);
    const typM = /Typ\s*=\s*"([^"]+)"/.exec(block);
    const capM = /Cap\s*=\s*"([^"]*)"/.exec(block);
    const hintM = /Hint\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(block);
    if (typM && capM) {
      const mask = parseTyp(typM[1]!);
      if (mask != null) {
        const hint = hintM ? unescapeQrkString(hintM[1]!) : "";
        out.push({
          mask,
          name: capM[1]!,
          doc: hint || `Spawnflag 0x${mask.toString(16)} (SOFEntities.qrk)`,
        });
      }
    }
    pos = next;
  }
  out.sort((a, b) => a.mask - b.mask);
  return out;
}

function extractFieldNames(formBody: string): string[] {
  const out = new Set<string>();
  const re = /^\s*([a-zA-Z0-9_]+)\s*:\s*=/gm;
  let m: RegExpExecArray | null;
  // Top-level form fields use `name: = { ... }` — inner blocks use `Txt =`, `Typ =`, etc. (no colon).
  while ((m = re.exec(formBody))) {
    const name = m[1]!;
    if (!name) continue;
    out.add(name);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function skipInlineWs(s: string, start: number): number {
  let j = start;
  while (j < s.length && /\s/.test(s[j]!)) j++;
  return j;
}

/** QuArK `Items = "a"$0D"b"` — quoted chunks only (same line). */
function parseConcatQuotedStrings(fragment: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out.push(unescapeQrkString(m[1]!));
  return out;
}

function parseItemsValuesLine(block: string, key: "Items" | "values"): string[] {
  const re = key === "Items" ? /^\s*Items\s*=\s*(.*)$/m : /^\s*values\s*=\s*(.*)$/m;
  const m = re.exec(block);
  if (!m) return [];
  return parseConcatQuotedStrings(m[1]!);
}

/** `fieldname: = {` … `Items` / `values` … — same count → dropdown in editor. */
function extractFieldEnumOptions(formBody: string): Map<string, QrkFieldValueOption[]> {
  const out = new Map<string, QrkFieldValueOption[]>();
  let pos = 0;
  while (pos < formBody.length) {
    pos = skipWsComments(formBody, pos);
    if (pos >= formBody.length) break;
    const rest = formBody.slice(pos);
    const m = /^([a-zA-Z0-9_]+)\s*:\s*=\s*/m.exec(rest);
    if (!m || m.index !== 0) {
      pos++;
      continue;
    }
    const name = m[1]!;
    let j = pos + m[0].length;
    j = skipInlineWs(formBody, j);
    if (formBody[j] !== "{") {
      pos++;
      continue;
    }
    const [inner, next] = extractBraceBlock(formBody, j);
    pos = next;
    const items = parseItemsValuesLine(inner, "Items");
    const vals = parseItemsValuesLine(inner, "values");
    if (items.length && vals.length && items.length === vals.length) {
      out.set(
        name.toLowerCase(),
        items.map((label, i) => ({ label, value: vals[i]! })),
      );
    }
  }
  return out;
}

function parseFormBody(inner: string): QrkFormEntry {
  return {
    helpText: extractHelp(inner),
    bboxQuake: extractBbox(inner),
    spawnflags: extractSpawnflags(inner),
    fieldNames: extractFieldNames(inner),
    fieldValueOptions: extractFieldEnumOptions(inner),
  };
}

function parseEntityFormsFctx(text: string): Map<string, QrkFormEntry> {
  const map = new Map<string, QrkFormEntry>();
  const mark = text.indexOf("Entity forms.fctx");
  if (mark < 0) return map;
  const eq = text.indexOf("=", mark);
  const b0 = eq >= 0 ? text.indexOf("{", eq) : -1;
  if (b0 < 0) return map;
  const [formsBody] = extractBraceBlock(text, b0);
  let pos = 0;
  while (pos < formsBody.length) {
    pos = skipWsComments(formsBody, pos);
    if (pos >= formsBody.length) break;
    const sub = formsBody.slice(pos);
    const m = /^([a-zA-Z0-9_]+):form\s*=\s*\{/.exec(sub);
    if (!m || m.index !== 0) {
      const nl = formsBody.indexOf("\n", pos);
      if (nl < 0) break;
      pos = nl + 1;
      continue;
    }
    const abs = pos + m.index;
    const braceAt = abs + m[0].length - 1;
    const [inner, next] = extractBraceBlock(formsBody, braceAt);
    map.set(m[1]!.toLowerCase(), parseFormBody(inner));
    pos = next;
  }
  return map;
}

function collectToolboxDescs(
  nodes: ToolboxNode[],
  byClass: Map<string, string>,
): void {
  for (const n of nodes) {
    if (n.type === "entity") {
      const k = n.classname.toLowerCase();
      if (n.desc?.trim()) byClass.set(k, n.desc.trim());
    } else collectToolboxDescs(n.children, byClass);
  }
}

function walkClassnames(nodes: ToolboxNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.type === "entity") out.add(n.classname.toLowerCase());
    else walkClassnames(n.children, out);
  }
}

let _cached: {
  toolboxRoot: ToolboxNode;
  formByClass: Map<string, QrkFormEntry>;
  merged: Map<string, MergedEntityDef>;
  allNames: string[];
} | null = null;

function buildCache() {
  const mark = qrkText.indexOf("SOF Entities.qtxfolder");
  let toolboxChildren: ToolboxNode[] = [];
  if (mark >= 0) {
    const eq = qrkText.indexOf("=", mark);
    const b0 = eq >= 0 ? qrkText.indexOf("{", eq) : -1;
    if (b0 >= 0) {
      const [inner] = extractBraceBlock(qrkText, b0);
      toolboxChildren = parseToolboxBody(inner);
    }
  }
  const toolboxRoot: ToolboxNode = {
    type: "folder",
    label: "SOF Entities",
    children: toolboxChildren,
  };
  const formByClass = parseEntityFormsFctx(qrkText);
  const toolboxDesc = new Map<string, string>();
  collectToolboxDescs(toolboxRoot.children, toolboxDesc);
  const merged = new Map<string, MergedEntityDef>();
  for (const [cn, form] of formByClass) {
    merged.set(cn, {
      ...form,
      colorRgb: null,
      toolboxDesc: toolboxDesc.get(cn),
    });
  }
  for (const [cn, desc] of toolboxDesc) {
    if (!merged.has(cn))
      merged.set(cn, {
        colorRgb: null,
        bboxQuake: null,
        spawnflags: [],
        fieldNames: [],
        fieldValueOptions: new Map(),
        helpText: undefined,
        toolboxDesc: desc,
      });
  }
  const names = new Set<string>();
  for (const k of merged.keys()) names.add(k);
  walkClassnames(toolboxRoot.children, names);
  const allNames = [...names].sort((a, b) => a.localeCompare(b));
  _cached = { toolboxRoot, formByClass, merged, allNames };
}

function cache() {
  if (!_cached) buildCache();
  return _cached!;
}

export function getToolboxRoot(): ToolboxNode {
  return cache().toolboxRoot;
}

export function getEntityFieldNames(classname: string): string[] {
  const m = cache().merged.get(classname.toLowerCase());
  return m?.fieldNames ?? [];
}

export function getEntityFieldValueOptions(classname: string, fieldKey: string): QrkFieldValueOption[] | undefined {
  const m = cache().merged.get(classname.toLowerCase());
  const opts = m?.fieldValueOptions.get(fieldKey.trim().toLowerCase());
  return opts?.length ? opts : undefined;
}

/** One QuArK toolbox folder: direct child `classname:[eb]` entries only (subfolders are separate groups). */
export type ToolboxFolderGroup = {
  /** Path segments under SOF Entities, joined for zip dirs, e.g. `environment` or `func/plat` */
  id: string;
  pathLabels: string[];
  classnames: string[];
};

function sanitizeToolboxSegment(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return t || "group";
}

/** Flat list of folder groups (toolbox tree) for entities.txt profile export. */
export function getToolboxFolderGroups(): ToolboxFolderGroup[] {
  function walk(node: ToolboxNode, pathLabels: string[]): ToolboxFolderGroup[] {
    if (node.type === "entity") return [];
    const out: ToolboxFolderGroup[] = [];
    const direct: string[] = [];
    const subs: ToolboxNode[] = [];
    for (const ch of node.children) {
      if (ch.type === "entity") direct.push(ch.classname);
      else subs.push(ch);
    }
    if (pathLabels.length > 0) {
      const id = pathLabels.map(sanitizeToolboxSegment).join("/");
      out.push({
        id,
        pathLabels: [...pathLabels],
        classnames: direct.slice().sort((a, b) => a.localeCompare(b)),
      });
    }
    for (const sub of subs) {
      if (sub.type === "folder") out.push(...walk(sub, [...pathLabels, sub.label]));
    }
    return out;
  }
  return walk(getToolboxRoot(), []);
}

export function getMergedEntityDefMap(): Map<string, MergedEntityDef> {
  return cache().merged;
}

export function getAllQrkClassnames(): string[] {
  return cache().allNames;
}

/** Toolbox `;desc` + Entity forms `help` — raw parts if needed elsewhere. */
export function getEntityQrkDescriptionParts(classname: string): { toolboxDesc: string; helpText: string } {
  const e = getMergedEntityDefMap().get(classname.trim().toLowerCase());
  if (!e) return { toolboxDesc: "", helpText: "" };
  return {
    toolboxDesc: (e.toolboxDesc ?? "").trim(),
    helpText: (e.helpText ?? "").trim(),
  };
}

/** Prefer Entity forms `help` (detailed); fallback to toolbox `;desc` only when help is absent. */
export function getEntityEditorTooltip(classname: string): string {
  const { toolboxDesc, helpText } = getEntityQrkDescriptionParts(classname);
  if (helpText) return helpText;
  return toolboxDesc;
}
