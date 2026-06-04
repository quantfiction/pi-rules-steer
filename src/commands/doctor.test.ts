// Smoke tests for runDoctor.
//
// Per testing-principles "over-testing thin wrappers": doctor is a thin
// adapter (discover → format → notify+sendUserMessage). Doctor-format is
// pure string assembly, not separately tested — its observable output is
// covered here. We cover only:
//   1. OK header path (1+ rules, no errors)
//   2. ERRORS header path (parse_error present)
//   3. FAILED header path (discover() rejects)
// Forge-flow's notify-type / hasUI matrix tests are intentionally dropped
// — they are implementation choreography of the adapter.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInjectionLog, recordInjection } from "../testing/injection-log.js";
import { runDoctor } from "./doctor.js";

type FakePi = {
  sendUserMessage: (msg: string) => void;
  __messages: string[];
};

const makeFakePi = (): FakePi => {
  const __messages: string[] = [];
  return {
    __messages,
    sendUserMessage: (msg: string) => {
      __messages.push(msg);
    },
  };
};

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "pi-rules-steer-doctor-"));
  await mkdir(path.join(tmp, ".pi/rules"), { recursive: true });
  clearInjectionLog();
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  clearInjectionLog();
});

describe("runDoctor", () => {
  it("happy path: emits OK header via sendUserMessage", async () => {
    await writeFile(
      path.join(tmp, ".pi/rules/a.md"),
      '---\ndescription: a\npaths: ["**/*"]\n---\n',
    );
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape for handler
    await runDoctor(pi as any, null, tmp);
    expect(pi.__messages).toHaveLength(1);
    expect(pi.__messages[0]).toMatch(
      /^pi-rules-steer doctor: OK — 1 rules, 0 errors, 0 skipped\n/,
    );
  });

  it("with parse_error: emits ERRORS header containing the reason", async () => {
    await writeFile(path.join(tmp, ".pi/rules/bad.md"), '---\npaths: ["**/*"]\n---\n');
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape
    await runDoctor(pi as any, null, tmp);
    expect(pi.__messages).toHaveLength(1);
    expect(pi.__messages[0]).toMatch(
      /^pi-rules-steer doctor: ERRORS — 0 rules, 1 errors, 0 skipped\n/,
    );
    expect(pi.__messages[0]).toContain("missing description");
  });

  it("empty injection log: emits '(none yet this session)' under Last injections", async () => {
    await writeFile(
      path.join(tmp, ".pi/rules/a.md"),
      '---\ndescription: a\npaths: ["**/*"]\n---\n',
    );
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape
    await runDoctor(pi as any, null, tmp);
    expect(pi.__messages[0]).toContain("Last injections (most recent first):");
    expect(pi.__messages[0]).toContain("(none yet this session)");
  });

  it("populated injection log: renders most-recent-first with branch + timestamp", async () => {
    await writeFile(
      path.join(tmp, ".pi/rules/a.md"),
      '---\ndescription: a\npaths: ["**/*"]\n---\n',
    );
    recordInjection({ ruleId: "rule-op", path: "src/a.ts", at: 1_700_000_000_000 });
    recordInjection({
      ruleId: "rule-scope",
      scope: "src",
      glob: "*.ts",
      viaScope: true,
      at: 1_700_000_001_000,
    });
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape
    await runDoctor(pi as any, null, tmp);
    const out = pi.__messages[0]!;
    const opIdx = out.indexOf("[op]");
    const scopeIdx = out.indexOf("[scope]");
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(opIdx).toBeGreaterThan(-1);
    // most-recent (scope, at=...01_000) must precede older op entry
    expect(scopeIdx).toBeLessThan(opIdx);
    expect(out).toContain("rule-scope");
    expect(out).toContain("scope=src glob=*.ts");
    expect(out).toContain("rule-op");
    expect(out).toContain("path=src/a.ts");
    expect(out).toContain(new Date(1_700_000_000_000).toISOString());
    expect(out).toContain(new Date(1_700_000_001_000).toISOString());
  });

  it("injection log over cap: renders only the last 5 entries", async () => {
    await writeFile(
      path.join(tmp, ".pi/rules/a.md"),
      '---\ndescription: a\npaths: ["**/*"]\n---\n',
    );
    for (let i = 0; i < 7; i++) {
      recordInjection({ ruleId: `rule-${i}`, path: `src/f${i}.ts`, at: 1_700_000_000_000 + i });
    }
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape
    await runDoctor(pi as any, null, tmp);
    const out = pi.__messages[0]!;
    expect(out).not.toContain("rule-0");
    expect(out).not.toContain("rule-1");
    expect(out).toContain("rule-2");
    expect(out).toContain("rule-6");
  });

  it("discover() rejection: emits FAILED header", async () => {
    const discoveryMod = await import("../discovery/index.js");
    const spy = vi
      .spyOn(discoveryMod, "discover")
      .mockRejectedValueOnce(new Error("disk on fire"));
    const pi = makeFakePi();
    // biome-ignore lint/suspicious/noExplicitAny: minimal pi shape
    await runDoctor(pi as any, null, tmp);
    spy.mockRestore();
    expect(pi.__messages).toHaveLength(1);
    expect(pi.__messages[0]).toBe("pi-rules-steer doctor: FAILED — disk on fire");
  });
});
