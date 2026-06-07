// pi-rules-steer — Pi extension that injects path-conditional rule content
// into tool results.
//
// v0.1.1: source-fork of @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4).
// See NOTICE for attribution. Search-scope semantics are layered in v0.1.2+.
//
// Ported from upstream dist/index.{js,d.ts}.

import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ExtensionAPI,
  type ToolResultEvent,
  isEditToolResult,
  isReadToolResult,
  isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import { runDoctor } from "./commands/doctor.js";
import { discover, ruleRootCandidates, type Diagnostic } from "./discovery/index.js";
import { reconcileInjectedIds } from "./discovery/reconcile.js";
import type { Rule } from "./discovery/types.js";
import { startWatcher, type Watcher, type WatcherOptions } from "./discovery/watcher.js";
import { extractBashScope } from "./extraction/bash.js";
import { extractScope } from "./extraction/scope.js";
import { toRelativePosixForLog } from "./internal/log-path.js";
import { compileMatcher, type Matcher } from "./matching/index.js";
import { recordInjection } from "./runtime/injection-log.js";

export type ExtensionDeps = {
  watchFactory?: WatcherOptions["watchFactory"];
  debounceMs?: number;
};

const SUBCOMMANDS = ["doctor"] as const;

export function makeExtension(deps: ExtensionDeps = {}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    let matcher: Matcher | null = null;
    let lastRules: Rule[] = [];
    const injectedIds = new Set<string>();
    let watcher: Watcher | null = null;
    let reloadInFlight = false;
    let pendingReload = false;
    let currentReload: Promise<void> = Promise.resolve();
    let activeCwd: string | null = null;

    const computeRoots = async (cwd: string): Promise<string[]> => {
      const home = os.homedir();
      const candidates = ruleRootCandidates(cwd, home).map((c) => c.root);
      const existing: string[] = [];
      for (const d of candidates) {
        try {
          await stat(d);
          existing.push(d);
        } catch {
          // dir absent at session_start → not watched
        }
      }
      return existing;
    };

    const scheduleReload = (): void => {
      if (activeCwd === null) return;
      if (reloadInFlight) {
        pendingReload = true;
        return;
      }
      reloadInFlight = true;
      const cwd = activeCwd;
      currentReload = (async () => {
        try {
          const { rules: next, diagnostics } = await discover(cwd);
          for (const d of diagnostics) emitDiagnostic(cwd, d);
          const nextMatcher = compileMatcher(next);
          reconcileInjectedIds(lastRules, next, injectedIds);
          matcher = nextMatcher;
          lastRules = next;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[pi-rules-steer] reload failed: ${msg}\n`);
        } finally {
          reloadInFlight = false;
          if (pendingReload) {
            pendingReload = false;
            queueMicrotask(scheduleReload);
          }
        }
      })();
    };

    pi.on("session_start", async (_e, ctx) => {
      injectedIds.clear();
      activeCwd = ctx.cwd;
      try {
        const { rules, diagnostics } = await discover(ctx.cwd);
        for (const d of diagnostics) emitDiagnostic(ctx.cwd, d);
        matcher = compileMatcher(rules);
        lastRules = rules;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pi-rules-steer] discovery failed: ${msg}\n`);
        matcher = compileMatcher([]);
        lastRules = [];
      }
      const roots = await computeRoots(ctx.cwd);
      watcher = startWatcher({
        roots,
        onChange: scheduleReload,
        debounceMs: deps.debounceMs,
        watchFactory: deps.watchFactory,
      });
    });

    pi.on("tool_result", (e: ToolResultEvent, ctx) => {
      if (matcher === null || e.isError) return;

      // Branch 1: operative tools (read/edit/write) — inject against the
      // single target path. Behavior unchanged from upstream forge-flow.
      if (isReadToolResult(e) || isEditToolResult(e) || isWriteToolResult(e)) {
        const raw = (e.input as { path?: unknown }).path;
        if (typeof raw !== "string" || raw.length === 0) return;
        const abs = path.resolve(ctx.cwd, raw);
        const matches = matcher.match(abs, ctx.cwd);
        if (matches.length === 0) return;
        const fresh = matches.filter((r) => !injectedIds.has(r.id));
        if (fresh.length === 0) return;
        const relPath = toRelativePosixForLog(abs, ctx.cwd);
        for (const r of fresh) {
          injectedIds.add(r.id);
          recordInjection({ path: relPath, ruleId: r.id, at: Date.now() });
        }
        return {
          content: [...fresh.map((r) => ({ type: "text" as const, text: r.body })), ...e.content],
        };
      }

      // Branch 2: search tools (grep/find/ls/code_search) — inject ONCE per
      // scope when the search scope/glob could overlap a rule's globs.
      // Single-inject invariant: one fire per rule across the whole session,
      // dedup'd via the shared injectedIds Set (also used by Branch 1).
      const extracted = extractScope(e.toolName, e.input, ctx.cwd);
      if (extracted !== null) {
        if (extracted.scope === null && extracted.glob === null) return;
        const matches = matcher.matchScope({ scope: extracted.scope, glob: extracted.glob });
        if (matches.length === 0) return;
        const fresh = matches.filter((r) => !injectedIds.has(r.id));
        if (fresh.length === 0) return;
        for (const r of fresh) {
          injectedIds.add(r.id);
          recordInjection({
            ruleId: r.id,
            scope: extracted.scope,
            glob: extracted.glob,
            viaScope: true,
            at: Date.now(),
          });
        }
        return {
          content: [...fresh.map((r) => ({ type: "text" as const, text: r.body })), ...e.content],
        };
      }

      // Branch 3 (v0.2): bash tool — parse `input.command`, extract scope
      // from a supported verb (grep non-recursive / rg / ls non-recursive /
      // cat / head / tail / fd), and inject like Branch 2. Same single-inject
      // invariant via shared `injectedIds`. `find` is deliberately excluded
      // — pi-bash-steer blocks it as a universal footgun.
      if (e.toolName === "bash") {
        const rawCommand = (e.input as { command?: unknown }).command;
        if (typeof rawCommand !== "string" || rawCommand.length === 0) return;
        const bashScope = extractBashScope(rawCommand, ctx.cwd);
        if (bashScope === null) return;
        if (bashScope.scope === null && bashScope.glob === null) return;
        const matches = matcher.matchScope({ scope: bashScope.scope, glob: bashScope.glob });
        if (matches.length === 0) return;
        const fresh = matches.filter((r) => !injectedIds.has(r.id));
        if (fresh.length === 0) return;
        for (const r of fresh) {
          injectedIds.add(r.id);
          recordInjection({
            ruleId: r.id,
            scope: bashScope.scope,
            glob: bashScope.glob,
            viaScope: true,
            at: Date.now(),
          });
        }
        return {
          content: [...fresh.map((r) => ({ type: "text" as const, text: r.body })), ...e.content],
        };
      }
    });

    pi.on("session_shutdown", async (_e, _ctx) => {
      if (watcher !== null) {
        await watcher.stop();
        watcher = null;
      }
      await currentReload;
      matcher = null;
      injectedIds.clear();
      lastRules = [];
      activeCwd = null;
    });

    pi.registerCommand("pi-rules-steer", {
      description: "pi-rules-steer — rule discovery diagnostics. Subcommands: doctor",
      getArgumentCompletions: (prefix) => {
        const sub = prefix.trim().split(/\s+/)[0] ?? "";
        return SUBCOMMANDS.filter((c) => c.startsWith(sub)).map((c) => ({
          value: c,
          label: c,
        }));
      },
      handler: async (input, uiCtx) => {
        const parts = input.trim().split(/\s+/).filter(Boolean);
        const sub = parts[0] ?? "";
        if (sub === "doctor") {
          await runDoctor(pi, uiCtx, activeCwd ?? process.cwd());
          return;
        }
        pi.sendUserMessage(
          sub
            ? `Unknown /pi-rules-steer subcommand: ${sub}. Try: doctor`
            : "/pi-rules-steer — try: doctor",
        );
      },
    });
  };
}

const piRulesSteerExtension = makeExtension();
export default piRulesSteerExtension;

function emitDiagnostic(cwd: string, d: Diagnostic): void {
  if (d.kind === "skipped_no_frontmatter") return;
  const reason =
    d.kind === "unreadable"
      ? `unreadable: ${d.code}`
      : d.kind === "symlink_escape"
        ? `symlink escape: ${d.targetPath}`
        : d.reason;
  process.stderr.write(`[pi-rules-steer] skipped ${path.relative(cwd, d.absPath)}: ${reason}\n`);
}
