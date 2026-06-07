// Extracts scope from a bash tool_call's `command` string for the v0.2
// bash-injection branch. Net-new on top of the v0.1.x search-scope branch;
// see docs/plans/v020-bash-interception/ROUGH.md for the design.
//
// Scope fence (deliberate; do NOT relax without naming the invariant):
//   - First verb of the first pipeline element only.
//     `grep foo file | head` extracts from `grep` only.
//   - No subshells, no `bash -c "..."`, no `$(...)`, no `<(...)`.
//   - `cd <path> &&` prefix is honored to set the effective cwd.
//   - Env-var prefixes (`FOO=bar cmd`) and a small wrapper set
//     (`timeout`, `nice`, `nohup`, `stdbuf`, `time`) are stripped.
//   - Verb set is FIXED: grep (non-recursive), rg, ls (non-recursive),
//     cat (no redirect/heredoc), head, tail, fd.
//   - `find` is deliberately excluded (pi-bash-steer's `__builtins__find`
//     blocks bash find as a universal footgun).
//   - Recursive `grep -r/-R/--recursive` and `ls -R` return null
//     (pi-bash-steer redirects these to pi-native tools where v0.1
//     Branch 2 already injects).

import nodePath from "node:path";
import { parse as shellParse } from "shell-quote";
import { toRelativePosix } from "../matching/path.js";

const BASH_VERBS = new Set([
  "grep",
  "rg",
  "ls",
  "cat",
  "head",
  "tail",
  "fd",
] as const);
type BashVerb = (typeof BASH_VERBS) extends Set<infer T> ? T : never;

const WRAPPER_VERBS = new Set(["timeout", "nice", "nohup", "stdbuf", "time"]);

// Flag-with-separate-value pairs per verb. When we see one of these flags,
// we skip the NEXT token as its value.
const FLAGS_WITH_VALUE: Record<BashVerb, ReadonlySet<string>> = {
  grep: new Set(["-A", "-B", "-C", "-e", "-f", "-m", "--include", "--exclude"]),
  rg: new Set(["-A", "-B", "-C", "-e", "-g", "-t", "--glob", "--type"]),
  ls: new Set([]),
  cat: new Set([]),
  head: new Set(["-n", "-c"]),
  tail: new Set(["-n", "-c"]),
  fd: new Set(["-t", "-e", "-d", "-E", "--type", "--extension", "--exclude"]),
};

// Boolean flags that some verbs use to mean "recursive" — when present
// on these verbs, we bail (pi-bash-steer's territory).
const RECURSIVE_FLAGS: Partial<Record<BashVerb, ReadonlySet<string>>> = {
  grep: new Set(["-r", "-R", "--recursive"]),
  ls: new Set(["-R", "--recursive"]),
};

// shell-quote token shapes we treat as boundaries / sentinels.
// A "control" token is an object like { op: "&&" } / { op: "|" } / { op: ">" }.
type ControlToken = { op: string };
type CommentToken = { comment: string };
type GlobToken = { pattern: string };
type ShellToken = string | ControlToken | CommentToken | GlobToken;

function isControl(t: ShellToken): t is ControlToken {
  return typeof t === "object" && t !== null && "op" in t;
}
function isString(t: ShellToken): t is string {
  return typeof t === "string";
}

const PIPELINE_OPS = new Set(["|", "||", "&&", ";", "&", "|&"]);
const REDIRECT_OPS = new Set(["<", "<<", "<<-", ">", ">>", ">|", "<>", "&>"]);

/**
 * Tokenize and find the first verb + its args, stopping at any pipeline op.
 * Returns null if no recognized verb is found at the head position.
 *
 * Behavior:
 *   - Skips one leading `cd <path> && ` if present (the `cd` target becomes
 *     the effective cwd for arg resolution; caller passes that in).
 *   - Strips env-var prefix tokens (`FOO=bar`) at the head.
 *   - Strips one wrapper verb at the head (`timeout 30`, `nice -n 10`, etc.)
 *     along with its trailing flag/duration tokens.
 *   - Reports whether any redirect op (`>`, `>>`, `<`, `<<`, `&>`, etc.)
 *     appears in the first pipeline element — used to skip `cat > file`
 *     and friends.
 *   - Reports stderr-only redirects (`2>...`) but those are emitted as a
 *     string token `2>` plus a target by shell-quote; we treat numeric-fd
 *     redirects as benign and ignore them.
 */
interface FirstVerbParse {
  verb: BashVerb;
  args: string[];
  hasNonNumericRedirect: boolean;
}

function parseFirstVerb(command: string): FirstVerbParse | null {
  let raw = command;

  // `cd X && rest...` — strip the prefix; the actual cwd shift is the caller's
  // concern (passed in). We just want to get to the real verb.
  const cdMatch = raw.match(/^\s*cd\s+\S+\s*&&\s*(.+)$/s);
  if (cdMatch) raw = cdMatch[1];

  let tokens: ShellToken[];
  try {
    tokens = shellParse(raw) as ShellToken[];
  } catch {
    return null;
  }
  if (tokens.length === 0) return null;

  // Truncate at first pipeline boundary.
  let endIdx = tokens.length;
  let hasNonNumericRedirect = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isControl(t)) {
      if (PIPELINE_OPS.has(t.op)) {
        endIdx = i;
        break;
      }
      if (REDIRECT_OPS.has(t.op)) {
        // Non-numeric redirect (stdin/stdout). For `cat > file` we'll later
        // use this to bail.
        hasNonNumericRedirect = true;
      }
    } else if (isString(t)) {
      // `2>`, `2>>`, `2>&1` come through as plain strings, not control tokens.
      // We treat anything matching `\d+[<>]` as a numeric-fd redirect (benign).
      if (/^\d+[<>]/.test(t)) {
        // Skip the numeric-redirect target token too if it's not a control op.
        if (i + 1 < tokens.length && isString(tokens[i + 1])) i++;
        continue;
      }
    }
  }
  const head = tokens.slice(0, endIdx).filter((t) => !(isControl(t) && REDIRECT_OPS.has(t.op)));

  // Drop redirect target tokens that follow a redirect op. We track this by
  // re-walking and skipping (op, target) pairs.
  const cleaned: ShellToken[] = [];
  for (let i = 0; i < tokens.slice(0, endIdx).length; i++) {
    const t = tokens[i];
    if (isControl(t) && REDIRECT_OPS.has(t.op)) {
      // Skip the next token as the redirect target.
      i++;
      continue;
    }
    if (isString(t) && /^\d+[<>]/.test(t)) {
      i++; // skip target
      continue;
    }
    cleaned.push(t);
  }
  void head; // (head retained for parity; cleaned is authoritative)

  // Strip env-var prefix tokens at the head: tokens like `FOO=bar`.
  let pos = 0;
  while (pos < cleaned.length && isString(cleaned[pos]) && /^[A-Za-z_][A-Za-z0-9_]*=/.test(cleaned[pos] as string)) {
    pos++;
  }

  // Strip ONE wrapper verb (timeout / nice / nohup / stdbuf / time) and its
  // trailing flag/duration tokens.
  if (pos < cleaned.length && isString(cleaned[pos]) && WRAPPER_VERBS.has((cleaned[pos] as string).split("/").pop()!)) {
    pos++; // skip wrapper itself
    while (pos < cleaned.length) {
      const t = cleaned[pos];
      if (!isString(t)) break;
      // Skip flag tokens (`-n`, `-X`, `--foo=...`) and numeric/duration tokens
      // (`30`, `30s`, `10m`).
      if (/^-/.test(t) || /^\d+[a-z]?$/.test(t)) {
        pos++;
        continue;
      }
      break;
    }
  }

  if (pos >= cleaned.length) return null;
  const verbTok = cleaned[pos];
  if (!isString(verbTok)) return null;
  const verbBase = verbTok.split("/").pop()!;
  if (!BASH_VERBS.has(verbBase as BashVerb)) return null;
  const verb = verbBase as BashVerb;

  // Collect remaining args as string tokens (any non-string tokens left
  // are unexpected; ignore them).
  const args: string[] = [];
  for (let i = pos + 1; i < cleaned.length; i++) {
    const t = cleaned[i];
    if (isString(t)) args.push(t);
    // Glob/comment tokens shouldn't appear in our supported shapes; skip.
  }

  return { verb, args, hasNonNumericRedirect };
}

/**
 * Per-verb: walk args, skip flags + flag-values, return the Nth non-flag
 * positional that holds the scope-bearing path.
 *
 *   grep / rg : 2nd non-flag (1st = PATTERN, 2nd = PATH)
 *   fd        : 2nd non-flag (1st = PATTERN, 2nd = PATH)
 *   ls / cat / head / tail : 1st non-flag (= PATH/FILE)
 */
// Flags that, when present on grep/rg, consume the PATTERN positional
// (e.g. `grep -e PAT FILE` — FILE becomes the FIRST non-flag, not second).
const PATTERN_CONSUMING_FLAGS: Partial<Record<BashVerb, ReadonlySet<string>>> = {
  grep: new Set(["-e", "-f", "--regexp", "--file"]),
  rg: new Set(["-e", "-f", "--regexp", "--file"]),
};

function extractScopeArg(verb: BashVerb, args: string[]): string | null {
  // Default: grep/rg/fd target the 2nd non-flag (1=PATTERN, 2=PATH). For
  // ls/cat/head/tail, target the 1st non-flag.
  // If grep/rg sees a pattern-consuming flag (`-e PAT` / `-f FILE`), the
  // PATTERN positional is absorbed, so the path becomes the 1st non-flag.
  let targetIdx = verb === "grep" || verb === "rg" || verb === "fd" ? 2 : 1;
  const flagsWithValue = FLAGS_WITH_VALUE[verb];
  const patternConsuming = PATTERN_CONSUMING_FLAGS[verb];

  // Pre-scan for pattern-consuming flags (long-form `=` or short-form pair).
  if (patternConsuming !== undefined) {
    for (const a of args) {
      const flagBase = a.split("=")[0];
      if (patternConsuming.has(flagBase)) {
        targetIdx = 1;
        break;
      }
    }
  }

  let nonFlagSeen = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      // End-of-flags. Next tokens are positional regardless of leading `-`.
      for (let j = i + 1; j < args.length; j++) {
        nonFlagSeen++;
        if (nonFlagSeen === targetIdx) return args[j];
      }
      return null;
    }
    if (a.startsWith("-") && a !== "-") {
      // Flag. Skip its value if it's a flag-with-value AND value lives in next token.
      if (flagsWithValue.has(a)) {
        i++; // skip value
      } else if (patternConsuming !== undefined && patternConsuming.has(a)) {
        i++; // skip pattern value (already accounted for in targetIdx adjustment)
      }
      // Long-form `--flag=value` is self-contained.
      continue;
    }
    nonFlagSeen++;
    if (nonFlagSeen === targetIdx) return a;
  }
  return null;
}

/**
 * Public API: parse a bash command string and return the resolved
 * project-relative scope, or null.
 *
 * Returns null when:
 *   - The command's first verb is not in the supported set.
 *   - The verb is grep/ls in a recursive shape (pi-bash-steer territory).
 *   - The verb is cat with a redirect/heredoc (the agent is writing).
 *   - The first-verb has no scope-bearing positional.
 *   - The resolved path is the cwd itself or outside cwd.
 *   - The command is `bash -c` / `sh -c` / `eval` (opaque inner string).
 *   - shell-quote fails to parse.
 */
export function extractBashScope(
  command: string,
  cwd: string,
): { scope: string | null; glob: string | null } | null {
  if (typeof command !== "string" || command.trim().length === 0) return null;

  // `bash -c` / `sh -c` / `eval` — inner string is opaque to single-pass parse.
  if (/^\s*(bash|sh|eval)\s+-c\s+/.test(command) || /^\s*eval\s+/.test(command)) {
    return null;
  }

  // Effective cwd: if there's a leading `cd <path> &&`, the verb runs relative
  // to that path. Resolve it against the supplied cwd.
  let effectiveCwd = cwd;
  const cdMatch = command.match(/^\s*cd\s+(\S+)\s*&&\s*/);
  if (cdMatch) {
    const target = cdMatch[1];
    effectiveCwd = nodePath.resolve(cwd, target.replace(/^~/, process.env.HOME ?? cwd));
  }

  const parsed = parseFirstVerb(command);
  if (parsed === null) return null;

  // Recursive-shape guard: defer to pi-bash-steer's redirect to pi-native.
  const recursiveFlags = RECURSIVE_FLAGS[parsed.verb];
  if (recursiveFlags !== undefined) {
    for (const a of parsed.args) {
      if (recursiveFlags.has(a)) return null;
      // Short-form combined flags like `-rn`, `-nR`. Only matters for `grep`/`ls`
      // where 'r'/'R' as a letter inside a bundled short flag means recursive.
      if (a.startsWith("-") && !a.startsWith("--") && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (parsed.verb === "grep" && (ch === "r" || ch === "R")) return null;
          if (parsed.verb === "ls" && ch === "R") return null;
        }
      }
    }
  }

  // `cat > file` / `cat >> file` / `cat <<EOF` — the agent is writing.
  if (parsed.verb === "cat" && parsed.hasNonNumericRedirect) return null;

  const rawScope = extractScopeArg(parsed.verb, parsed.args);
  if (rawScope === null) return null;

  // Normalize: absolute → project-relative; null if equal to cwd or outside.
  const abs = nodePath.resolve(effectiveCwd, rawScope.replace(/^~/, process.env.HOME ?? effectiveCwd));
  const scope = toRelativePosix(abs, cwd);
  if (scope === null) return null;

  return { scope, glob: null };
}
