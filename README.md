# pi-rules-steer

Pi extension that injects path-conditional rule content into tool results.
Owns the "rule injection" axis of the pi tool-interception ecosystem —
distinct from command-pattern steering ([pi-bash-steer](https://github.com/quantfiction/pi-bash-steer))
and safety blocking (pi-guardrails).

**Status: pre-v0.1, skeleton only.** See the MindHive `pi-rules-steer`
project for the v0.1 build plan.

## What it does (planned)

Discovers Markdown rule files with YAML frontmatter from per-project
directories (`.pi/rules/`, `.claude/rules/`, `.cursor/rules/`) and injects
their content into tool results when the agent operates on matching paths.

- **Operative tools** (`read` / `edit` / `write`): inject rules matching
  the single target path.
- **Search tools** (`grep` / `find` / `ls` / `code_search`): inject rules
  matching the *search scope* once per call — NOT per result. (This is
  the search-scope semantic added on top of the upstream forge-flow fork.)
- **Bash**: not hooked in v0.1. Deferred to v0.2 (verb-aware extraction).

## Origin

Forked from [@the-forge-flow/pi-rules](https://github.com/MonsieurBarti/pi-rules)
(MIT, by MonsieurBarti). See [NOTICE](./NOTICE) for attribution.

## Install (future, once v0.1 ships)

Add to `~/.pi/agent/settings.json` packages array:

```json
{
  "packages": [
    "git:github.com/quantfiction/pi-bash-steer@v0.3.0",
    "git:github.com/quantfiction/pi-rules-steer@v0.1.0",
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
pnpm install            # (after v0.1 fork lands)
pnpm typecheck
pnpm test
```

## License

[MIT](./LICENSE). See [NOTICE](./NOTICE) for upstream attribution.
