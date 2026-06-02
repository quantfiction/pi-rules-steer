// Ported from forge-flow upstream tests/unit/discovery/index.spec.ts and
// tests/unit/discovery/user-roots.spec.ts (merged — same module).
//
// Covers the discover() orchestration: project root + user root, realpath
// dedup across .pi/.claude, source tagging, symlink-escape detection (a
// real attack surface: a hostile rule could otherwise reach into ~/), and
// the structured Diagnostic contract (parse_error / skipped_no_frontmatter
// / unreadable / symlink_escape).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discover } from "./index.js";

const VALID_FM = `---\ndescription: D\npaths: ["**"]\n---\nbody\n`;
const ALWAYS_FM = "---\ndescription: D\n---\nbody\n";

// ============================================================================
// project-root discovery
// ============================================================================

describe("discover happy path", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pi-rules-steer-discover-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns rules from both roots, tagged by source", async () => {
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".claude", "rules"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "rules", "foo.md"), VALID_FM);
    await writeFile(path.join(cwd, ".claude", "rules", "bar.md"), VALID_FM);

    const { rules } = await discover(cwd, { home: "" });
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.source === "pi")?.sourcePath).toBe(
      path.join(cwd, ".pi", "rules", "foo.md"),
    );
    expect(rules.find((r) => r.source === "claude")?.sourcePath).toBe(
      path.join(cwd, ".claude", "rules", "bar.md"),
    );
  });

  it("twin files at same relative path are two distinct rules", async () => {
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".claude", "rules"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "rules", "x.md"), VALID_FM);
    await writeFile(path.join(cwd, ".claude", "rules", "x.md"), VALID_FM);

    const { rules } = await discover(cwd, { home: "" });
    expect(rules).toHaveLength(2);
    const ids = new Set(rules.map((r) => r.id));
    expect(ids.size).toBe(2);
  });

  it("claude→pi symlink yields one rule, source pi", async () => {
    if (process.platform === "win32") return;
    const fs = await import("node:fs/promises");
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".claude", "rules"), { recursive: true });
    const target = path.join(cwd, ".pi", "rules", "x.md");
    await writeFile(target, VALID_FM);
    await fs.symlink(target, path.join(cwd, ".claude", "rules", "x.md"));

    const { rules } = await discover(cwd, { home: "" });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("pi");
    expect(rules[0]?.sourcePath).toBe(target);
  });

  it("pi→claude symlink still yields source pi (pi walked first)", async () => {
    if (process.platform === "win32") return;
    const fs = await import("node:fs/promises");
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".claude", "rules"), { recursive: true });
    const target = path.join(cwd, ".claude", "rules", "x.md");
    await writeFile(target, VALID_FM);
    await fs.symlink(target, path.join(cwd, ".pi", "rules", "x.md"));

    const { rules } = await discover(cwd, { home: "" });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("pi");
    expect(rules[0]?.sourcePath).toBe(path.join(cwd, ".pi", "rules", "x.md"));
  });

  it("Rule.id equals realpath(sourcePath) for every rule", async () => {
    const fs = await import("node:fs/promises");
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "rules", "a.md"), VALID_FM);
    const { rules } = await discover(cwd, { home: "" });
    for (const r of rules) {
      expect(r.id).toBe(await fs.realpath(r.sourcePath));
    }
  });
});

describe("discover root errors", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pi-rules-steer-discover-err-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("missing both roots returns [] with no stderr", async () => {
    const errors: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: stderr spy
    (process.stderr.write as any) = (chunk: string) => {
      errors.push(chunk);
      return true;
    };
    try {
      const { rules, diagnostics } = await discover(cwd, { home: "" });
      expect(rules).toEqual([]);
      expect(diagnostics).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      process.stderr.write = orig;
    }
  });

  it("root EACCES on .pi/rules rejects (POSIX only)", async () => {
    if (process.platform === "win32") return;
    const fs = await import("node:fs/promises");
    const root = path.join(cwd, ".pi", "rules");
    await mkdir(root, { recursive: true });
    await fs.chmod(root, 0o000);
    try {
      await expect(discover(cwd, { home: "" })).rejects.toThrow();
    } finally {
      await fs.chmod(root, 0o755);
    }
  });
});

// ============================================================================
// structured diagnostics contract
// ============================================================================

describe("discover diagnostics contract", () => {
  it("returns parse_error for invalid frontmatter (missing description)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "no-desc.md"), '---\npaths: ["**/*"]\n---\nbody\n');
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    expect(rules).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      kind: "parse_error",
      source: "pi",
      reason: "missing description",
    });
    expect(diagnostics[0].absPath.endsWith("no-desc.md")).toBe(true);
    await rm(tmp, { recursive: true });
  });

  it("returns skipped_no_frontmatter for files without frontmatter", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "plain.md"), "no frontmatter here\n");
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    expect(rules).toEqual([]);
    expect(diagnostics).toEqual([
      {
        kind: "skipped_no_frontmatter",
        absPath: path.join(dir, "plain.md"),
        source: "pi",
      },
    ]);
    await rm(tmp, { recursive: true });
  });

  it("returns unreadable when parseRuleFile reports unreadable: <code>", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "x.md"), '---\ndescription: a\npaths: ["**/*"]\n---\n');
    const parseMod = await import("./parse.js");
    const spy = vi.spyOn(parseMod, "parseRuleFile").mockResolvedValueOnce({
      kind: "parse-failure",
      reason: "unreadable: EACCES",
    });
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    spy.mockRestore();
    expect(rules).toEqual([]);
    expect(diagnostics).toEqual([
      {
        kind: "unreadable",
        absPath: path.join(dir, "x.md"),
        source: "pi",
        code: "EACCES",
      },
    ]);
    await rm(tmp, { recursive: true });
  });

  it("returns unreadable from realpath rejection (broken symlink)", async () => {
    if (process.platform === "win32") return;
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    const fs = await import("node:fs/promises");
    await fs.symlink(path.join(tmp, "missing-target"), path.join(dir, "ghost.md"));
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    expect(rules).toEqual([]);
    expect(diagnostics).toEqual([
      {
        kind: "unreadable",
        absPath: path.join(dir, "ghost.md"),
        source: "pi",
        code: "ENOENT",
      },
    ]);
    await rm(tmp, { recursive: true });
  });

  it("preserves full rule shape ∧ ordering; diagnostics emitted alongside rules", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "a.md"),
      '---\ndescription: alpha\npaths: ["src/**"]\n---\nA-body\n',
    );
    await writeFile(path.join(dir, "no-fm.md"), "no frontmatter\n");
    await writeFile(path.join(dir, "bad.md"), "---\ndescription: bad\npaths: 99\n---\n");
    await writeFile(path.join(dir, "b.md"), "---\ndescription: beta\n---\nB-body\n");
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    const fs = await import("node:fs/promises");
    expect(rules).toHaveLength(2);
    const ruleA = rules.find((r) => r.sourcePath === path.join(dir, "a.md"));
    const ruleB = rules.find((r) => r.sourcePath === path.join(dir, "b.md"));
    expect(ruleA).toMatchObject({
      source: "pi",
      description: "alpha",
      paths: ["src/**"],
      body: "A-body\n",
    });
    expect(ruleA?.id).toBe(await fs.realpath(path.join(dir, "a.md")));
    expect(ruleB).toMatchObject({
      source: "pi",
      description: "beta",
      paths: [],
      body: "B-body\n",
    });
    expect(ruleB?.id).toBe(await fs.realpath(path.join(dir, "b.md")));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.kind).sort()).toEqual([
      "parse_error",
      "skipped_no_frontmatter",
    ]);
    await rm(tmp, { recursive: true });
  });

  it("returns symlink_escape when symlink resolves outside any rule root", async () => {
    // Security-adjacent: a hostile rule otherwise has a path into ~/.
    if (process.platform === "win32") return;
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    const fs = await import("node:fs/promises");
    const outsideTarget = path.join(tmp, "outside.md");
    await writeFile(outsideTarget, '---\ndescription: x\npaths: ["**/*"]\n---\n');
    await fs.symlink(outsideTarget, path.join(dir, "escape.md"));
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    expect(rules).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      kind: "symlink_escape",
      absPath: path.join(dir, "escape.md"),
      source: "pi",
    });
    expect((diagnostics[0] as { kind: "symlink_escape"; targetPath: string }).targetPath).toBe(
      await fs.realpath(outsideTarget),
    );
    await rm(tmp, { recursive: true });
  });

  it("cross-root symlink (claude → pi) still loads as one rule (no symlink_escape)", async () => {
    if (process.platform === "win32") return;
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    await mkdir(path.join(tmp, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(tmp, ".claude", "rules"), { recursive: true });
    const fs = await import("node:fs/promises");
    const target = path.join(tmp, ".pi", "rules", "x.md");
    await writeFile(target, '---\ndescription: d\npaths: ["**"]\n---\nbody\n');
    await fs.symlink(target, path.join(tmp, ".claude", "rules", "x.md"));
    const { rules, diagnostics } = await discover(tmp, { home: "" });
    expect(rules).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    await rm(tmp, { recursive: true });
  });

  it("does NOT write to stderr (diagnostics are returned, not logged)", async () => {
    // discover() must not log — the handler decides what to surface.
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-diag-"));
    const dir = path.join(tmp, ".pi/rules");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "no-desc.md"), '---\npaths: ["**/*"]\n---\n');
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: stderr spy
    (process.stderr.write as any) = (chunk: string) => {
      lines.push(chunk);
      return true;
    };
    try {
      await discover(tmp, { home: "" });
    } finally {
      process.stderr.write = orig;
    }
    expect(lines.filter((l) => l.startsWith("[pi-rules-steer]"))).toEqual([]);
    await rm(tmp, { recursive: true });
  });
});

// ============================================================================
// user-root discovery
// ============================================================================

describe("user-root discovery", () => {
  let cwd: string;
  let home: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pi-rules-steer-cwd-"));
    home = await mkdtemp(path.join(tmpdir(), "pi-rules-steer-home-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("discovers rules from ~/.pi/rules and ~/.claude/rules", async () => {
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(home, ".claude", "rules"), { recursive: true });
    await writeFile(path.join(home, ".pi", "rules", "u1.md"), VALID_FM);
    await writeFile(path.join(home, ".claude", "rules", "u2.md"), VALID_FM);

    const { rules } = await discover(cwd, { home });
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.sourcePath).sort()).toEqual([
      path.join(home, ".claude", "rules", "u2.md"),
      path.join(home, ".pi", "rules", "u1.md"),
    ]);
  });

  it("user and project rules merge into one list, user first", async () => {
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(home, ".pi", "rules", "u.md"), VALID_FM);
    await writeFile(path.join(cwd, ".pi", "rules", "p.md"), VALID_FM);

    const { rules } = await discover(cwd, { home });
    expect(rules).toHaveLength(2);
    expect(rules[0]?.sourcePath).toBe(path.join(home, ".pi", "rules", "u.md"));
    expect(rules[1]?.sourcePath).toBe(path.join(cwd, ".pi", "rules", "p.md"));
  });

  it("missing user dirs do not error", async () => {
    const ghostHome = path.join(home, "does-not-exist");
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "rules", "p.md"), VALID_FM);

    const { rules } = await discover(cwd, { home: ghostHome });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.sourcePath).toBe(path.join(cwd, ".pi", "rules", "p.md"));
  });

  it("always-on rule (no paths) on user side", async () => {
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(home, ".pi", "rules", "always.md"), ALWAYS_FM);

    const { rules } = await discover(cwd, { home });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.paths).toEqual([]);
  });

  it("home empty string skips user roots entirely", async () => {
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(home, ".pi", "rules", "u.md"), VALID_FM);
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "rules", "p.md"), VALID_FM);

    const { rules } = await discover(cwd, { home: "" });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.sourcePath).toBe(path.join(cwd, ".pi", "rules", "p.md"));
  });

  it("symlink project → user yields one entry with user sourcePath", async () => {
    if (process.platform === "win32") return;
    const fs = await import("node:fs/promises");
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    const target = path.join(home, ".pi", "rules", "shared.md");
    await writeFile(target, VALID_FM);
    await fs.symlink(target, path.join(cwd, ".pi", "rules", "shared.md"));

    const { rules } = await discover(cwd, { home });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.sourcePath).toBe(target);
    expect(rules[0]?.source).toBe("pi");
  });

  it("non-symlinked twins (different files, same body) produce two entries", async () => {
    await mkdir(path.join(home, ".pi", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "rules"), { recursive: true });
    await writeFile(path.join(home, ".pi", "rules", "x.md"), VALID_FM);
    await writeFile(path.join(cwd, ".pi", "rules", "x.md"), VALID_FM);

    const { rules } = await discover(cwd, { home });
    expect(rules).toHaveLength(2);
    const ids = new Set(rules.map((r) => r.id));
    expect(ids.size).toBe(2);
  });
});
