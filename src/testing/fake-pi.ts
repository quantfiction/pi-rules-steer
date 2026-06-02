// Test helper: a minimal in-memory ExtensionAPI fake that records handler
// registrations and lets tests fire events synchronously. Typed against
// the SDK's ExtensionAPI shape so test payloads stay honest.
//
// Ported (and tightened) from forge-flow upstream tests/_helpers/fake-pi.ts.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Handler = (e: unknown, ctx: unknown) => unknown | Promise<unknown>;

export type RegisteredCommandRecord = { name: string; options: unknown };

/**
 * Test introspection surface added on top of the minimal ExtensionAPI fake.
 * Consumers see this as `FakePi & ExtensionAPI` — the ExtensionAPI half is
 * cast-through-unknown (only `on`/`registerCommand`/`sendUserMessage` are
 * actually implemented; calling any other method explodes loudly).
 */
export interface FakePiIntrospection {
  registeredNames(): string[];
  registrationCount(): number;
  fire(name: string, e: unknown, ctx: unknown): Promise<unknown>;
  readonly __registeredCommands: RegisteredCommandRecord[];
  readonly __userMessages: string[];
}

export type FakePi = FakePiIntrospection & ExtensionAPI;

export function makeFakePi(): FakePi {
  const handlers = new Map<string, Handler[]>();
  const __registeredCommands: RegisteredCommandRecord[] = [];
  const __userMessages: string[] = [];

  const fp = {
    on(name: string, h: Handler) {
      const list = handlers.get(name) ?? [];
      list.push(h);
      handlers.set(name, list);
    },
    registerCommand(name: string, options: unknown) {
      __registeredCommands.push({ name, options });
    },
    sendUserMessage(content: string) {
      __userMessages.push(content);
    },
    registeredNames(): string[] {
      return [...handlers.keys()].sort();
    },
    registrationCount(): number {
      return [...handlers.values()].reduce((sum, list) => sum + list.length, 0);
    },
    async fire(name: string, e: unknown, ctx: unknown): Promise<unknown> {
      const list = handlers.get(name) ?? [];
      let last: unknown = undefined;
      for (const h of list) last = await h(e, ctx);
      return last;
    },
    __registeredCommands,
    __userMessages,
  };
  return fp as unknown as FakePi;
}

/** @deprecated alias kept for tests written before makeFakePi's return type widened. */
export type FakePiExtensionAPI = FakePi;

/**
 * Constructs a tool_result event with sensible defaults. Type is intentionally
 * permissive on `toolName` so tests can pass arbitrary tool names; the
 * production handler discriminates via isReadToolResult/etc.
 */
export function makeToolResult(
  input: Record<string, unknown>,
  opts: Partial<{
    isError: boolean;
    content: Array<{ type: "text"; text: string }>;
    toolName: string;
    toolCallId: string;
    details: unknown;
  }> = {},
): Record<string, unknown> {
  return {
    type: "tool_result",
    toolName: opts.toolName ?? "read",
    toolCallId: opts.toolCallId ?? "tc-1",
    input,
    content: opts.content ?? [{ type: "text", text: "ORIG" }],
    isError: opts.isError ?? false,
    details: opts.details,
  };
}
