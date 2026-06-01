// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/discovery/reconcile.{js,d.ts}.
// See NOTICE for attribution.

import type { Rule } from "./types.js";

export function reconcileInjectedIds(
  prev: readonly Rule[],
  next: readonly Rule[],
  ids: Set<string>,
): void {
  const prevById = new Map(prev.map((r) => [r.id, r] as const));
  const nextById = new Map(next.map((r) => [r.id, r] as const));
  for (const id of [...ids]) {
    const nextRule = nextById.get(id);
    if (nextRule === undefined) {
      ids.delete(id);
      continue;
    }
    const prevRule = prevById.get(id);
    if (prevRule === undefined || prevRule.body !== nextRule.body) {
      ids.delete(id);
    }
  }
}
