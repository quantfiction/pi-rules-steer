// Ported from forge-flow upstream tests/unit/matching/path.spec.ts.
// Tests toRelativePosix's contract: project-relative POSIX path, or null when
// the input escapes/equals cwd. Catches injection-log path-leak bugs and the
// Windows-backslash → forward-slash normalization invariant.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { toRelativePosix, toRelativePosixWith } from "./path.js";

describe("toRelativePosix", () => {
  it("returns POSIX-style relative path for cwd-rooted absolute path", () => {
    expect(toRelativePosix("/a/b/c.ts", "/a")).toBe("b/c.ts");
    expect(toRelativePosix("/a/src/x.ts", "/a")).toBe("src/x.ts");
  });

  it("returns null when absPath equals cwd", () => {
    expect(toRelativePosix("/a", "/a")).toBeNull();
  });

  it("returns null when absPath escapes cwd via ..", () => {
    expect(toRelativePosix("/x/y/z.ts", "/a/b")).toBeNull();
    expect(toRelativePosix("/a", "/a/b")).toBeNull();
  });

  it("normalizes Windows backslashes to forward slashes (path.win32 fixture)", () => {
    expect(toRelativePosixWith(path.win32, "C:\\a\\b\\c.ts", "C:\\a")).toBe("b/c.ts");
    expect(toRelativePosixWith(path.win32, "C:\\a", "C:\\a")).toBeNull();
    expect(toRelativePosixWith(path.win32, "C:\\x\\y.ts", "C:\\a")).toBeNull();
  });
});
