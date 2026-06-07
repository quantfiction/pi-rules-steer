// Load-bearing invariants for the rule-injection semantics. Each test pins
// a single behavior that a future agent might be tempted to "simplify" — the
// `#given … #when … #then …` framing makes the contract searchable.
//
// Overlaps with src/index.test.ts intentionally: that file is read by CI,
// this one is read by humans-and-agents reasoning about whether a change is
// safe. If an invariant here ever fails, the change is almost certainly a
// regression, even if other tests still pass.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import piRulesSteerExtension from "./index.js";
import { clearInjectionLog, injectionLog } from "./runtime/injection-log.js";
import { makeFakePi, makeToolResult } from "./testing/fake-pi.js";

function mkProject(rule: { paths: string[]; body: string }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-inv-"));
  mkdirSync(path.join(dir, ".pi", "rules"), { recursive: true });
  writeFileSync(
    path.join(dir, ".pi", "rules", "r.md"),
    `---\ndescription: t\npaths: ${JSON.stringify(rule.paths)}\n---\n${rule.body}`,
  );
  return dir;
}

let cleanup: Array<() => void> = [];
beforeEach(() => clearInjectionLog());
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  clearInjectionLog();
});

describe("Invariant 1 — operative parity", () => {
  it("#given a rule paths:['docs/**'] #when read docs/foo.md #then rule body prepended", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs/foo.md" }, { content: [{ type: "text", text: "FILE" }] }),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    expect(result.content).toEqual([
      { type: "text", text: "DOCS_RULE" },
      { type: "text", text: "FILE" },
    ]);
  });
});

describe("Invariant 2 — scope single-inject", () => {
  it("#given a rule paths:['docs/**'] #when grep path:'docs' #then ONE rule body prepended", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire(
      "tool_result",
      makeToolResult(
        { path: "docs", pattern: "TODO" },
        { toolName: "grep", content: [{ type: "text", text: "docs/a.md:1:TODO" }] },
      ),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    expect(result.content[0]).toEqual({ type: "text", text: "DOCS_RULE" });
    // exactly one rule body
    expect(result.content.filter((c) => c.text === "DOCS_RULE")).toHaveLength(1);
    expect(injectionLog).toHaveLength(1);
  });
});

describe("Invariant 3 — no fan-out across results", () => {
  it("#given grep returns 14 matching paths #when scope matches a rule #then ONE inject, not 14", async () => {
    // The handler must NOT iterate over e.content to match rules per-result.
    // A regression here would re-introduce the per-file fan-out that scope-mode
    // was designed to eliminate.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const grepResults = Array.from({ length: 14 }, (_, i) => ({
      type: "text" as const,
      text: `docs/file-${i}.md:1:TODO`,
    }));

    const result = (await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "TODO" }, { toolName: "grep", content: grepResults }),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    // Content: 1 rule body + 14 originals = 15 items
    expect(result.content).toHaveLength(15);
    expect(result.content[0]).toEqual({ type: "text", text: "DOCS_RULE" });
    // Rule body appears exactly once
    expect(result.content.filter((c) => c.text === "DOCS_RULE")).toHaveLength(1);
    // Originals passed through unmodified, in order
    expect(result.content.slice(1)).toEqual(grepResults);
    // And the injection log has exactly one entry, not 14
    expect(injectionLog).toHaveLength(1);
  });
});

describe("Invariant 4 — no injection without scope", () => {
  it("#given grep with no path arg and no glob #when fired #then returns void (no global rule fire)", async () => {
    // A grep call without a scope argument could match every rule in the
    // project. The scope branch must short-circuit on null/null to avoid
    // dumping the entire rule set on a single broad search.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult({ pattern: "TODO" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });
});

describe("Invariant 5 — dedup across calls (operative ↔ scope)", () => {
  it("#given rule fired on previous read #when grep scope matches same rule #then NOT re-injected", async () => {
    // The shared injectedIds Set is the load-bearing primitive here.
    // Separating it (one set per branch) would re-introduce duplicate
    // rule bodies in the same session.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    expect(injectionLog).toHaveLength(1);

    const r2 = await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "TODO" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });
});

describe("Invariant 6 — per-session reset", () => {
  it("#given rule fired in session A #when session_shutdown + session_start #then injectedIds cleared", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);

    await fp.fire("session_start", {}, { cwd: dir });
    const r1 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    await fp.fire("session_shutdown", {}, { cwd: dir });

    await fp.fire("session_start", {}, { cwd: dir });
    const r2 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), { cwd: dir });
    expect(r2).not.toBeUndefined();
    expect(injectionLog).toHaveLength(2);
  });
});

describe("Invariant 7 — operative-then-search composition", () => {
  it("#given read docs/foo.md fires rule #when grep docs/ then read docs/bar.md #then exactly ONE inject total", async () => {
    // Composition stress test. Three events, all scope-overlap a single rule.
    // Only the first should inject; the remaining two must be silent.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    // 1. read docs/foo.md → operative inject
    const r1 = await fp.fire("tool_result", makeToolResult({ path: "docs/foo.md" }), {
      cwd: dir,
    });
    expect(r1).not.toBeUndefined();

    // 2. grep docs/ → rule already in injectedIds, no re-inject
    const r2 = await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "TODO" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(r2).toBeUndefined();

    // 3. read docs/bar.md → still no re-inject (same rule id)
    const r3 = await fp.fire("tool_result", makeToolResult({ path: "docs/bar.md" }), {
      cwd: dir,
    });
    expect(r3).toBeUndefined();

    expect(injectionLog).toHaveLength(1);
  });
});

describe("Invariant 8 — bash branch parity (v0.2)", () => {
  it("#given rule paths:['docs/**'] #when bash 'grep TODO docs/api.md' #then rule body prepended once", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire(
      "tool_result",
      makeToolResult(
        { command: "grep TODO docs/api.md" },
        { toolName: "bash", content: [{ type: "text", text: "docs/api.md:42:TODO" }] },
      ),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    expect(result.content[0]).toEqual({ type: "text", text: "DOCS_RULE" });
    expect(result.content.filter((c) => c.text === "DOCS_RULE")).toHaveLength(1);
    expect(injectionLog).toHaveLength(1);
  });

  it("#given same rule #when bash 'cat docs/auth.md' #then rule body prepended", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire(
      "tool_result",
      makeToolResult(
        { command: "cat docs/auth.md" },
        { toolName: "bash", content: [{ type: "text", text: "# Auth" }] },
      ),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    expect(result.content[0]).toEqual({ type: "text", text: "DOCS_RULE" });
    expect(injectionLog).toHaveLength(1);
  });

  it("#given rule paths:['docs/**'] #when bash 'cat > docs/auth.md <<EOF...' (heredoc-write) #then NO inject", async () => {
    // The agent is WRITING, not reading. Branch 3 must skip redirect shapes
    // even though `docs/auth.md` token would otherwise match.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult(
        { command: "cat > docs/auth.md <<EOF\nbody\nEOF" },
        { toolName: "bash" },
      ),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("#given rule paths:['docs/**'] #when bash 'grep -r TODO docs/' (recursive) #then NO inject (deferred to pi-bash-steer)", async () => {
    // pi-bash-steer's __builtins__grep_recursive blocks this shape at
    // tool_call. If it slips through (warn mode, missing extension), we
    // STILL bail — the architectural separation says recursive shapes are
    // anti-patterns covered by Branch 2 via pi-bash-steer's redirect.
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult({ command: "grep -r TODO docs/" }, { toolName: "bash" }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });
});

describe("Invariant 9 — cross-branch single-inject (Branch 2 + Branch 3)", () => {
  it("#given bash grep fired rule #when pi-native grep on same scope #then NOT re-injected", async () => {
    // The shared injectedIds Set must span all three branches. A bash-origin
    // injection in Branch 3 must dedup against a subsequent pi-native
    // grep call in Branch 2 (same rule id).
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire(
      "tool_result",
      makeToolResult({ command: "grep TODO docs/api.md" }, { toolName: "bash" }),
      { cwd: dir },
    );
    expect(r1).not.toBeUndefined();
    expect(injectionLog).toHaveLength(1);

    const r2 = await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "TODO" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });

  it("#given operative read fired rule #when bash 'cat docs/x.md' #then NOT re-injected", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), {
      cwd: dir,
    });
    expect(r1).not.toBeUndefined();

    const r2 = await fp.fire(
      "tool_result",
      makeToolResult({ command: "cat docs/x.md" }, { toolName: "bash" }),
      { cwd: dir },
    );
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });
});

describe("Invariant 10 — bash branch no-match silence", () => {
  it("#given rule paths:['docs/**'] #when bash 'cat src/index.ts' #then NO inject (out-of-scope)", async () => {
    const dir = mkProject({ paths: ["docs/**"], body: "DOCS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult({ command: "cat src/index.ts" }, { toolName: "bash" }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("#given any rule #when bash 'echo hello' or 'pnpm test' #then NO inject (unrecognized verb)", async () => {
    const dir = mkProject({ paths: ["**"], body: "ALWAYS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    for (const command of ["echo hello", "pnpm test", "git status", "node script.js"]) {
      const result = await fp.fire(
        "tool_result",
        makeToolResult({ command }, { toolName: "bash" }),
        { cwd: dir },
      );
      expect(result).toBeUndefined();
    }
    expect(injectionLog).toHaveLength(0);
  });

  it("#given any rule #when bash command is missing or empty #then NO inject (defensive)", async () => {
    const dir = mkProject({ paths: ["**"], body: "ALWAYS_RULE" });
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    expect(
      await fp.fire("tool_result", makeToolResult({}, { toolName: "bash" }), { cwd: dir }),
    ).toBeUndefined();
    expect(
      await fp.fire("tool_result", makeToolResult({ command: "" }, { toolName: "bash" }), {
        cwd: dir,
      }),
    ).toBeUndefined();
    expect(
      await fp.fire(
        "tool_result",
        makeToolResult({ command: 42 }, { toolName: "bash" }),
        { cwd: dir },
      ),
    ).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });
});
