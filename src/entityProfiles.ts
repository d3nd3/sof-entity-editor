import { strToU8, zipSync } from "fflate";

/** Bundled repo files live here so Vite can import them. Exported zips use `<profile>/<mapRel>.txt` at repo root. */
export const ENTITY_PROFILES_DIR = "entity-profiles";

export const LS_CURRENT_PROFILE = "sof-entity-editor-current-profile-v1";

const bundled = import.meta.glob("../entity-profiles/**/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const bundledByPathLower = new Map<string, string>();

for (const [k, text] of Object.entries(bundled)) {
  const repoPath = k.replace(/^\.\.\//, "").replace(/\\/g, "/");
  bundledByPathLower.set(repoPath.toLowerCase(), typeof text === "string" ? text : String(text));
}

export type BundledMapTxt = { repoPath: string; text: string };

export function listBundledMapTxts(): BundledMapTxt[] {
  return Object.entries(bundled).map(([k, text]) => ({
    repoPath: k.replace(/^\.\.\//, "").replace(/\\/g, "/"),
    text: typeof text === "string" ? text : String(text),
  }));
}

export function getCurrentProfileSlug(): string | null {
  try {
    const v = localStorage.getItem(LS_CURRENT_PROFILE);
    if (!v?.trim()) return null;
    return sanitizeProfileSlug(v);
  } catch {
    return null;
  }
}

export function setCurrentProfileSlug(slug: string | null): void {
  try {
    if (!slug?.trim()) localStorage.removeItem(LS_CURRENT_PROFILE);
    else localStorage.setItem(LS_CURRENT_PROFILE, sanitizeProfileSlug(slug));
  } catch {
    /* ignore */
  }
}

export function sanitizeProfileSlug(s: string): string {
  const t = s.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return t || "profile";
}

/** `dm/iraq_small.zip` → `dm/iraq_small` */
export function zipRelToMapPath(zipRel: string): string {
  let t = zipRel.trim().replace(/\\/g, "/");
  if (!t) return "map";
  if (t.toLowerCase().endsWith(".zip")) t = t.slice(0, -4);
  return sanitizeMapRelPath(t);
}

/** Safe relative map path (folders + stem, no `.txt`). */
export function sanitizeMapRelPath(rel: string): string {
  const parts = rel
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((seg) => sanitizeProfileSlug(seg.replace(/\.(zip|txt)$/i, "")));
  return parts.length ? parts.join("/") : "map";
}

export function listBundledProfileSlugs(): string[] {
  const s = new Set<string>();
  const re = /^entity-profiles\/([^/]+)\//i;
  for (const p of bundledByPathLower.keys()) {
    const m = p.match(re);
    if (m?.[1]) s.add(m[1]!);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

/** Bundled layout: `entity-profiles/<profile>/<mapRel>.txt` */
export function getBundledMapEntityText(profile: string, mapRel: string): string | undefined {
  const p = sanitizeProfileSlug(profile);
  const mr = sanitizeMapRelPath(mapRel);
  return bundledByPathLower.get(`${ENTITY_PROFILES_DIR}/${p}/${mr}.txt`.toLowerCase());
}

/**
 * Zip to extract at repo root: `<profile>/<mapRel>.txt` (Quake entities, CRLF newlines).
 */
export function buildProfileMapEntityZip(profileSlug: string, mapRel: string, entityText: string): Uint8Array {
  const p = sanitizeProfileSlug(profileSlug);
  const mr = sanitizeMapRelPath(mapRel);
  const normalized = entityText.replace(/\r?\n/g, "\r\n");
  return zipSync({ [`${p}/${mr}.txt`]: strToU8(normalized) });
}
