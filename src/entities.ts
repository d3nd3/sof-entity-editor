export type EntityBlock = { pairs: [string, string][] };

export function parseEntityString(s: string): EntityBlock[] {
  const blocks: EntityBlock[] = [];
  let i = 0;
  const len = s.length;
  while (i < len) {
    while (i < len && /\s/.test(s[i]!)) i++;
    if (i >= len) break;
    if (s[i] !== "{") throw new Error(`Expected '{' at offset ${i}`);
    i++;
    const pairs: [string, string][] = [];
    while (i < len) {
      while (i < len && /\s/.test(s[i]!)) i++;
      if (i < len && s[i] === "}") {
        i++;
        break;
      }
      if (i >= len || s[i] !== '"') throw new Error(`Expected quoted key at offset ${i}`);
      i++;
      const ks = i;
      while (i < len && s[i] !== '"') i++;
      const key = s.slice(ks, i);
      if (i >= len) throw new Error("Unterminated key string");
      i++;
      while (i < len && /\s/.test(s[i]!)) i++;
      if (i >= len || s[i] !== '"') throw new Error(`Expected quoted value at offset ${i}`);
      i++;
      const vs = i;
      while (i < len && s[i] !== '"') i++;
      const val = s.slice(vs, i);
      if (i >= len) throw new Error("Unterminated value string");
      i++;
      pairs.push([key, val]);
    }
    blocks.push({ pairs });
  }
  return blocks;
}

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function serializeEntityString(blocks: EntityBlock[]): string {
  let out = "";
  for (const b of blocks) {
    out += "{\r\n";
    for (const [k, v] of b.pairs) out += `"${esc(k)}" "${esc(v)}"\r\n`;
    out += "}\r\n";
  }
  return out;
}

export function getPair(b: EntityBlock, key: string): string | undefined {
  const p = b.pairs.find(([k]) => k === key);
  return p?.[1];
}

export function setPair(b: EntityBlock, key: string, value: string): void {
  const i = b.pairs.findIndex(([k]) => k === key);
  if (i >= 0) b.pairs[i]![1] = value;
  else b.pairs.push([key, value]);
}

export function parseOrigin(s: string): [number, number, number] | null {
  const parts = s.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if ([x, y, z].some((n) => Number.isNaN(n))) return null;
  return [x, y, z];
}

export function formatOrigin(x: number, y: number, z: number): string {
  return `${x} ${y} ${z}`;
}

/** Yaw in degrees: `angle` key, else yaw from `angles` (`pitch yaw roll`). */
export function parseYawDegrees(b: EntityBlock): number | null {
  const one = getPair(b, "angle");
  if (one !== undefined) {
    const y = Number(one.trim());
    if (!Number.isNaN(y)) return y;
  }
  const tri = getPair(b, "angles");
  if (tri !== undefined) {
    const p = tri.trim().split(/\s+/);
    if (p.length >= 2) {
      const yaw = Number(p[1]);
      if (!Number.isNaN(yaw)) return yaw;
    }
  }
  return null;
}
