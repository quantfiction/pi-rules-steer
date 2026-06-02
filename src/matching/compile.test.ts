// Ported from forge-flow upstream tests/unit/matching/compile.spec.ts.
// Tests compileRule (operative-branch matcher): empty paths = always-on,
// scoped paths via picomatch, OR semantics across an array, dotfile inclusion,
// nonegate (leading `!` is literal), and malformed-glob handling with a single
// stderr warning per bad glob.
//
// Adapted for fork: stderr prefix is [pi-rules-steer], not [pi-rules].

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule } from "../discovery/index.js";
import { compileRule } from "./compile.js";

const baseRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "/abs/.pi/rules/r.md",
  sourcePath: "/abs/.pi/rules/r.md",
  source: "pi",
  description: "d",
  paths: [],
  body: "",
  ...overrides,
});

let stderr: string;
beforeEach(() => {
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

describe("compileRule — always-on (empty paths)", () => {
  it("empty paths matches every relative path", () => {
    const test = compileRule(baseRule({ paths: [] }));
    expect(test("src/a.ts")).toBe(true);
    expect(test("docs/x.md")).toBe(true);
    expect(test("anything")).toBe(true);
  });
});

describe("compileRule — paths (scoped)", () => {
  it("paths match exact pattern, do not match other extensions", () => {
    const test = compileRule(baseRule({ paths: ["src/**/*.ts"] }));
    expect(test("src/a/b.ts")).toBe(true);
    expect(test("src/a/b.js")).toBe(false);
    expect(test("tests/a.ts")).toBe(false);
  });

  it("array paths OR-join", () => {
    const test = compileRule(baseRule({ paths: ["src/**", "tests/**"] }));
    expect(test("src/a.ts")).toBe(true);
    expect(test("tests/a.ts")).toBe(true);
    expect(test("docs/a.md")).toBe(false);
  });

  it("dot:true is set (matches dotfile-prefixed paths)", () => {
    const test = compileRule(baseRule({ paths: [".pi/**"] }));
    expect(test(".pi/rules/x.md")).toBe(true);
  });

  it("nonegate:true treats leading ! as literal, not negation", () => {
    const test = compileRule(baseRule({ paths: ["!src/legacy/**"] }));
    expect(test("src/app/x.ts")).toBe(false);
    expect(test("src/legacy/x.ts")).toBe(false);
  });
});

describe("compileRule — malformed paths", () => {
  it("!( does not throw, emits one stderr line, never matches", () => {
    const sourcePath = "/abs/.pi/rules/bad.md";
    const test = compileRule(baseRule({ sourcePath, paths: ["!("] }));
    expect(test("anything")).toBe(false);
    expect(stderr).toBe(
      `[pi-rules-steer] invalid glob in "${sourcePath}": "!(" -- never matches\n`,
    );
  });

  it("one bad path does not poison other paths", () => {
    const sourcePath = "/abs/.pi/rules/mixed.md";
    const test = compileRule(baseRule({ sourcePath, paths: ["src/**", "!("] }));
    expect(test("src/a.ts")).toBe(true);
    expect(stderr).toBe(
      `[pi-rules-steer] invalid glob in "${sourcePath}": "!(" -- never matches\n`,
    );
  });

  it("literal-pattern paths (e.g. [unclosed) emit no warning", () => {
    const test = compileRule(baseRule({ paths: ["[unclosed"] }));
    expect(stderr).toBe("");
    expect(test("[unclosed")).toBe(true);
  });

  it("malicious sourcePath with newline/escape chars cannot forge log lines", () => {
    const sourcePath = "/abs/.pi/rules/foo\n[pi-rules-steer] FORGED: bar.md";
    const test = compileRule(baseRule({ sourcePath, paths: ["!("] }));
    expect(test("anything")).toBe(false);
    expect(stderr.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
    expect(stderr).toBe(
      `[pi-rules-steer] invalid glob in ${JSON.stringify(sourcePath)}: "!(" -- never matches\n`,
    );
  });
});
