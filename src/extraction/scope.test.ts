import { describe, expect, it } from "vitest";
import { extractScope } from "./scope.js";

const CWD = "/proj";

describe("extractScope — recognition", () => {
  it("returns null for unrecognized tools", () => {
    for (const name of ["read", "edit", "write", "bash", "web_search", "", "Grep"]) {
      expect(extractScope(name, { path: "src" }, CWD)).toBeNull();
    }
  });
});

describe("extractScope — grep", () => {
  it("extracts path and glob", () => {
    expect(extractScope("grep", { path: "src/foo", glob: "*.ts" }, CWD)).toEqual({
      tool: "grep",
      scope: "src/foo",
      glob: "*.ts",
    });
  });

  it("returns null fields when neither path nor glob supplied", () => {
    expect(extractScope("grep", {}, CWD)).toEqual({ tool: "grep", scope: null, glob: null });
  });

  it("path-only and glob-only are independent (orthogonal)", () => {
    expect(extractScope("grep", { path: "src" }, CWD)).toEqual({
      tool: "grep",
      scope: "src",
      glob: null,
    });
    expect(extractScope("grep", { glob: "*.md" }, CWD)).toEqual({
      tool: "grep",
      scope: null,
      glob: "*.md",
    });
  });
});

describe("extractScope — find", () => {
  it("extracts path", () => {
    expect(extractScope("find", { path: "src/lib" }, CWD)).toEqual({
      tool: "find",
      scope: "src/lib",
      glob: null,
    });
  });

  it("ignores `pattern` (filename pattern, not a glob/path)", () => {
    expect(extractScope("find", { pattern: "*.ts" }, CWD)).toEqual({
      tool: "find",
      scope: null,
      glob: null,
    });
  });
});

describe("extractScope — ls", () => {
  it("extracts path", () => {
    expect(extractScope("ls", { path: "docs" }, CWD)).toEqual({
      tool: "ls",
      scope: "docs",
      glob: null,
    });
  });

  it("returns null scope when no path supplied (CWD-scoped ls)", () => {
    expect(extractScope("ls", {}, CWD)).toEqual({ tool: "ls", scope: null, glob: null });
  });
});

describe("extractScope — code_search", () => {
  it("extracts fileGlob into glob; scope is always null (workspace-wide)", () => {
    expect(extractScope("code_search", { fileGlob: "src/**/*.ts" }, CWD)).toEqual({
      tool: "code_search",
      scope: null,
      glob: "src/**/*.ts",
    });
  });

  it("ignores `path` (code_search has no scope arg)", () => {
    expect(extractScope("code_search", { path: "src", fileGlob: "*.ts" }, CWD)).toEqual({
      tool: "code_search",
      scope: null,
      glob: "*.ts",
    });
  });

  it("returns null fields with empty input", () => {
    expect(extractScope("code_search", {}, CWD)).toEqual({
      tool: "code_search",
      scope: null,
      glob: null,
    });
  });
});

describe("extractScope — path normalization", () => {
  it("normalizes relative input as-is", () => {
    expect(extractScope("grep", { path: "src/foo" }, CWD)?.scope).toBe("src/foo");
  });

  it("normalizes absolute inside cwd to project-relative", () => {
    expect(extractScope("grep", { path: "/proj/src/foo" }, CWD)?.scope).toBe("src/foo");
  });

  it("returns null scope for absolute path outside cwd", () => {
    expect(extractScope("grep", { path: "/etc/passwd" }, CWD)?.scope).toBeNull();
  });

  it("returns null scope when path resolves to cwd itself", () => {
    expect(extractScope("grep", { path: "." }, CWD)?.scope).toBeNull();
    expect(extractScope("grep", { path: "/proj" }, CWD)?.scope).toBeNull();
  });

  it("collapses dotted/trailing-slash segments", () => {
    expect(extractScope("grep", { path: "./src/" }, CWD)?.scope).toBe("src");
    expect(extractScope("grep", { path: "src/./foo" }, CWD)?.scope).toBe("src/foo");
  });
});

describe("extractScope — defensive type handling", () => {
  it("treats non-string path as not supplied", () => {
    expect(extractScope("grep", { path: 42 }, CWD)?.scope).toBeNull();
    expect(extractScope("grep", { path: null }, CWD)?.scope).toBeNull();
    expect(extractScope("grep", { path: ["src"] }, CWD)?.scope).toBeNull();
  });

  it("treats empty-string path as not supplied", () => {
    expect(extractScope("grep", { path: "" }, CWD)?.scope).toBeNull();
  });

  it("treats non-string glob as not supplied", () => {
    expect(extractScope("grep", { glob: 42 }, CWD)?.glob).toBeNull();
    expect(extractScope("grep", { glob: "" }, CWD)?.glob).toBeNull();
    expect(extractScope("code_search", { fileGlob: null }, CWD)?.glob).toBeNull();
  });
});
