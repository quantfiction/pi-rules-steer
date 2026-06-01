// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/internal/log-path.{js,d.ts}.
// See NOTICE for attribution.

import nodePath, { type PlatformPath } from "node:path";

export function toRelativePosixForLog(absPath: string, cwd: string): string {
  return toRelativePosixForLogWith(nodePath, absPath, cwd);
}

export function toRelativePosixForLogWith(p: PlatformPath, absPath: string, cwd: string): string {
  const rel = p.relative(cwd, absPath);
  return p.sep === "/" ? rel : rel.split(p.sep).join("/");
}
