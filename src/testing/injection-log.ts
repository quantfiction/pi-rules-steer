// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/testing/injection-log.{js,d.ts}.
// See NOTICE for attribution.

/**
 * Operative-branch injection (read/edit/write): a single file path triggered
 * the rule. Shape unchanged from upstream forge-flow v0.1.0.
 */
export type OperativeInjection = {
  ruleId: string;
  path: string;
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
};

export type Injection = OperativeInjection | ScopeInjection;

export const injectionLog: Injection[] = [];

export function recordInjection(input: Injection): void {
  injectionLog.push({ ...input });
}

export function clearInjectionLog(): void {
  injectionLog.length = 0;
}
