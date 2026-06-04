# Changelog

All notable changes to pi-rules-steer are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Deferred to v0.2

- Bash tool interception (verb-aware scope extraction).
- ~~Broader smoke coverage across workspace / lifecycle / interactive TUI
  runtimes (tracked as task v0.1.6).~~ Completed in v0.1.6 smoke test
  (2026-06-03); all 3 runtimes verified.

[0.1.0]: https://github.com/quantfiction/pi-rules-steer/releases/tag/v0.1.0
