import { unzipSync } from "fflate";
import { readCachedZip, writeCachedZip } from "./sof1mapsCache";

/** Raw tree: https://github.com/plowsof/sof1maps */
export const SOF1MAPS_RAW_BASE = "https://raw.githubusercontent.com/plowsof/sof1maps/main";
const GH_API = "https://api.github.com/repos/plowsof/sof1maps/contents";

export const SOF1MAPS_FOLDERS = ["dm", "exp", "bt", "test", "tgw", "user-server", "server-sp-sounds"] as const;

/** Default pack used for automatic fetch on startup. */
export const DEFAULT_SOF1MAPS_ZIP = "dm/doom2sof.zip";

export function rawUrl(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  return `${SOF1MAPS_RAW_BASE}/${parts.map(encodeURIComponent).join("/")}`;
}

type GhEntry = { name: string; type: string };

/** Lists `.zip` filenames in a repo folder (e.g. `dm`). */
export async function listZipMaps(folder: string): Promise<string[]> {
  const u = `${GH_API}/${encodeURIComponent(folder)}?ref=main`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`GitHub API ${r.status} ${r.statusText}`);
  const j: unknown = await r.json();
  if (!Array.isArray(j)) throw new Error("Unexpected GitHub API response");
  return (j as GhEntry[])
    .filter((x) => x.type === "file" && x.name.toLowerCase().endsWith(".zip"))
    .map((x) => x.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Picks the main `.bsp` inside a SoF map zip (usually `maps/<cat>/<name>.bsp`). */
export function pickBspFromZip(zipBytes: ArrayBuffer, zipFileName: string): { bspName: string; bsp: ArrayBuffer } {
  const stem = zipFileName.replace(/^.*\//, "").replace(/\.zip$/i, "");
  const files = unzipSync(new Uint8Array(zipBytes));
  const paths = Object.keys(files).filter((p) => /\.bsp$/i.test(p));
  if (!paths.length) throw new Error("ZIP contains no .bsp file");

  const lower = (s: string) => s.toLowerCase();
  const stemL = lower(stem);
  let pick =
    paths.find((p) => lower(p).endsWith(`/${stemL}.bsp`)) ??
    paths.find((p) => lower(p) === `${stemL}.bsp`) ??
    paths.find((p) => /\/maps\//i.test(p)) ??
    [...paths].sort((a, b) => a.localeCompare(b))[0];

  const u8 = files[pick]!;
  const bsp = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  const bspName = pick.replace(/^.*\//, "");
  return { bspName, bsp };
}

export async function fetchZipFromSof1maps(relPath: string): Promise<{ data: ArrayBuffer; fromCache: boolean }> {
  const cached = await readCachedZip(relPath).catch(() => undefined);
  if (cached) return { data: cached, fromCache: true };
  const url = rawUrl(relPath);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${relPath}: ${r.status} ${r.statusText}`);
  const buf = await r.arrayBuffer();
  writeCachedZip(relPath, buf).catch((err) => {
    console.warn("[sof-entity-editor] IndexedDB cache write failed (private mode / blocked storage?):", err);
  });
  return { data: buf, fromCache: false };
}

export async function fetchBspFromSof1mapsZip(
  relPath: string
): Promise<{ bspName: string; bsp: ArrayBuffer; zipFromCache: boolean }> {
  const zipName = relPath.replace(/^.*\//, "");
  const { data, fromCache } = await fetchZipFromSof1maps(relPath);
  const { bspName, bsp } = pickBspFromZip(data, zipName);
  return { bspName, bsp, zipFromCache: fromCache };
}

/**
 * Build repo-relative zip path from folder + user text (e.g. `doom2sof` → `dm/doom2sof.zip`).
 * If the text already contains `/`, it is treated as a path from repo root (still adds `.zip` when missing).
 */
export function resolveSof1mapsZipPath(folder: string, input: string): string {
  let t = input.trim().replace(/^\/+/, "");
  if (!t) return "";
  if (!t.includes("/")) t = `${folder.replace(/\/+$/, "")}/${t}`;
  if (!/\.zip$/i.test(t)) {
    const base = t.split("/").pop() ?? "";
    if (!base.includes(".")) t += ".zip";
  }
  return t;
}
