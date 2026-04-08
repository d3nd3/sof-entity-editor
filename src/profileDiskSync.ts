import type { EntityBlock } from "./entities";
import { serializeEntityString } from "./entities";
import { getCurrentProfileSlug, sanitizeMapRelPath, sanitizeProfileSlug } from "./entityProfiles";

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * When a profile is active (`getCurrentProfileSlug()`), debounce-save current entities to
 * `entity-profiles/<profile>/<mapRel>.txt` via the Vite dev server (dev only).
 */
export function scheduleProfileEntityFileSync(opts: {
  getBlocks: () => EntityBlock[];
  mapEntityRel: string;
  debounceMs?: number;
}) {
  if (!import.meta.env.DEV) return;
  if (!getCurrentProfileSlug()) return;
  const ms = opts.debounceMs ?? 400;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushProfileEntityFile(opts.getBlocks(), opts.mapEntityRel);
  }, ms);
}

async function pushProfileEntityFile(blocks: EntityBlock[], mapEntityRel: string) {
  const slug = getCurrentProfileSlug();
  if (!slug) return;
  const profile = sanitizeProfileSlug(slug);
  const mapRel = sanitizeMapRelPath(mapEntityRel);
  const text = serializeEntityString(blocks);
  try {
    const r = await fetch("/api/save-entity-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, mapRel, text }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.warn("[entity-profile sync]", r.status, t);
    }
  } catch (e) {
    console.warn("[entity-profile sync]", e);
  }
}
