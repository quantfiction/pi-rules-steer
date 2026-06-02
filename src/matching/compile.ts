// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/matching/compile.{js,d.ts}.
// Net-new on top of the upstream fork: compileRuleScope (predictive scope matching
// for search-tool branch in v0.1.3).
// See NOTICE for attribution.

import picomatch from "picomatch";
import type { Rule } from "../discovery/index.js";

const OPTS: picomatch.PicomatchOptions = { dot: true, nonegate: true };

export function compileRule(rule: Rule): (rel: string) => boolean {
  if (rule.paths.length === 0) return () => true;
  const survivors: string[] = [];
  for (const p of rule.paths) {
    try {
      picomatch.makeRe(p, { ...OPTS, debug: true });
      survivors.push(p);
    } catch {
      process.stderr.write(
        `[pi-rules-steer] invalid glob in ${JSON.stringify(rule.sourcePath)}: ${JSON.stringify(p)} -- never matches\n`,
      );
    }
  }
  if (survivors.length === 0) return () => false;
  return picomatch(survivors, OPTS);
}

/**
 * Predictive scope matcher used by the v0.1.3 tool_result scope-rule branch.
 *
 * Returns a predicate that answers: "could any file under the query scope (and/or
 * matching the query glob) satisfy any of this rule's path globs?"
 *
 * Algorithm — segment-prefix overlap on static bases (see docs/decisions in
 * compile.scope.test.ts):
 *   - For each rule path G, derive its static base via picomatch.scan(G).base
 *     and split into segments.
 *   - For a scope query: rule matches if baseSegs and scopeSegs are segment-prefix
 *     compatible (one is a prefix of the other, segment-aligned). Empty rule base
 *     matches every scope (rule glob has no static prefix, e.g. `**` + `*.ts`).
 *   - For a glob-only query (no scope): same predicate, comparing the rule base
 *     to the query glob's static base.
 *   - Both supplied: AND the two checks.
 *
 * Rules with empty `paths` always match (preserves the operative-branch semantic
 * of `compileRule` returning `() => true`).
 *
 * Known over-match: rule globs with empty static base (e.g. `**\/*.schema.ts`)
 * match every scope. Acceptable — over-injection wastes tokens, under-injection
 * defeats the feature.
 */
export function compileRuleScope(
  rule: Rule,
): (scope: string | null, glob: string | null) => boolean {
  if (rule.paths.length === 0) return () => true;
  const bases: string[][] = [];
  for (const p of rule.paths) {
    try {
      picomatch.makeRe(p, { ...OPTS, debug: true });
    } catch {
      // Invalid glob — compileRule already logged. Skip from scope matcher too.
      continue;
    }
    const baseSegs = picomatch.scan(p).base.split("/").filter(Boolean);
    bases.push(baseSegs);
  }
  if (bases.length === 0) return () => false;
  return (scope: string | null, glob: string | null): boolean => {
    if (scope === null && glob === null) return false;
    const scopeSegs = scope === null ? null : scope.split("/").filter(Boolean);
    const querySegs =
      glob === null ? null : picomatch.scan(glob).base.split("/").filter(Boolean);
    return bases.some((baseSegs) => {
      if (scopeSegs !== null && !segmentsOverlap(baseSegs, scopeSegs)) return false;
      if (querySegs !== null && !segmentsOverlap(baseSegs, querySegs)) return false;
      return true;
    });
  };
}

function segmentsOverlap(a: string[], b: string[]): boolean {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
