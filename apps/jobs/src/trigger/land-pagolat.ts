import "../env.js";
import { task } from "@trigger.dev/sdk";
import { PAGOLAT_SOURCE } from "@tieout/adapters";
import { getSeedAdapter } from "../pipeline/adapters.js";
import { landAndFanOut, parseWindow } from "./land.js";

/** Land PagoLat settlement day-files, then fan normalization out per batch (see land.ts). */
export const landPagolatTask = task({
  id: "land-pagolat",
  run: (payload: { from?: string; to?: string }) =>
    landAndFanOut(getSeedAdapter(PAGOLAT_SOURCE), parseWindow(payload)),
});
