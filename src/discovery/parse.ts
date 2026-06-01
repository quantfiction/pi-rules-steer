// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/discovery/parse.{js,d.ts}.
// See NOTICE for attribution.

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { ParseFailure, Rule, Source } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type NormalizeResult = string[] | ParseFailure;

function normalizePathSpec(raw: unknown, fieldName: string): NormalizeResult {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") {
    if (raw.length === 0) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(raw)) {
    if (!raw.every((g) => typeof g === "string")) {
      return { kind: "parse-failure", reason: `${fieldName} must be string or string[]` };
    }
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return { kind: "parse-failure", reason: `${fieldName} must be string or string[]` };
}

export async function parseRuleFile(absPath: string, source: Source): Promise<Rule | ParseFailure> {
  let content: string;
  try {
    content = await readFile(absPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EUNKNOWN";
    return { kind: "parse-failure", reason: `unreadable: ${code}` };
  }
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { kind: "parse-failure", reason: "missing frontmatter" };

  let fm: unknown;
  try {
    fm = parseYaml(match[1]);
  } catch (err) {
    return { kind: "parse-failure", reason: `invalid yaml: ${(err as Error).message}` };
  }
  if (typeof fm !== "object" || fm === null) {
    return { kind: "parse-failure", reason: "invalid yaml: not an object" };
  }
  const rec = fm as Record<string, unknown>;
  if (typeof rec.description !== "string" || rec.description.length === 0) {
    return { kind: "parse-failure", reason: "missing description" };
  }

  // Warn about deprecated alwaysApply field
  if (rec.alwaysApply !== undefined) {
    process.stderr.write(
      `[pi-rules-steer] ${JSON.stringify(absPath)}: alwaysApply is deprecated; use paths absence for always-on rules\n`,
    );
  }

  let paths: string[];
  let usedFallback = false;
  if (rec.paths !== undefined) {
    const result = normalizePathSpec(rec.paths, "paths");
    if (!Array.isArray(result)) return result;
    paths = result;
  } else if (rec.globs !== undefined) {
    const result = normalizePathSpec(rec.globs, "globs");
    if (!Array.isArray(result)) return result;
    paths = result;
    usedFallback = true;
  } else {
    paths = [];
  }

  if (usedFallback) {
    process.stderr.write(
      `[pi-rules-steer] ${JSON.stringify(absPath)}: globs is deprecated; use paths instead\n`,
    );
  }

  const body = content.slice(match[0].length).replace(/^\n/, "");
  return {
    id: absPath,
    sourcePath: absPath,
    source,
    description: rec.description,
    paths,
    body,
  };
}
