// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/matching/compile.{js,d.ts}.
// See NOTICE for attribution.

import picomatch from "picomatch";
import type { Rule } from "../discovery/index.js";

const OPTS: picomatch.PicomatchOptions = { dot: true, nonegate: true };

export function compileRule(rule: Rule): (rel: string) => boolean {
  if (rule.paths.length === 0) return () => true;
  const survivors: string[] = [];
  for (const p of rule.paths) {
    try {
      picomatch.makeRe(p, { ...OPTS, debug: true });
      survivors.push(p);
    } catch {
      process.stderr.write(
        `[pi-rules-steer] invalid glob in ${JSON.stringify(rule.sourcePath)}: ${JSON.stringify(p)} -- never matches\n`,
      );
    }
  }
  if (survivors.length === 0) return () => false;
  return picomatch(survivors, OPTS);
}
