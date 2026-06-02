// Smoke tests for compileMatcher's `match` (operative-branch) surface.
//
// Per testing-principles "over-testing thin wrappers": this is a thin
// composition of compileRule + toRelativePosix, both tested elsewhere.
// We only cover (a) the public shape, (b) the OR-across-rules semantic
// (the wrapper's job), and (c) the cwd-escape guard (otherwise rules with
// paths=[] could leak across the cwd boundary).

import { describe, expect, it } from "vitest";
import type { Rule } from "../discovery/index.js";
import { compileMatcher } from "./index.js";

const rule = (id: string, overrides: Partial<Rule> = {}): Rule => ({
  id: `/abs/${id}.md`,
  sourcePath: `/abs/${id}.md`,
  source: "pi",
  description: id,
  paths: [],
  body: "",
  ...overrides,
});

describe("compileMatcher", () => {
  it("empty rules → match() always returns []", () => {
    const m = compileMatcher([]);
    expect(m.match("/cwd/src/a.ts", "/cwd")).toEqual([]);
  });

  it("returns matching rules in input order (OR across rules)", () => {
    const a = rule("a", { paths: ["**/*.ts"] });
    const b = rule("b", { paths: ["docs/**"] });
    const c = rule("c", { paths: ["src/**"] });
    const m = compileMatcher([a, b, c]);
    expect(m.match("/cwd/src/x.ts", "/cwd")).toEqual([a, c]);
  });

  it("always-on rule (paths=[]) returns [] for paths outside cwd", () => {
    // Otherwise an always-on rule would fire on, e.g., /etc/passwd reads.
    const r = rule("r", { paths: [] });
    const m = compileMatcher([r]);
    expect(m.match("/outside/x.ts", "/cwd")).toEqual([]);
  });
});
