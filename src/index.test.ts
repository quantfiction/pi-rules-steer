// Integration tests for the wired extension: real discover() + compileMatcher
// against real .pi/rules/.claude/rules dirs in tmpdir, exercised via a fake
// pi.on/fire event bus.
//
// Adapted from forge-flow upstream tests/unit/index.spec.ts. Fork-specific
// adjustments:
//   - 3 event handlers (no resources_discover; we don't ship a skill)
//   - command name is "pi-rules-steer", not "pi-rules"
//   - stderr prefix is "[pi-rules-steer]", not "[pi-rules]"
//   - doctor header is "pi-rules-steer doctor: …"
//
// New coverage for the scope branch (grep/find/ls/code_search): basic
// happy-path, branch-isolation (operative dedup is shared with scope dedup),
// and the recovery-after-isError semantic.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import piRulesSteerExtension, { makeExtension } from "./index.js";
import { clearInjectionLog, injectionLog } from "./testing/injection-log.js";
import { makeFakePi, makeToolResult } from "./testing/fake-pi.js";

function mkFixtureWithPiRule(paths: string[], body = "RULE_BODY"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-int-"));
  mkdirSync(path.join(dir, ".pi", "rules"), { recursive: true });
  const front = `---\ndescription: t\npaths: ${JSON.stringify(paths)}\n---\n`;
  writeFileSync(path.join(dir, ".pi", "rules", "r.md"), front + body);
  return dir;
}

// ============================================================================
// registration & lifecycle
// ============================================================================

describe("piRulesSteerExtension — registration & lifecycle", () => {
  let cleanup: Array<() => void> = [];
  beforeEach(() => clearInjectionLog());
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
  });

  it("default export is a 1-arg function", () => {
    expect(typeof piRulesSteerExtension).toBe("function");
    expect(piRulesSteerExtension.length).toBe(1);
  });

  it("module exports `default` and `makeExtension` (DI seam, no others)", async () => {
    const mod = await import("./index.js");
    expect(Object.keys(mod).sort()).toEqual(["default", "makeExtension"]);
  });

  it("registers exactly three handlers (session_start, tool_result, session_shutdown)", () => {
    // Fork-specific: upstream registers 4 (incl. resources_discover for the
    // skill). We dropped the skill, so it's 3.
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    expect(fp.registeredNames()).toEqual([
      "session_shutdown",
      "session_start",
      "tool_result",
    ]);
    expect(fp.registrationCount()).toBe(3);
  });

  it("session_shutdown nulls the matcher (subsequent tool_result returns void)", async () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

    await fp.fire("session_start", { type: "session_start", reason: "startup" }, { cwd: dir });
    await fp.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult({ path: "src/a.ts" }, { content: [{ type: "text", text: "ORIG" }] }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("discover() throwing is caught + exactly one stderr line", async () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-fail-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    // .pi/rules as a regular file (not a directory) — stat() resolves, then
    // walker.enumerateRuleFiles() calls readdir() on a non-directory → throws.
    mkdirSync(path.join(dir, ".pi"), { recursive: true });
    writeFileSync(path.join(dir, ".pi", "rules"), "not a directory");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await fp.fire("session_start", { type: "session_start", reason: "startup" }, { cwd: dir });
      const piRulesLines = stderrSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.startsWith("[pi-rules-steer] discovery failed: "));
      expect(piRulesLines).toHaveLength(1);
      expect(piRulesLines[0]).toMatch(/^\[pi-rules-steer\] discovery failed: .+\n$/);
    } finally {
      stderrSpy.mockRestore();
    }

    // After a failed discover, matcher is still set to compileMatcher([]) so
    // tool_result must not throw; it just returns void.
    const result = await fp.fire(
      "tool_result",
      makeToolResult({ path: "src/a.ts" }, { content: [] }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });
});

// ============================================================================
// operative branch (read/edit/write)
// ============================================================================

describe("piRulesSteerExtension — tool_result operative branch", () => {
  let cleanup: Array<() => void> = [];
  beforeEach(() => clearInjectionLog());
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
    clearInjectionLog();
  });

  function assertPosixRelativePaths() {
    expect(
      injectionLog
        .filter((e): e is { ruleId: string; path: string } => "path" in e)
        .every((e) => !/^\//.test(e.path) && !/\\/.test(e.path)),
    ).toBe(true);
  }

  it("matching rule injects with cwd-relative POSIX path", async () => {
    const dir = mkFixtureWithPiRule(["src/**"], "RULE_BODY");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), {
      cwd: dir,
    })) as { content: Array<{ type: "text"; text: string }> };
    expect(result).toEqual({
      content: [
        { type: "text", text: "RULE_BODY" },
        { type: "text", text: "ORIG" },
      ],
    });
    expect(injectionLog).toHaveLength(1);
    const entry = injectionLog[0] as { ruleId: string; path: string };
    expect(entry.path).toBe("src/a.ts");
    const { realpath } = await import("node:fs/promises");
    expect(entry.ruleId).toBe(await realpath(path.join(dir, ".pi", "rules", "r.md")));
    assertPosixRelativePaths();
  });

  it("tool_result with isError:true skips injection and preserves dedup budget", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const errResult = await fp.fire(
      "tool_result",
      makeToolResult({ path: "src/a.ts" }, { isError: true }),
      { cwd: dir },
    );
    expect(errResult).toBeUndefined();
    expect(injectionLog).toHaveLength(0);

    const okResult = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), {
      cwd: dir,
    });
    expect(okResult).not.toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });

  it.each(["bash", "myCustomTool"])(
    "tool_result for %s with no scope arg does not inject (no operative match, no scope arg)",
    async (toolName) => {
      // bash/custom aren't search tools and aren't read/edit/write, so neither
      // branch fires. They get pass-through.
      const dir = mkFixtureWithPiRule(["**"]);
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
      const fp = makeFakePi();
      piRulesSteerExtension(fp);
      await fp.fire("session_start", {}, { cwd: dir });

      const result = await fp.fire(
        "tool_result",
        makeToolResult({ path: "src/a.ts" }, { toolName }),
        { cwd: dir },
      );
      expect(result).toBeUndefined();
      expect(injectionLog).toHaveLength(0);
    },
  );

  it.each(["read", "edit", "write"] as const)(
    "tool_result for %s injects when matched",
    async (toolName) => {
      const dir = mkFixtureWithPiRule(["src/**"]);
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
      const fp = makeFakePi();
      piRulesSteerExtension(fp);
      await fp.fire("session_start", {}, { cwd: dir });

      const result = await fp.fire(
        "tool_result",
        makeToolResult({ path: "src/a.ts" }, { toolName }),
        { cwd: dir },
      );
      expect(result).not.toBeUndefined();
      expect(injectionLog).toHaveLength(1);
    },
  );

  it("relative path resolves against ctx.cwd", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    expect(injectionLog).toHaveLength(1);
    expect((injectionLog[0] as { path: string }).path).toBe("src/a.ts");
    assertPosixRelativePaths();
  });

  it("absolute path inside cwd matches identically", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const abs = path.join(dir, "src", "a.ts");
    await fp.fire("tool_result", makeToolResult({ path: abs }), { cwd: dir });
    expect(injectionLog).toHaveLength(1);
    expect((injectionLog[0] as { path: string }).path).toBe("src/a.ts");
    assertPosixRelativePaths();
  });

  it("path resolving outside cwd returns void", async () => {
    const dir = mkFixtureWithPiRule(["**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const result = await fp.fire("tool_result", makeToolResult({ path: "/etc/hosts" }), {
      cwd: dir,
    });
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("empty-string path returns void", async () => {
    const dir = mkFixtureWithPiRule(["**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const result = await fp.fire("tool_result", makeToolResult({ path: "" }), { cwd: dir });
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it.each([
    ["undefined", undefined],
    ["number", 42],
    ["object", { nested: "x" }],
  ])("non-string path (%s) returns void", async (_label, badPath) => {
    const dir = mkFixtureWithPiRule(["**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const result = await fp.fire(
      "tool_result",
      makeToolResult({ path: badPath as unknown as string }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("zero rules matched returns undefined (not {content: e.content})", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const result = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), {
      cwd: dir,
    });
    expect(result).toBeUndefined();
  });

  it("pi-source rule appears before claude-source rule in content", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-mixed-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, ".pi", "rules"), { recursive: true });
    mkdirSync(path.join(dir, ".claude", "rules"), { recursive: true });
    writeFileSync(
      path.join(dir, ".pi", "rules", "p.md"),
      '---\ndescription: p\npaths: ["**"]\n---\nPI_BODY',
    );
    writeFileSync(
      path.join(dir, ".claude", "rules", "c.md"),
      '---\ndescription: c\npaths: ["**"]\n---\nCLAUDE_BODY',
    );
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const result = (await fp.fire("tool_result", makeToolResult({ path: "x.ts" }), {
      cwd: dir,
    })) as { content: Array<{ type: "text"; text: string }> };
    expect(result.content[0].text).toBe("PI_BODY");
    expect(result.content[1].text).toBe("CLAUDE_BODY");
  });

  it("rule injects once across two events on different paths", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const r1 = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    const r2 = await fp.fire("tool_result", makeToolResult({ path: "src/b.ts" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });

  it("rule injects once across two events on the same path", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });
    const r1 = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    const r2 = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });

  it("two-rule scenario; event 2 returns undefined (not wrapped)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-2r-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, ".pi", "rules"), { recursive: true });
    writeFileSync(
      path.join(dir, ".pi", "rules", "a.md"),
      '---\ndescription: a\npaths: ["src/**"]\n---\nA_BODY',
    );
    writeFileSync(
      path.join(dir, ".pi", "rules", "b.md"),
      '---\ndescription: b\npaths: ["src/a.ts"]\n---\nB_BODY',
    );
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    expect(injectionLog).toHaveLength(2);

    const r2 = await fp.fire("tool_result", makeToolResult({ path: "src/b.ts" }), { cwd: dir });
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(2);
  });

  it("dedup resets across session_shutdown + session_start", async () => {
    const dir = mkFixtureWithPiRule(["src/**"]);
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);

    await fp.fire("session_start", {}, { cwd: dir });
    await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });
    await fp.fire("session_shutdown", {}, { cwd: dir });

    await fp.fire("session_start", {}, { cwd: dir });
    await fp.fire("tool_result", makeToolResult({ path: "src/a.ts" }), { cwd: dir });

    expect(injectionLog).toHaveLength(2);
    expect((injectionLog[0] as { ruleId: string }).ruleId).toBe(
      (injectionLog[1] as { ruleId: string }).ruleId,
    );
  });
});

// ============================================================================
// scope branch (grep/find/ls/code_search)
// ============================================================================

describe("piRulesSteerExtension — tool_result scope branch", () => {
  let cleanup: Array<() => void> = [];
  beforeEach(() => clearInjectionLog());
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
    clearInjectionLog();
  });

  it("grep with matching scope injects ONE rule body prepended", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
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

    expect(result.content[0].text).toBe("DOCS_RULE");
    expect(result.content[1].text).toBe("docs/a.md:1:TODO");
    expect(injectionLog).toHaveLength(1);
    const entry = injectionLog[0];
    expect("viaScope" in entry && entry.viaScope).toBe(true);
  });

  it("grep with no scope and no glob → no injection (avoid global rule explosion)", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
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

  it("grep with scope outside any rule glob → no injection", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = await fp.fire(
      "tool_result",
      makeToolResult({ path: "src", pattern: "TODO" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(result).toBeUndefined();
    expect(injectionLog).toHaveLength(0);
  });

  it("code_search with matching fileGlob injects", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const result = (await fp.fire(
      "tool_result",
      makeToolResult(
        { query: "auth", fileGlob: "docs/**/*.md" },
        { toolName: "code_search" },
      ),
      { cwd: dir },
    )) as { content: Array<{ type: "text"; text: string }> };

    expect(result.content[0].text).toBe("DOCS_RULE");
    expect(injectionLog).toHaveLength(1);
  });
});

// ============================================================================
// branch isolation (shared injectedIds)
// ============================================================================

describe("piRulesSteerExtension — operative ↔ scope dedup (shared injectedIds)", () => {
  let cleanup: Array<() => void> = [];
  beforeEach(() => clearInjectionLog());
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
    clearInjectionLog();
  });

  it("operative read fires rule → subsequent matching grep does NOT re-inject", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), { cwd: dir });
    expect(r1).not.toBeUndefined();
    expect(injectionLog).toHaveLength(1);

    const r2 = await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "x" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });

  it("scope grep fires rule → subsequent matching read does NOT re-inject", async () => {
    const dir = mkFixtureWithPiRule(["docs/**"], "DOCS_RULE");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    await fp.fire("session_start", {}, { cwd: dir });

    const r1 = await fp.fire(
      "tool_result",
      makeToolResult({ path: "docs", pattern: "x" }, { toolName: "grep" }),
      { cwd: dir },
    );
    expect(r1).not.toBeUndefined();
    expect(injectionLog).toHaveLength(1);

    const r2 = await fp.fire("tool_result", makeToolResult({ path: "docs/x.md" }), { cwd: dir });
    expect(r2).toBeUndefined();
    expect(injectionLog).toHaveLength(1);
  });
});

// ============================================================================
// command registration
// ============================================================================

describe("piRulesSteerExtension — slash command", () => {
  it("registers exactly one command named pi-rules-steer with description mentioning doctor", () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    const reg = fp.__registeredCommands.filter((c) => c.name === "pi-rules-steer");
    expect(reg).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: options is unknown in fake
    expect((reg[0]?.options as any).description).toMatch(/doctor/i);
  });

  it("getArgumentCompletions returns doctor for empty/partial prefix", () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    // biome-ignore lint/suspicious/noExplicitAny: options is unknown
    const opts = fp.__registeredCommands.find((c) => c.name === "pi-rules-steer")
      ?.options as any;
    expect(opts.getArgumentCompletions("")).toEqual([{ value: "doctor", label: "doctor" }]);
    expect(opts.getArgumentCompletions("doc")).toEqual([{ value: "doctor", label: "doctor" }]);
    expect(opts.getArgumentCompletions("xyz")).toEqual([]);
  });

  it("handler dispatches doctor subcommand to runDoctor", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-cmd-"));
    mkdirSync(path.join(tmp, ".pi/rules"), { recursive: true });
    try {
      const fp = makeFakePi();
      piRulesSteerExtension(fp);
      await fp.fire("session_start", { type: "session_start", reason: "startup" }, { cwd: tmp });
      // biome-ignore lint/suspicious/noExplicitAny: options is unknown
      const opts = fp.__registeredCommands.find((c) => c.name === "pi-rules-steer")
        ?.options as any;
      const fakeUiCtx = { hasUI: false, ui: { notify: () => {} } };
      await opts.handler("doctor", fakeUiCtx);
      expect(fp.__userMessages.some((m) => m.startsWith("pi-rules-steer doctor: OK"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handler with unknown subcommand emits usage line", async () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    // biome-ignore lint/suspicious/noExplicitAny: options is unknown
    const opts = fp.__registeredCommands.find((c) => c.name === "pi-rules-steer")
      ?.options as any;
    const fakeUiCtx = { hasUI: false, ui: { notify: () => {} } };
    await opts.handler("frobnicate", fakeUiCtx);
    expect(fp.__userMessages).toHaveLength(1);
    expect(fp.__userMessages[0]).toContain("Unknown");
    expect(fp.__userMessages[0]).toContain("doctor");
  });

  it("handler with empty input emits usage line", async () => {
    const fp = makeFakePi();
    piRulesSteerExtension(fp);
    // biome-ignore lint/suspicious/noExplicitAny: options is unknown
    const opts = fp.__registeredCommands.find((c) => c.name === "pi-rules-steer")
      ?.options as any;
    const fakeUiCtx = { hasUI: false, ui: { notify: () => {} } };
    await opts.handler("", fakeUiCtx);
    expect(fp.__userMessages).toHaveLength(1);
    expect(fp.__userMessages[0]).toMatch(/doctor/);
  });
});

// ============================================================================
// runtime stderr parity (mid-session reload)
// ============================================================================

type FakeRuntimeWatcher = { emitChange: () => void; close: () => void; closed: boolean };
function makeFakeWatchFactory() {
  const created: FakeRuntimeWatcher[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: test fake
  const factory: any = (_p: string, _opts: unknown, listener?: any) => {
    const lst = typeof _opts === "function" ? _opts : listener;
    const w: FakeRuntimeWatcher & {
      on: (n: string, h: (...a: unknown[]) => void) => unknown;
    } = {
      closed: false,
      close() {
        this.closed = true;
      },
      on() {
        return this;
      },
      emitChange() {
        lst?.("change", "r.md");
      },
    };
    created.push(w);
    return w;
  };
  return { factory, created };
}

describe("piRulesSteerExtension — stderr parity & mid-session reload", () => {
  it("session_start: emits warn lines for parse_error, silent for skipped_no_frontmatter", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-rt-"));
    const dir = path.join(tmp, ".pi/rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "no-desc.md"), '---\npaths: ["**/*"]\n---\n');
    writeFileSync(path.join(dir, "plain.md"), "no frontmatter\n");

    const lines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const fp = makeFakePi();
      const { factory } = makeFakeWatchFactory();
      makeExtension({ watchFactory: factory, debounceMs: 10 })(fp);
      await fp.fire("session_start", { type: "session_start", reason: "startup" }, { cwd: tmp });
    } finally {
      stderrSpy.mockRestore();
    }
    const piLines = lines.filter((l) => l.startsWith("[pi-rules-steer] skipped"));
    expect(piLines).toEqual([
      "[pi-rules-steer] skipped .pi/rules/no-desc.md: missing description\n",
    ]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("scheduleReload (mid-session): re-emits warn lines after watcher fires", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pi-rules-steer-rt-"));
    const dir = path.join(tmp, ".pi/rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "good.md"), '---\ndescription: g\npaths: ["**/*"]\n---\n');
    const fp = makeFakePi();
    const { factory, created } = makeFakeWatchFactory();
    makeExtension({ watchFactory: factory, debounceMs: 10 })(fp);
    await fp.fire("session_start", { type: "session_start", reason: "startup" }, { cwd: tmp });

    writeFileSync(path.join(dir, "bad.md"), '---\npaths: ["**/*"]\n---\n');
    const lines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      created[0]?.emitChange();
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        if (lines.some((l) => l.includes("bad.md: missing description"))) break;
        await new Promise((r) => setTimeout(r, 5));
      }
    } finally {
      stderrSpy.mockRestore();
    }
    expect(lines.filter((l) => l.startsWith("[pi-rules-steer] skipped"))).toEqual([
      "[pi-rules-steer] skipped .pi/rules/bad.md: missing description\n",
    ]);
    rmSync(tmp, { recursive: true, force: true });
  });
});
