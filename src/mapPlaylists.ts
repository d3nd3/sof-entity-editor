/** Repo-relative zip paths (e.g. `dm/doom2sof.zip`) — same as sof1maps fetch. */

const LS_KEY = "sof-entity-editor-map-playlists-v1";

export type MapPlaylist = { id: string; name: string; entries: string[] };

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
          entries: Array.isArray(p.entries) ? p.entries.filter((e): e is string => typeof e === "string") : [],
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
  const ix = pl.entries.indexOf(rel);
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
  if (pl.entries.includes(r)) return "duplicate";
  pl.entries.push(r);
  if (pl.entries.length === 1) store.currentIndex = 0;
  persist();
  return "ok";
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

/** Next entry (wrap). Returns repo-relative zip path or null. */
export function goNext(): string | null {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return null;
  store.currentIndex = (store.currentIndex + 1) % pl.entries.length;
  persist();
  return pl.entries[store.currentIndex] ?? null;
}

/** Previous entry (wrap). */
export function goPrev(): string | null {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return null;
  const n = pl.entries.length;
  store.currentIndex = ((store.currentIndex < 0 ? 0 : store.currentIndex) - 1 + n) % n;
  persist();
  return pl.entries[store.currentIndex] ?? null;
}

export function getPlaylistLabel(): string {
  const pl = getActivePlaylist();
  if (!pl?.entries.length) return "—";
  const idx = store.currentIndex;
  const pos = idx >= 0 ? String(idx + 1) : "—";
  return `${pos} / ${pl.entries.length}`;
}
