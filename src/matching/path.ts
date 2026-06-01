// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/matching/path.{js,d.ts}.
// See NOTICE for attribution.

import nodePath, { type PlatformPath } from "node:path";

export function toRelativePosix(absPath: string, cwd: string): string | null {
  return toRelativePosixWith(nodePath, absPath, cwd);
}

export function toRelativePosixWith(p: PlatformPath, absPath: string, cwd: string): string | null {
  const rel = p.relative(cwd, absPath);
  if (rel === "") return null;
  if (rel === ".." || rel.startsWith(`..${p.sep}`)) return null;
  return p.sep === "/" ? rel : rel.split(p.sep).join("/");
}
