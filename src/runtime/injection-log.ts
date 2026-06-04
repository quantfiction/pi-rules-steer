// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/testing/injection-log.{js,d.ts}.
// See NOTICE for attribution.
//
// Moved out of src/testing/ in v0.2: this module is per-session runtime
// telemetry — `recordInjection` is called from the production tool_result
// handler in src/index.ts. The buffer's reset/read surface (injectionLog,
// clearInjectionLog) is also used directly by tests; that dual-use does
// not make the module test-scaffolding.

/**
 * Operative-branch injection (read/edit/write): a single file path triggered
 * the rule. Shape unchanged from upstream forge-flow v0.1.0.
 */
export type OperativeInjection = {
  ruleId: string;
  path: string;
  /** Epoch ms when the injection fired. Added in v0.2 for doctor telemetry. */
  at: number;
};

/**
 * Scope-branch injection (grep/find/ls/code_search, v0.1.3+): a search query
 * — scope and/or glob arg — triggered the rule. `viaScope: true` discriminates.
 * `scope` and `glob` mirror what extractScope returned for the call; whichever
 * was null in the call is null here too.
 */
export type ScopeInjection = {
  ruleId: string;
  scope: string | null;
  glob: string | null;
  viaScope: true;
  /** Epoch ms when the injection fired. Added in v0.2 for doctor telemetry. */
  at: number;
};

export type Injection = OperativeInjection | ScopeInjection;

export const injectionLog: Injection[] = [];

export function recordInjection(input: Injection): void {
  injectionLog.push({ ...input });
}

export function clearInjectionLog(): void {
  injectionLog.length = 0;
}
