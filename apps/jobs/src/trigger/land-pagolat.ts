import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { PAGOLAT_SOURCE } from "@tieout/adapters";
import { getSeedAdapter } from "../pipeline/adapters.js";
import { landSource } from "../pipeline/pipeline.js";
import { normalizeBatchTask } from "./normalize-batch.js";

const LOOKBACK_MS = 48 * 3_600_000;

/**
 * Land PagoLat settlement day-files, then fan normalization out per batch —
 * skipping units that quarantined whole at the door (D13): there is nothing
 * in them to normalize, and the quarantine row is already the worklist entry.
 */
export const landPagolatTask = task({
  id: "land-pagolat",
  run: async (payload: { from?: string; to?: string }) => {
    const to = payload.to !== undefined ? new Date(payload.to) : new Date();
    const from =
      payload.from !== undefined ? new Date(payload.from) : new Date(to.getTime() - LOOKBACK_MS);
    const adapter = getSeedAdapter(PAGOLAT_SOURCE);
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const landed = await landSource(db, adapter, { from, to }, new Date());
      logger.info("pagolat landed", { batches: landed });
      const toNormalize = landed.filter((b) => !b.batchQuarantined);
      if (toNormalize.length > 0) {
        await normalizeBatchTask.batchTriggerAndWait(
          toNormalize.map((b) => ({
            payload: { source: adapter.source, batchId: b.batchId },
            options: {
              idempotencyKey: `normalize:${adapter.source}:${adapter.normalizerVersion}:${b.batchId}`,
            },
          })),
        );
      }
      return landed;
    } finally {
      await sql.end();
    }
  },
});
