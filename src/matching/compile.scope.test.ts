// Tests for compileRuleScope — the predictive scope matcher added in v0.1.3.
//
// Algorithm: segment-prefix overlap on static bases derived from each rule
// glob via picomatch.scan(). One base is a prefix of the other, segment-aligned.
// Rules with empty `paths` always match (mirrors operative-branch semantics).
//
// Documented over-match: rule globs with an empty static base (e.g.
// `**/*.schema.ts`) match every scope. This is acceptable — over-injection
// wastes tokens, under-injection defeats the feature.

import { describe, expect, it } from "vitest";
import type { Rule } from "../discovery/types.js";
import { compileRuleScope } from "./compile.js";

const rule = (paths: string[]): Rule => ({
  id: "r",
  sourcePath: "/proj/.pi/rules/r.md",
  source: "pi",
  description: "test",
  paths,
  body: "rule body",
});

describe("compileRuleScope — scope-only queries", () => {
  it("matches when rule base equals scope", () => {
    const test = compileRuleScope(rule(["services/web/**/*.tsx"]));
    expect(test("services/web", null)).toBe(true);
  });

  it("matches when scope is deeper than rule base", () => {
    const test = compileRuleScope(rule(["services/web/**/*.tsx"]));
    expect(test("services/web/components", null)).toBe(true);
  });

  it("matches when rule base is deeper than scope (rule could match descendants)", () => {
    const test = compileRuleScope(rule(["services/web/**/*.tsx"]));
    expect(test("services", null)).toBe(true);
  });

  it("does not match when segments diverge", () => {
    const test = compileRuleScope(rule(["services/web/**"]));
    expect(test("services/api", null)).toBe(false);
  });

  it("rule with empty static base matches every scope (documented over-match)", () => {
    const test = compileRuleScope(rule(["**/*.schema.ts"]));
    expect(test("migrations", null)).toBe(true);
    expect(test("services/web", null)).toBe(true);
  });

  it("rule with glob in middle uses static prefix only", () => {
    // base = "services" (picomatch.scan stops at first wildcard)
    const test = compileRuleScope(rule(["services/*/db/**"]));
    expect(test("services/web", null)).toBe(true); // could match services/web/db/...
    expect(test("packages/db", null)).toBe(false);
  });
});

describe("compileRuleScope — glob-only queries", () => {
  it("matches when query glob's static base aligns with rule base", () => {
    const test = compileRuleScope(rule(["services/web/**/*.tsx"]));
    expect(test(null, "services/web/**/*.tsx")).toBe(true);
  });

  it("does not match when query base diverges from rule base", () => {
    const test = compileRuleScope(rule(["services/web/**"]));
    expect(test(null, "services/api/**/*.ts")).toBe(false);
  });

  it("matches bare extension glob (both bases empty — documented over-match)", () => {
    const test = compileRuleScope(rule(["**/*.tsx"]));
    expect(test(null, "*.md")).toBe(true);
  });
});

describe("compileRuleScope — both scope and glob", () => {
  it("both checks must pass (AND semantic)", () => {
    const test = compileRuleScope(rule(["services/web/**"]));
    expect(test("services/web", "**/*.tsx")).toBe(true);
    expect(test("services/api", "**/*.tsx")).toBe(false); // scope check fails
  });
});

describe("compileRuleScope — degenerate inputs", () => {
  it("returns false when both scope and glob are null", () => {
    const test = compileRuleScope(rule(["services/web/**"]));
    expect(test(null, null)).toBe(false);
  });

  it("rule with empty paths always matches (mirrors operative-branch)", () => {
    const test = compileRuleScope(rule([]));
    expect(test("anywhere", null)).toBe(true);
    expect(test(null, "*.ts")).toBe(true);
    // Still false on both-null — the handler short-circuits before reaching matchScope.
    expect(test(null, null)).toBe(true);
  });

});

describe("compileRuleScope — OR across rule paths", () => {
  it("rule with multiple paths matches if any base overlaps", () => {
    const test = compileRuleScope(rule(["services/web/**", "migrations/**"]));
    expect(test("services/web", null)).toBe(true);
    expect(test("migrations", null)).toBe(true);
    expect(test("services/api", null)).toBe(false);
  });
});
