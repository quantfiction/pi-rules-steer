# pi-rules-steer

Pi extension that injects path-conditional rule content into tool results.
Owns the "rule injection" axis of the pi tool-interception ecosystem —
distinct from command-pattern steering ([pi-bash-steer](https://github.com/quantfiction/pi-bash-steer))
and safety blocking (pi-guardrails).

**Status: v0.2.0 shipped. Bash tool interception (Branch 3) for
`grep`/`rg`/`ls`/`cat`/`head`/`tail`/`fd` invocations;
`/pi-rules-steer doctor` surfaces a `Last injections` section
(last 5, branch tag + rule id + path/scope+glob + ISO 8601 timestamp).
196 vitest tests, watcher-driven hot reload, operative + scope + bash
branches.**

## What it does

Discovers Markdown rule files with YAML frontmatter from per-project
directories (`.pi/rules/`, `.claude/rules/`) and per-user directories
(`~/.pi/rules/`, `~/.claude/rules/`) and injects their content into
tool results when the agent operates on matching paths.

- **Operative tools** (`read` / `edit` / `write`): inject rules matching
  the single target path.
- **Search tools** (`grep` / `find` / `ls` / `code_search`): inject rules
  matching the *search scope* once per call — NOT per result. (This is
  the search-scope semantic added on top of the upstream forge-flow fork.)
- **Bash** (v0.2): rules also inject on bash invocations of supported
  search/read verbs (`grep` non-recursive, `rg`, `ls` non-recursive,
  `cat` excluding redirect/heredoc shapes, `head`, `tail`, `fd`).
  Deliberately does NOT cover `find`, `grep -r/-R`, or `ls -R` —
  those are anti-patterns blocked by
  [pi-bash-steer](https://github.com/quantfiction/pi-bash-steer)
  at `tool_call`. The two extensions compose by separation of concerns:
  pi-bash-steer owns blocking, pi-rules-steer owns rule injection on
  the permitted set.

## Origin

Forked from [@the-forge-flow/pi-rules](https://github.com/MonsieurBarti/pi-rules)
(MIT, by MonsieurBarti). See [NOTICE](./NOTICE) for attribution.

## Install

Add to `~/.pi/agent/settings.json` packages array:

```json
{
  "packages": [
    "git:github.com/quantfiction/pi-bash-steer@v0.3.0",
    "git:github.com/quantfiction/pi-rules-steer@v0.2.0",
    "npm:@tomooshi/condensed-milk-pi"
  ]
}
```

Position **after** `pi-bash-steer` (bash interception runs first) and
**before** `@tomooshi/condensed-milk-pi` (rules contribute a stable
system-prompt block; preserves prompt-cache stability).

## Example rule file

```markdown
---
description: Database port discipline
paths:
  - "migrations/**"
  - "packages/db-client/**"
  - "**/*.schema.ts"
---

# Database port discipline

Production data: port 5433. Dev data: port 5450.
Never cross production and dev databases.
```

## Development

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run
pnpm test:coverage   # vitest run --coverage (v8, per-glob ≥80% thresholds)
pnpm smoke           # hand-driven end-to-end smoke (LLM-free)
```

## License

[MIT](./LICENSE). See [NOTICE](./NOTICE) for upstream attribution.
