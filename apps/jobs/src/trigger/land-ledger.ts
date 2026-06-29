import "../env.js";
import { task } from "@trigger.dev/sdk";
import { LEDGER_SOURCE } from "@tieout/adapters";
import { getSeedAdapter } from "../pipeline/adapters.js";
import { landAndFanOut, parseWindow } from "./land.js";

/** Land the internal ledger, then fan normalization out per batch (see land.ts). */
export const landLedgerTask = task({
  id: "land-ledger",
  run: (payload: { from?: string; to?: string }) =>
    landAndFanOut(getSeedAdapter(LEDGER_SOURCE), parseWindow(payload)),
});
