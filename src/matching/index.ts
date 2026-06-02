// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/matching/index.{js,d.ts}.
// See NOTICE for attribution.

import path from "node:path";
import type { Rule } from "../discovery/index.js";
import { compileRule, compileRuleScope } from "./compile.js";
import { toRelativePosix } from "./path.js";

export type ScopeQuery = {
  scope: string | null;
  glob: string | null;
};

export type Matcher = {
  match(absPath: string, cwd: string): Rule[];
  matchScope(query: ScopeQuery): Rule[];
};

export function compileMatcher(rules: Rule[]): Matcher {
  const compiled = rules.map((rule) => ({
    rule,
    test: compileRule(rule),
    testScope: compileRuleScope(rule),
  }));
  return {
    match(absPath: string, cwd: string): Rule[] {
      if (!cwd || !path.isAbsolute(absPath)) return [];
      const rel = toRelativePosix(absPath, cwd);
      if (rel === null) return [];
      return compiled.filter((c) => c.test(rel)).map((c) => c.rule);
    },
    matchScope({ scope, glob }: ScopeQuery): Rule[] {
      if (scope === null && glob === null) return [];
      return compiled.filter((c) => c.testScope(scope, glob)).map((c) => c.rule);
    },
  };
}
