// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/discovery/types.{js,d.ts}.
// See NOTICE for attribution.

export type Source = "pi" | "claude";

export type Rule = {
  id: string;
  sourcePath: string;
  source: Source;
  description: string;
  paths: string[];
  body: string;
};

export type ParseFailure = {
  kind: "parse-failure";
  reason: string;
};

export function isParseFailure(value: Rule | ParseFailure): value is ParseFailure {
  return (value as ParseFailure).kind === "parse-failure";
}
