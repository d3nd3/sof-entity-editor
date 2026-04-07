/** Parse `entities.txt`: one classname per line; empty lines and `//` comments skipped. */
export function parseEntityCatalog(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("//")) continue;
    out.push(s);
  }
  return out;
}
