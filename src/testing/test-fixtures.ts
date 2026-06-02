// Test helper: build a throwaway project directory under tmpdir with .pi/rules
// and/or .claude/rules populated. Returned `cleanup()` removes the temp dir.
// Inline per-test fixtures (not a shared static fixture) so each test's rule
// set is visible at the call site.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RuleSpec = {
  /** Filename within the rule root (e.g. "style.md"). */
  name: string;
  /** Rule body markdown. Defaults to "RULE_BODY". */
  body?: string;
  /** Frontmatter `paths` array. Omit for an always-on rule. */
  paths?: string[];
  /** Frontmatter `description`. Defaults to "test rule". */
  description?: string;
};

export type FixtureSpec = {
  piRules?: RuleSpec[];
  claudeRules?: RuleSpec[];
};

export type Fixture = {
  dir: string;
  cleanup: () => void;
};

function renderRule(spec: RuleSpec): string {
  const desc = spec.description ?? "test rule";
  const pathsLine =
    spec.paths === undefined ? "" : `\npaths: ${JSON.stringify(spec.paths)}`;
  const body = spec.body ?? "RULE_BODY";
  return `---\ndescription: ${desc}${pathsLine}\n---\n${body}`;
}

function writeRules(root: string, specs: RuleSpec[]): void {
  mkdirSync(root, { recursive: true });
  for (const spec of specs) {
    writeFileSync(path.join(root, spec.name), renderRule(spec));
  }
}

export function mkFixture(spec: FixtureSpec = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-fx-"));
  if (spec.piRules) writeRules(path.join(dir, ".pi", "rules"), spec.piRules);
  if (spec.claudeRules)
    writeRules(path.join(dir, ".claude", "rules"), spec.claudeRules);
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Convenience: a single pi-source rule with the given paths/body. The most
 * common shape in our integration tests.
 */
export function mkSingleRuleFixture(paths: string[], body = "RULE_BODY"): Fixture {
  return mkFixture({
    piRules: [{ name: "r.md", paths, body }],
  });
}
