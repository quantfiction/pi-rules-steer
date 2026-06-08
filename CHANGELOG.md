# Changelog

All notable changes to pi-rules-steer are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-07

### Added

- **Bash tool interception (Branch 3).** Path-conditional rules now
  fire on `tool_result` events for bash invocations of supported
  search/read verbs: `grep` (non-recursive), `rg`, `ls` (non-recursive),
  `cat` (no redirect/heredoc), `head`, `tail`, `fd`. Closes the
  long-deferred v0.2 deferral (see `### Deferred to v0.2` in v0.1.0)
  and the failure mode documented in the v0.1.2 smoke test.
  - New module `src/extraction/bash.ts` parses `input.command` via
    `shell-quote`, strips `cd <path> &&` prefixes, env-var prefixes
    (`FOO=bar`), and wrapper verbs (`timeout`, `nice`, `nohup`,
    `stdbuf`, `time`), then extracts the per-verb scope-bearing
    positional. Tokenization respects pipeline boundaries (`|`,
    `||`, `&&`, `;`, `&`), redirect operators (`<`, `<<`, `>`, `>>`),
    and end-of-flags `--`.
  - **Architectural separation with pi-bash-steer.** v0.2 deliberately
    does NOT cover the bash shapes that pi-bash-steer blocks at
    `tool_call` (`find`, `grep -r/-R`, `ls -R`). pi-bash-steer owns
    blocking anti-patterns; pi-rules-steer owns rule injection on the
    permitted set. Recursive `grep`/`ls` shapes therefore return null
    from the extractor even if they slip past pi-bash-steer in
    `warn`/`off` modes.
  - **`cat` redirect detection.** `cat > file`, `cat >> file`,
    `cat <<EOF` and `cat <<EOF > file` return null — the agent is
    writing, not searching. Empirical analysis of 47,332 bash calls
    across 834 MindHive sessions showed 44% of `cat` calls are
    heredoc writes.
  - **Single-inject invariant preserved** across all three branches
    via the shared `injectedIds` Set. A `bash grep` injection in
    Branch 3 dedups against subsequent pi-native `grep` calls in
    Branch 2 (and vice versa), and against operative `read`/`edit`/
    `write` calls in Branch 1.
  - Adds `shell-quote ^1.8.4` as a runtime dependency.
  - 53 new tests (43 unit tests in `src/extraction/bash.test.ts`,
    10 invariant/integration tests in `src/injection-invariants.test.ts`).
    Total suite: 144 → 196 tests.
  - Per-glob coverage threshold (≥80%) added for `src/extraction/bash.ts`.

- `/pi-rules-steer doctor` now surfaces a **Last injections** section listing
  the most recent 5 injections (most-recent first) with branch tag
  (`[op]` / `[scope]`), rule id, path or scope+glob, and ISO 8601 UTC
  timestamp. When the per-session buffer is empty, the section prints
  `(none yet this session)` to advertise the wiring. Resolves the v0.2
  deferral noted in the v0.1.6 smoke test (workspace `37f53a96`), where
  branch verification required reading `session.jsonl` directly.
- `Injection` payloads now carry an `at: number` (epoch ms) field,
  populated at both `recordInjection` call sites in the `tool_result`
  handler.

### Fixed

- `/pi-rules-steer doctor` output now wraps the report in a markdown fenced
  code block before passing to `pi.sendUserMessage()`. The pi TUI renders
  user messages as markdown, which previously silently consumed `*` / `**`
  characters in path globs (e.g. `services/web/src/**/*.tsx` rendered as
  `services/web/src//*.tsx`). With the fence, asterisks are preserved
  verbatim. `format()` itself remains a pure plaintext emitter.

### Changed (internal)

- Moved `src/testing/injection-log.ts` → `src/runtime/injection-log.ts`.
  The module is per-session runtime telemetry called from the production
  `tool_result` handler; the `testing/` location was misleading. Test
  imports (`injectionLog`, `clearInjectionLog`) updated in place.
  No public API change — the extension entry-point is unchanged.

## [0.1.0] - 2026-06-02

Initial public release. Source-fork of @the-forge-flow/pi-rules v0.1.0
(commit `e1cc6b42243714576dd9f1e2fff5a16324f41d85`) with search-scope
semantics added on top of the upstream operative-tool injection model.

### Added

- Path-conditional rule injection on `read` / `edit` / `write` (operative
  tools).
- **Search-scope injection** on `grep` / `find` / `ls` / `code_search`:
  rules matching the search *scope* are injected once per call, not per
  result. `src/extraction/scope.ts` extracts `path` / `glob` /
  `fileGlob` args and normalizes to project-relative POSIX;
  `src/matching/compile.ts#compileRuleScope` performs static-segment
  overlap matching.
- Discovery from `.pi/rules/`, `.claude/rules/`, `~/.pi/rules/`, and
  `~/.claude/rules/` with YAML frontmatter (`description`, `paths`,
  `always`).
- `/pi-rules-steer doctor` slash command: lists discovered rules,
  surfaces parse errors, prints coverage by root.
- Watcher-driven hot reload (debounced) with per-root `fs.watch`.
- 141 vitest tests with per-glob coverage thresholds on the
  load-bearing surfaces (`scope.ts`, `compile.ts`, `index.ts`).

### Changed (vs. upstream forge-flow)

- Slash command renamed `/pi-rules` → `/pi-rules-steer`.
- Stderr log prefix `[pi-rules]` → `[pi-rules-steer]`.
- Imports migrated from `@mariozechner/pi-coding-agent` to
  `@earendil-works/pi-coding-agent`.

### Deferred to v0.2 (completed in Unreleased — see above)

- ~~Bash tool interception (verb-aware scope extraction).~~ Shipped in
  Unreleased.
- ~~Broader smoke coverage across workspace / lifecycle / interactive TUI
  runtimes (tracked as task v0.1.6).~~ Completed in v0.1.6 smoke test
  (2026-06-03); all 3 runtimes verified.

[0.2.0]: https://github.com/quantfiction/pi-rules-steer/releases/tag/v0.2.0
[0.1.0]: https://github.com/quantfiction/pi-rules-steer/releases/tag/v0.1.0
