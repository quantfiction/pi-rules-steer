// Ported from @the-forge-flow/pi-rules v0.1.0 (commit e1cc6b4) dist/commands/doctor.{js,d.ts}.
// See NOTICE for attribution.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as discoveryMod from "../discovery/index.js";
import { injectionLog } from "../runtime/injection-log.js";
import { format, hasErrors } from "./doctor-format.js";

export async function runDoctor(
  pi: ExtensionAPI,
  uiCtx: ExtensionCommandContext | null,
  cwd: string,
): Promise<void> {
  let report: string;
  let errored: boolean;
  try {
    const result = await discoveryMod.discover(cwd);
    report = format(result, { injections: injectionLog });
    errored = hasErrors(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = `pi-rules-steer doctor: FAILED — ${msg}`;
    if (uiCtx?.hasUI) uiCtx.ui.notify(failed, "error");
    pi.sendUserMessage(failed);
    return;
  }
  if (uiCtx?.hasUI) uiCtx.ui.notify(report, errored ? "error" : "info");
  pi.sendUserMessage(report);
}
