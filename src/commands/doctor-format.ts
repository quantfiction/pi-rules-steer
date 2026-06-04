// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/commands/doctor-format.{js,d.ts}.
// See NOTICE for attribution.

import type { Diagnostic, DiscoverResult, Rule } from "../discovery/index.js";
import type { Injection } from "../runtime/injection-log.js";

/** Maximum number of injection entries surfaced by `format()`. */
export const MAX_INJECTIONS_RENDERED = 5;

export interface FormatOptions {
  /** Per-session injection telemetry buffer (see `runtime/injection-log`). */
  injections?: readonly Injection[];
}

export function hasErrors(result: DiscoverResult): boolean {
  return result.diagnostics.some(
    (d) => d.kind === "parse_error" || d.kind === "unreadable" || d.kind === "symlink_escape",
  );
}

export function format(result: DiscoverResult, opts: FormatOptions = {}): string {
  const errors = result.diagnostics.filter(
    (d) => d.kind === "parse_error" || d.kind === "unreadable" || d.kind === "symlink_escape",
  );
  const skipped = result.diagnostics.filter((d) => d.kind === "skipped_no_frontmatter");
  const status = errors.length === 0 ? "OK" : "ERRORS";
  const header = `pi-rules-steer doctor: ${status} — ${result.rules.length} rules, ${errors.length} errors, ${skipped.length} skipped`;
  const sections: string[] = [];
  if (result.rules.length > 0) sections.push(formatRules(result.rules));
  if (errors.length > 0) sections.push(formatErrors(errors));
  if (skipped.length > 0) sections.push(formatSkipped(skipped));
  sections.push(formatCoverage(result));
  sections.push(formatLastInjections(opts.injections ?? []));
  return [header, ...sections].join("\n\n");
}

function formatRules(rules: Rule[]): string {
  const lines: string[] = ["Rules:"];
  for (const r of rules) {
    lines.push(`  [${r.source}] ${r.sourcePath}`);
    lines.push(`             paths: ${r.paths.length === 0 ? "(none — always-on)" : r.paths.join(",")}`);
    if (r.id !== r.sourcePath) {
      lines.push(`             → ${r.id}`);
    }
  }
  return lines.join("\n");
}

function formatErrors(errors: Diagnostic[]): string {
  const lines: string[] = ["Errors:"];
  for (const e of errors) {
    lines.push(`  ${e.absPath}`);
    lines.push(`    ${errorReason(e)}`);
  }
  return lines.join("\n");
}

function errorReason(e: Diagnostic): string {
  if (e.kind === "unreadable") return `unreadable: ${e.code}`;
  if (e.kind === "symlink_escape") return `symlink escape: ${e.targetPath}`;
  if (e.kind === "parse_error") return e.reason;
  return "skipped (no frontmatter)";
}

function formatSkipped(skipped: Diagnostic[]): string {
  const lines: string[] = ["Skipped (no frontmatter):"];
  for (const s of skipped) lines.push(`  ${s.absPath}`);
  return lines.join("\n");
}

function formatLastInjections(injections: readonly Injection[]): string {
  const lines: string[] = ["Last injections (most recent first):"];
  if (injections.length === 0) {
    lines.push("  (none yet this session)");
    return lines.join("\n");
  }
  // Tail of the buffer, reversed: most-recent first, capped.
  const tail = injections.slice(-MAX_INJECTIONS_RENDERED).reverse();
  for (const inj of tail) {
    const ts = new Date(inj.at).toISOString();
    if ("viaScope" in inj) {
      const scope = inj.scope ?? "(none)";
      const glob = inj.glob ?? "(none)";
      lines.push(`  [scope] ${inj.ruleId}  scope=${scope} glob=${glob}  ${ts}`);
    } else {
      lines.push(`  [op]    ${inj.ruleId}  path=${inj.path}  ${ts}`);
    }
  }
  return lines.join("\n");
}

function formatCoverage(result: DiscoverResult): string {
  const total = result.rules.length;
  const always = result.rules.filter((r) => r.paths.length === 0).length;
  const piCount = result.rules.filter((r) => r.source === "pi").length;
  const claudeCount = result.rules.filter((r) => r.source === "claude").length;
  return [
    "Coverage:",
    `  total rules:    ${total}`,
    `  always-on:      ${always}`,
    `  path-scoped:    ${total - always}`,
    `  sources:        pi=${piCount}, claude=${claudeCount}`,
  ].join("\n");
}
