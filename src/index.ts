// pi-rules-steer — Pi extension that injects path-conditional rule content
// into tool results.
//
// Status: pre-v0.1 skeleton. Implementation lands in the v0.1 epic
// (fork @the-forge-flow/pi-rules + add search-scope semantics).
//
// See README.md and the MindHive `pi-rules-steer` project for the build plan.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function piRulesSteerExtension(_pi: ExtensionAPI): void {
  // TODO(v0.1 — fork forge-flow):
  //   - session_start: walk .pi/rules/ + .claude/rules/ + .cursor/rules/
  //   - parse frontmatter (yaml), compile matchers (picomatch)
  //   - tool_result handler with two branches:
  //       1. operative tools (read/edit/write) → match against event.input.path
  //       2. search tools (grep/find/ls/code_search) → match against scope arg,
  //          predictive matching, single inject per call
  //   - injectedIds dedupe per session
  //   - /pi-rules-steer doctor slash command
}
