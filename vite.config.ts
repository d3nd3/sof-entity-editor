import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Must not trigger Vite's watcher: those .txt files are in `import.meta.glob` and would full-reload the app. */
const ENTITY_PROFILES_DIR_ABS = path.resolve(__dirname, "entity-profiles");

function safeProfileSlug(s: string): string {
  const t = s.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return t || "profile";
}

/** Match client `sanitizeMapRelPath` enough for safe disk paths (no `..`). */
function safeMapRelSegments(mapRel: string): string[] {
  return mapRel
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/\.(zip|txt)$/i, ""))
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "x");
}

function resolveProfileTxtPath(root: string, profileIn: string, mapRelIn: string): string | null {
  const profile = safeProfileSlug(profileIn);
  const segs = safeMapRelSegments(mapRelIn);
  if (!segs.length) segs.push("map");
  const leaf = segs.pop()!;
  const rootR = path.resolve(root);
  const base = path.resolve(rootR, profile);
  if (!base.startsWith(rootR + path.sep) && base !== rootR) return null;
  const dest = path.resolve(base, ...segs, `${leaf}.txt`);
  if (!dest.startsWith(base + path.sep) && dest !== base) return null;
  return dest;
}

/** Same paths as POST save — reads live disk (dev) because `entity-profiles/` is ignored from Vite glob/watch. */
function entityProfileReadMiddleware() {
  return (req, res, next) => {
    const rawUrl = req.url ?? "";
    const url = rawUrl.split("?")[0];
    if (url !== "/api/load-entity-profile" || req.method !== "GET") return next();
    try {
      const u = new URL(rawUrl, "http://vite.local");
      const profile = String(u.searchParams.get("profile") ?? "");
      const mapRel = String(u.searchParams.get("mapRel") ?? "");
      if (!profile.trim() || !mapRel.trim()) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("missing profile or mapRel");
        return;
      }
      const root = path.resolve(__dirname, "entity-profiles");
      const dest = resolveProfileTxtPath(root, profile, mapRel);
      if (!dest) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("invalid path");
        return;
      }
      if (!fs.existsSync(dest)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(fs.readFileSync(dest, "utf8"));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(e instanceof Error ? e.message : String(e));
    }
  };
}

function entityProfileWriteMiddleware() {
  return (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/save-entity-profile" || req.method !== "POST") return next();
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = JSON.parse(raw) as { profile?: string; mapRel?: string; text?: string };
        const profile = String(body.profile ?? "");
        const mapRel = String(body.mapRel ?? "");
        const text = typeof body.text === "string" ? body.text : "";
        if (!profile.trim() || !mapRel.trim()) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("missing profile or mapRel");
          return;
        }
        const root = path.resolve(__dirname, "entity-profiles");
        const dest = resolveProfileTxtPath(root, profile, mapRel);
        if (!dest) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("invalid path");
          return;
        }
        const normalized = text.replace(/\r?\n/g, "\n");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === normalized) {
          res.statusCode = 204;
          res.end();
          return;
        }
        fs.writeFileSync(dest, normalized, "utf8");
        res.statusCode = 204;
        res.end();
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(e instanceof Error ? e.message : String(e));
      }
    });
  };
}

export default defineConfig({
  server: {
    port: 5173,
    watch: {
      ignored: [ENTITY_PROFILES_DIR_ABS, "**/entity-profiles/**"],
    },
  },
  plugins: [
    {
      name: "entity-profile-disk-sync",
      configureServer(server) {
        server.middlewares.use(entityProfileReadMiddleware());
        server.middlewares.use(entityProfileWriteMiddleware());
      },
    },
  ],
});
