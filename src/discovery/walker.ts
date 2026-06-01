// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/discovery/walker.{js,d.ts}.
// See NOTICE for attribution.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function enumerateRuleFiles(root: string): Promise<string[]> {
  try {
    await stat(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile() && !e.isSymbolicLink()) continue;
    if (!e.name.endsWith(".md")) continue;
    // Node 20+: parentPath. Older field name: path. Fall back to root.
    const parent =
      (e as unknown as { parentPath?: string }).parentPath ??
      (e as unknown as { path?: string }).path ??
      root;
    out.push(path.join(parent, e.name));
  }
  return out;
}
