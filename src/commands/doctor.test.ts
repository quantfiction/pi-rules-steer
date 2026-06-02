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
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
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
