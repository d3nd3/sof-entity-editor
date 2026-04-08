/**
 * Browser persistence: last sof1maps zip, folder/map fields, recent opens (sof1maps only).
 */

const LS_KEY = "sof-entity-editor-map-cache-v1";
const LS_AUTOLOAD = "sof-entity-editor-autoload-v1";
const MAX_RECENT = 10;

export type MapCache = {
  lastZipRel: string | null;
  sof1mapsFolder: string;
  sof1mapsMapStem: string;
  recentZips: string[];
};

function defaultCache(): MapCache {
  return { lastZipRel: null, sof1mapsFolder: "dm", sof1mapsMapStem: "doom2sof", recentZips: [] };
}

function loadCache(): MapCache {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultCache();
    const j = JSON.parse(raw) as Record<string, unknown>;
    const recentZips = Array.isArray(j.recentZips)
      ? j.recentZips.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT)
      : [];
    return {
      lastZipRel: typeof j.lastZipRel === "string" ? j.lastZipRel : null,
      sof1mapsFolder: typeof j.sof1mapsFolder === "string" ? j.sof1mapsFolder : "dm",
      sof1mapsMapStem: typeof j.sof1mapsMapStem === "string" ? j.sof1mapsMapStem : "doom2sof",
      recentZips,
    };
  } catch {
    return defaultCache();
  }
}

let cache = loadCache();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode */
  }
}

/** Restore folder + map name fields before any auto-load. */
export function applyMapCacheToUi(folderSel: HTMLSelectElement, mapInput: HTMLInputElement) {
  cache = loadCache();
  if ([...folderSel.options].some((o) => o.value === cache.sof1mapsFolder)) folderSel.value = cache.sof1mapsFolder;
  mapInput.value = cache.sof1mapsMapStem;
}

/** After a successful sof1maps zip load. */
export function recordSof1mapsOpen(rel: string) {
  const r = rel.trim();
  if (!r.toLowerCase().endsWith(".zip")) return;
  cache.lastZipRel = r;
  const parts = r.split("/").filter(Boolean);
  const zipFile = parts[parts.length - 1] ?? "";
  const stem = zipFile.replace(/\.zip$/i, "");
  if (parts.length >= 2) cache.sof1mapsFolder = parts[0]!;
  cache.sof1mapsMapStem = stem;
  const rest = cache.recentZips.filter((x) => x !== r);
  cache.recentZips = [r, ...rest].slice(0, MAX_RECENT);
  persist();
}

export function getLastZipRel(): string | null {
  return cache.lastZipRel;
}

export function getRecentZips(): readonly string[] {
  return cache.recentZips;
}

/** Fills the recent-maps `<select>` (placeholder + paths). */
export function populateMapRecentSelect(sel: HTMLSelectElement) {
  cache = loadCache();
  const zips = cache.recentZips;
  sel.replaceChildren();
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = zips.length ? "Recent maps…" : "No recent maps yet";
  sel.appendChild(ph);
  for (const rel of zips) {
    const o = document.createElement("option");
    o.value = rel;
    o.textContent = rel;
    sel.appendChild(o);
  }
  sel.disabled = zips.length === 0;
  sel.selectedIndex = 0;
}

/** Checkbox: load last (or default) map on startup. */
export function loadAutoloadCheckbox(): boolean {
  try {
    const v = localStorage.getItem(LS_AUTOLOAD);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

export function saveAutoloadCheckbox(checked: boolean) {
  try {
    localStorage.setItem(LS_AUTOLOAD, checked ? "1" : "0");
  } catch {
    /* ignore */
  }
}
