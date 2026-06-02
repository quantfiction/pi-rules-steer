#!/usr/bin/env node
// Hand-driven smoke for pi-rules-steer.
//
// Imports the real makeExtension(), builds a real .pi/rules/ tree under
// tmpdir, and fires synthetic operative + scope tool_result events through
// a minimal fake pi event bus. Prints a step-by-step report.
//
// LLM-free. Proves end-to-end plumbing without burning API budget.
// Resolves the project root relative to this script so it works regardless
// of where the repo is cloned.
//
// Usage:
//   pnpm smoke
//   # or:
//   pnpm exec tsx scripts/smoke.mjs

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const { makeExtension } = await import(`${repo}/src/index.ts`);
const { injectionLog, clearInjectionLog } = await import(
  `${repo}/src/testing/injection-log.ts`
);

// ---- 1. build a realistic project fixture ---------------------------------
const dir = mkdtempSync(path.join(os.tmpdir(), "smoke-rules-"));
mkdirSync(path.join(dir, ".pi", "rules"), { recursive: true });
mkdirSync(path.join(dir, "docs"), { recursive: true });
mkdirSync(path.join(dir, "src"), { recursive: true });
writeFileSync(
  path.join(dir, ".pi", "rules", "docs-rule.md"),
  `---
description: Docs-scoped rule
paths:
  - "docs/**"
---
MAGIC_DOCS_RULE_TOKEN_XYZ_4421
`,
);
writeFileSync(
  path.join(dir, ".pi", "rules", "always.md"),
  `---
description: Always-on rule
---
ALWAYS_ON_TOKEN_99
`,
);
writeFileSync(path.join(dir, "docs", "note.md"), "ordinary docs content\n");

// ---- 2. fake pi event bus -------------------------------------------------
const handlers = new Map();
const registered = [];
const userMessages = [];
const fakePi = {
  on(name, h) {
    const list = handlers.get(name) ?? [];
    list.push(h);
    handlers.set(name, list);
  },
  registerCommand(name, options) {
    registered.push({ name, options });
  },
  sendUserMessage(content) {
    userMessages.push(content);
  },
};
async function fire(name, e, ctx) {
  const list = handlers.get(name) ?? [];
  let last;
  for (const h of list) last = await h(e, ctx);
  return last;
}

// ---- 3. wire and start ----------------------------------------------------
clearInjectionLog();
makeExtension()(fakePi);

const ctx = { cwd: dir };
await fire("session_start", { type: "session_start", reason: "startup" }, ctx);

console.log("=".repeat(70));
console.log("SMOKE 1: extension loaded");
console.log("=".repeat(70));
console.log(`  handlers registered: ${[...handlers.keys()].sort().join(", ")}`);
console.log(`  commands registered: ${registered.map((r) => r.name).join(", ")}`);

// ---- 4. operative branch: read docs/note.md -------------------------------
const readEvent = {
  type: "tool_result",
  toolName: "read",
  toolCallId: "tc-1",
  input: { path: "docs/note.md" },
  content: [{ type: "text", text: "ordinary docs content\n" }],
  isError: false,
  details: undefined,
};
const readResult = await fire("tool_result", readEvent, ctx);

console.log("\n" + "=".repeat(70));
console.log("SMOKE 2: operative branch (read docs/note.md)");
console.log("=".repeat(70));
console.log("  returned content:");
for (const [i, c] of readResult.content.entries()) {
  console.log(`    [${i}] ${JSON.stringify(c.text).slice(0, 80)}`);
}
console.log(`  injectionLog now: ${injectionLog.length} entries`);

// ---- 5. scope branch: grep with path=docs ---------------------------------
const grepEvent = {
  type: "tool_result",
  toolName: "grep",
  toolCallId: "tc-2",
  input: { path: "docs", pattern: "ordinary" },
  content: [
    { type: "text", text: "docs/note.md:1:ordinary docs content" },
    { type: "text", text: "docs/other.md:3:some ordinary thing" },
  ],
  isError: false,
  details: undefined,
};
const grepResult = await fire("tool_result", grepEvent, ctx);

console.log("\n" + "=".repeat(70));
console.log("SMOKE 3: scope branch (grep path=docs)");
console.log("=".repeat(70));
console.log(
  `  returned: ${grepResult === undefined ? "<undefined> (no re-inject — dedup working)" : `${grepResult.content.length} content items`}`,
);
console.log(`  injectionLog now: ${injectionLog.length} entries`);

// ---- 6. dedup proof: read same path again should NOT re-inject -----------
const readAgain = await fire("tool_result", readEvent, ctx);

console.log("\n" + "=".repeat(70));
console.log("SMOKE 4: dedup (read docs/note.md AGAIN)");
console.log("=".repeat(70));
console.log(
  `  returned: ${readAgain === undefined ? "<undefined> (already injected — correct)" : "<wrapped>!! BUG: re-injected"}`,
);
console.log(`  injectionLog still: ${injectionLog.length} entries`);

// ---- 7. scope-only inject after session reset -----------------------------
await fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
await fire("session_start", { type: "session_start", reason: "startup" }, ctx);

const grepAfterReset = await fire("tool_result", grepEvent, ctx);
console.log("\n" + "=".repeat(70));
console.log("SMOKE 5: session reset → grep fires rule fresh");
console.log("=".repeat(70));
console.log(
  `  returned: ${grepAfterReset === undefined ? "<undefined>" : `${grepAfterReset.content.length} items`}`,
);
console.log(
  `  first content[0]: ${JSON.stringify(grepAfterReset?.content?.[0]?.text)?.slice(0, 80)}`,
);
console.log(`  injectionLog now: ${injectionLog.length} entries`);

console.log("\n" + "=".repeat(70));
console.log("Final injectionLog:");
for (const [i, entry] of injectionLog.entries()) {
  console.log(`  [${i}] ${JSON.stringify(entry).slice(0, 120)}`);
}
console.log("=".repeat(70));

rmSync(dir, { recursive: true, force: true });

// ---- 8. /pi-rules-steer doctor smoke --------------------------------------
const dir2 = mkdtempSync(path.join(os.tmpdir(), "smoke-doctor-"));
mkdirSync(path.join(dir2, ".pi", "rules"), { recursive: true });
writeFileSync(
  path.join(dir2, ".pi", "rules", "good.md"),
  '---\ndescription: G\npaths: ["src/**"]\n---\nbody\n',
);
writeFileSync(
  path.join(dir2, ".pi", "rules", "bad.md"),
  '---\npaths: ["**"]\n---\nno description\n',
);

handlers.clear();
registered.length = 0;
userMessages.length = 0;
makeExtension()(fakePi);
await fire("session_start", { type: "session_start", reason: "startup" }, { cwd: dir2 });

const doctorCmd = registered.find((r) => r.name === "pi-rules-steer");
await doctorCmd.options.handler("doctor", { hasUI: false, ui: { notify: () => {} } });

console.log("\n" + "=".repeat(70));
console.log("SMOKE 6: /pi-rules-steer doctor against real fixture");
console.log("=".repeat(70));
console.log(userMessages[0]?.split("\n").slice(0, 12).join("\n"));
console.log("  ...");
console.log("=".repeat(70));

rmSync(dir2, { recursive: true, force: true });
