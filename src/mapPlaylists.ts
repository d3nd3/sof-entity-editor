/** Repo-relative zip paths (e.g. `dm/doom2sof.zip`) — same as sof1maps fetch. */

const LS_KEY = "sof-entity-editor-map-playlists-v1";
const NOTE_MAX = 160;

/** Preset row colours (stored on each entry; JSON `color` field). */
export const MAP_ENTRY_COLORS = ["sky", "mint", "amber", "rose", "violet", "lime", "ocean", "slate"] as const;
export type MapEntryColorId = (typeof MAP_ENTRY_COLORS)[number];

export type MapPlaylistEntry = { path: string; note?: string; color?: MapEntryColorId };

function parseColorId(raw: string): MapEntryColorId | undefined {
  const c = raw.trim();
  return (MAP_ENTRY_COLORS as readonly string[]).includes(c) ? (c as MapEntryColorId) : undefined;
}

export type MapPlaylist = { id: string; name: string; entries: MapPlaylistEntry[] };

type Store = {
  playlists: MapPlaylist[];
  activeId: string | null;
  /** Index into `active` playlist's `entries`; -1 if none / unknown */
  currentIndex: number;
};

let lastLoadedZipRel: string | null = null;

function defaultStore(): Store {
  return { playlists: [], activeId: null, currentIndex: -1 };
}

function parseOneEntry(x: unknown): MapPlaylistEntry | null {
  if (typeof x === "string") {
    const path = x.trim();
    return path ? { path } : null;
  }
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.path !== "string") return null;
    const path = o.path.trim();
    if (!path) return null;
    const ent: MapPlaylistEntry = { path };
    if ("note" in o && typeof o.note === "string") {
      const n = o.note.trim().slice(0, NOTE_MAX);
      if (n) ent.note = n;
    }
    if ("color" in o && typeof o.color === "string") {
      const col = parseColorId(o.color);
      if (col) ent.color = col;
    }
    return ent;
  }
  return null;
}

function normalizeEntryList(arr: unknown[]): MapPlaylistEntry[] {
  const seen = new Set<string>();
  const out: MapPlaylistEntry[] = [];
  for (const x of arr) {
    const e = parseOneEntry(x);
    if (!e || seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(e);
  }
  return out;
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultStore();
    const j = JSON.parse(raw) as Store;
    if (!Array.isArray(j.playlists)) return defaultStore();
    return {
      playlists: j.playlists
        .filter((p) => p && typeof p.id === "string")
        .map((p) => ({
          id: p.id,
          name: typeof p.name === "string" ? p.name : "Untitled",
          entries: Array.isArray(p.entries) ? normalizeEntryList(p.entries) : [],
        })),
      activeId: typeof j.activeId === "string" || j.activeId === null ? j.activeId : null,
      currentIndex: typeof j.currentIndex === "number" ? j.currentIndex : -1,
    };
  } catch {
    return defaultStore();
  }
}

let store = loadStore();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

export function getLastLoadedZipRel(): string | null {
  return lastLoadedZipRel;
}

/** Call after a successful sof1maps zip load (or playlist navigation). */
export function setLastLoadedZipRel(rel: string) {
  lastLoadedZipRel = rel.trim();
  syncIndexToPath(lastLoadedZipRel);
  persist();
}

function syncIndexToPath(rel: string) {
  const pl = getActivePlaylist();
  if (!pl) return;
  const ix = pl.entries.findIndex((e) => e.path === rel);
  store.currentIndex = ix >= 0 ? ix : store.currentIndex;
}

export function getPlaylists(): MapPlaylist[] {
  return store.playlists;
}

export function getActiveId(): string | null {
  return store.activeId;
}

export function getActivePlaylist(): MapPlaylist | null {
  if (!store.activeId) return null;
  return store.playlists.find((p) => p.id === store.activeId) ?? null;
}

export function getCurrentIndex(): number {
  return store.currentIndex;
}

export function addPlaylist(name: string): MapPlaylist {
  const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pl: MapPlaylist = { id, name: name.trim() || "Untitled", entries: [] };
  store.playlists.push(pl);
  store.activeId = id;
  store.currentIndex = -1;
  persist();
  return pl;
}

export function deletePlaylist(id: string) {
  store.playlists = store.playlists.filter((p) => p.id !== id);
  if (store.activeId === id) {
    store.activeId = store.playlists[0]?.id ?? null;
    store.currentIndex = -1;
    if (store.activeId && lastLoadedZipRel) syncIndexToPath(lastLoadedZipRel);
  }
  persist();
}

export function renamePlaylist(id: string, name: string) {
  const pl = store.playlists.find((p) => p.id === id);
  if (!pl) return;
  pl.name = name.trim() || pl.name;
  persist();
}

export function setActivePlaylistId(id: string | null) {
  store.activeId = id;
  store.currentIndex = -1;
  if (id && lastLoadedZipRel) syncIndexToPath(lastLoadedZipRel);
  persist();
}

export function addEntryToActive(rel: string): "ok" | "no-playlist" | "bad-path" | "duplicate" {
  const pl = getActivePlaylist();
  if (!pl) return "no-playlist";
  const r = rel.trim();
  if (!r.toLowerCase().endsWith(".zip")) return "bad-path";
  if (pl.entries.some((e) => e.path === r)) return "duplicate";
  pl.entries.push({ path: r });
  if (pl.entries.length === 1) store.currentIndex = 0;
  persist();
  return "ok";
}

export function setActiveEntryNote(index: number, note: string) {
  const pl = getActivePlaylist();
  if (!pl || index < 0 || index >= pl.entries.length) return;
  const t = note.trim().slice(0, NOTE_MAX);
  const ent = pl.entries[index]!;
  const cur = (ent.note ?? "").trim();
  if (t === cur) return;
  if (t) ent.note = t;
  else delete ent.note;
  persist();
}

export function setActiveEntryColor(index: number, color: string | null) {
  const pl = getActivePlaylist();
  if (!pl || index < 0 || index >= pl.entries.length) return;
  const ent = pl.entries[index]!;
  const id = color?.trim() ? parseColorId(color) : undefined;
  const prev = ent.color;
  if (id === prev) return;
  if (id) ent.color = id;
  else delete ent.color;
  persist();
}

export function removeEntryAt(index: number) {
  const pl = getActivePlaylist();
  if (!pl || index < 0 || index >= pl.entries.length) return;
  pl.entries.splice(index, 1);
  if (pl.entries.length === 0) store.currentIndex = -1;
  else if (store.currentIndex >= pl.entries.length) store.currentIndex = pl.entries.length - 1;
  else if (index < store.currentIndex) store.currentIndex--;
  persist();
}

/** Clamp and set playlist position; returns that zip path or null. */
export function jumpToEntryIndex(index: number): string | null {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return null;
  const i = Math.max(0, Math.min(index, pl.entries.length - 1));
  store.currentIndex = i;
  persist();
  return pl.entries[i]?.path ?? null;
}

/**
 * Move entry at `from` to gap `dropIndex` (0..n), where n is the list length before the move.
 * Gap i is before the row that was at index i. No-op if already there.
 */
export function reorderActiveEntry(from: number, dropIndex: number): boolean {
  const pl = getActivePlaylist();
  if (!pl) return false;
  const n = pl.entries.length;
  if (from < 0 || from >= n || dropIndex < 0 || dropIndex > n) return false;
  if (dropIndex === from || dropIndex === from + 1) return false;
  const activePath =
    store.currentIndex >= 0 && store.currentIndex < n ? pl.entries[store.currentIndex]!.path : null;
  const item = pl.entries[from]!;
  const next = pl.entries.filter((_, i) => i !== from);
  let ins = dropIndex;
  if (from < dropIndex) ins--;
  next.splice(ins, 0, item);
  pl.entries.length = 0;
  pl.entries.push(...next);
  if (activePath !== null) {
    const ni = pl.entries.findIndex((e) => e.path === activePath);
    store.currentIndex = ni >= 0 ? ni : -1;
  }
  persist();
  return true;
}

/** Next entry (wrap). Returns repo-relative zip path or null. */
export function goNext(): string | null {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return null;
  store.currentIndex = (store.currentIndex + 1) % pl.entries.length;
  persist();
  return pl.entries[store.currentIndex]?.path ?? null;
}

/** Previous entry (wrap). */
export function goPrev(): string | null {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return null;
  const n = pl.entries.length;
  store.currentIndex = ((store.currentIndex < 0 ? 0 : store.currentIndex) - 1 + n) % n;
  persist();
  return pl.entries[store.currentIndex]?.path ?? null;
}

export function getPlaylistLabel(): string {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return "—";
  const idx = store.currentIndex;
  const pos = idx >= 0 ? String(idx + 1) : "—";
  return `${pos} / ${pl.entries.length}`;
}

const EXPORT_FORMAT = "sof-entity-editor-map-lists";
/** v3: entries `{ path, note, color }` — colour is preset id or "". */
const EXPORT_VERSION = 3;

function normalizeImportedPlaylist(p: unknown): MapPlaylist | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Untitled";
  const raw = Array.isArray(o.entries) ? o.entries : [];
  const entries = normalizeEntryList(raw);
  return { id: o.id.trim(), name, entries };
}

function clampStoreCurrentIndex() {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) {
    store.currentIndex = -1;
    return;
  }
  if (store.currentIndex < 0 || store.currentIndex >= pl.entries.length) store.currentIndex = 0;
}

function clonePlaylist(p: MapPlaylist): MapPlaylist {
  return { ...p, entries: p.entries.map((e) => ({ ...e })) };
}

function parsePlaylistsFromExportJson(parsed: unknown): MapPlaylist[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  let listsRaw: unknown;
  if (root.format === EXPORT_FORMAT && typeof root.version === "number" && root.version >= 1) {
    listsRaw = root.playlists;
  } else if (Array.isArray(root.playlists)) {
    listsRaw = root.playlists;
  } else return null;
  if (!Array.isArray(listsRaw)) return null;
  const out: MapPlaylist[] = [];
  for (const x of listsRaw) {
    const pl = normalizeImportedPlaylist(x);
    if (pl) out.push(pl);
  }
  return out.length ? out : null;
}

/** Merge repo `public/maplists/default-map-lists.json` with localStorage: bundled ids first (user wins on same id), then custom lists. */
export async function initBundledMapLists(): Promise<boolean> {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  let text: string;
  try {
    const r = await fetch(`${base}maplists/default-map-lists.json`);
    if (!r.ok) return false;
    text = await r.text();
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const bundled = parsePlaylistsFromExportJson(parsed);
  if (!bundled?.length) return false;

  const bundledIds = new Set(bundled.map((p) => p.id));
  const next: MapPlaylist[] = [];
  for (const b of bundled) {
    const ex = store.playlists.find((p) => p.id === b.id);
    next.push(clonePlaylist(ex ?? b));
  }
  for (const p of store.playlists) {
    if (!bundledIds.has(p.id)) next.push(p);
  }

  if (JSON.stringify(store.playlists) === JSON.stringify(next)) return false;

  store.playlists = next;

  const root = parsed as Record<string, unknown>;
  const fileActiveId = typeof root.activeId === "string" ? root.activeId : null;
  const fileIndex = typeof root.currentIndex === "number" ? root.currentIndex : undefined;

  if (!store.activeId && next.length) {
    const aid = fileActiveId && next.some((p) => p.id === fileActiveId) ? fileActiveId : next[0]!.id;
    store.activeId = aid;
    const pl = getActivePlaylist();
    if (pl?.entries.length && typeof fileIndex === "number" && fileIndex >= 0 && fileIndex < pl.entries.length) {
      store.currentIndex = fileIndex;
    } else store.currentIndex = -1;
  } else if (store.activeId && !next.some((p) => p.id === store.activeId)) {
    store.activeId = next[0]?.id ?? null;
    store.currentIndex = -1;
  } else {
    clampStoreCurrentIndex();
  }

  persist();
  return true;
}

/** JSON backup for new browser / machine — includes playlists, active list, and position index. */
export function exportMapListsJson(): string {
  const playlists = store.playlists.map((p) => ({
    id: p.id,
    name: p.name,
    entries: p.entries.map((e) => ({
      path: e.path,
      note: e.note ?? "",
      color: e.color ?? "",
    })),
  }));
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      playlists,
      activeId: store.activeId,
      currentIndex: store.currentIndex,
    },
    null,
    2,
  );
}

export function importMapListsJson(
  raw: string,
  mode: "replace" | "merge",
): { ok: true; count: number; mode: "replace" | "merge" } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "Invalid file" };
  const root = parsed as Record<string, unknown>;
  let listsRaw: unknown;
  let fileActiveId: string | null | undefined;
  let fileIndex: number | undefined;
  if (root.format === EXPORT_FORMAT && typeof root.version === "number" && root.version >= 1) {
    listsRaw = root.playlists;
    fileActiveId = root.activeId as string | null | undefined;
    fileIndex = root.currentIndex as number | undefined;
  } else if (Array.isArray(root.playlists)) {
    listsRaw = root.playlists;
    fileActiveId = root.activeId as string | null | undefined;
    fileIndex = root.currentIndex as number | undefined;
  } else {
    return { ok: false, error: "Not a map lists backup (missing playlists)" };
  }
  if (!Array.isArray(listsRaw)) return { ok: false, error: "Invalid playlists array" };
  const imported: MapPlaylist[] = [];
  for (const x of listsRaw) {
    const pl = normalizeImportedPlaylist(x);
    if (pl) imported.push(pl);
  }
  if (mode === "replace") {
    if (!imported.length) return { ok: false, error: "No valid playlists in file" };
    const aid =
      typeof fileActiveId === "string" && imported.some((p) => p.id === fileActiveId)
        ? fileActiveId
        : imported[0]!.id;
    store = {
      playlists: imported.map(clonePlaylist),
      activeId: aid,
      currentIndex: -1,
    };
    const pl = getActivePlaylist();
    if (pl?.entries.length) {
      if (typeof fileIndex === "number" && fileIndex >= 0 && fileIndex < pl.entries.length) {
        store.currentIndex = fileIndex;
      } else {
        store.currentIndex = 0;
      }
    }
  } else {
    const importIds = imported.map((p) => p.id);
    for (const imp of imported) {
      const ex = store.playlists.find((p) => p.id === imp.id);
      if (ex) {
        const filePaths = new Set(imp.entries.map((e) => e.path));
        const tail = ex.entries.filter((e) => !filePaths.has(e.path));
        ex.entries = [...imp.entries.map((e) => ({ ...e })), ...tail];
        ex.name = imp.name;
      } else {
        store.playlists.push(clonePlaylist(imp));
      }
    }
    const merged: MapPlaylist[] = [];
    const used = new Set<string>();
    for (const id of importIds) {
      if (used.has(id)) continue;
      const p = store.playlists.find((x) => x.id === id);
      if (p) {
        merged.push(p);
        used.add(id);
      }
    }
    for (const p of store.playlists) {
      if (!used.has(p.id)) merged.push(p);
    }
    store.playlists = merged;
    if (
      typeof fileActiveId === "string" &&
      imported.some((p) => p.id === fileActiveId) &&
      store.playlists.some((p) => p.id === fileActiveId)
    ) {
      store.activeId = fileActiveId;
    }
    clampStoreCurrentIndex();
  }
  persist();
  return { ok: true, count: imported.length, mode };
}
