// Extracts the search-scope (and orthogonal glob) argument from search-class
// tool inputs. Net-new on top of the @the-forge-flow/pi-rules fork; consumed
// by the tool_result handler's scope-rule branch (v0.1.3).
//
// Tool input shapes (from production telemetry, workspace 41761534):
//   grep        → input.path, input.glob
//   find        → input.path, input.pattern (filename pattern — NOT a glob; ignored)
//   ls          → input.path
//   code_search → input.fileGlob (no scope arg; workspace-wide by default)

import nodePath from "node:path";
import { toRelativePosix } from "../matching/path.js";

export type SearchScopeTool = "grep" | "find" | "ls" | "code_search";

export interface ExtractedScope {
  /** Tool that produced this scope */
  tool: SearchScopeTool;
  /** Project-relative POSIX path of the scope, or null if no scope arg was supplied */
  scope: string | null;
  /** Glob argument if supplied (grep `glob`, code_search `fileGlob`) — orthogonal to scope */
  glob: string | null;
}

const SEARCH_TOOLS = new Set<string>(["grep", "find", "ls", "code_search"]);

export function extractScope(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): ExtractedScope | null {
  if (!SEARCH_TOOLS.has(toolName)) return null;
  const tool = toolName as SearchScopeTool;
  return {
    tool,
    scope: extractScopeArg(tool, input, cwd),
    glob: extractGlobArg(tool, input),
  };
}

function extractScopeArg(
  tool: SearchScopeTool,
  input: Record<string, unknown>,
  cwd: string,
): string | null {
  if (tool === "code_search") return null;
  const raw = input.path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const abs = nodePath.resolve(cwd, raw);
  return toRelativePosix(abs, cwd);
}

function extractGlobArg(tool: SearchScopeTool, input: Record<string, unknown>): string | null {
  const key = tool === "grep" ? "glob" : tool === "code_search" ? "fileGlob" : null;
  if (key === null) return null;
  const raw = input[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
