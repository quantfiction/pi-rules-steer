// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/testing/injection-log.{js,d.ts}.
// See NOTICE for attribution.

export type Injection = {
  path: string;
  ruleId: string;
};

export const injectionLog: Injection[] = [];

export function recordInjection(input: Injection): void {
  injectionLog.push({ ...input });
}

export function clearInjectionLog(): void {
  injectionLog.length = 0;
}
