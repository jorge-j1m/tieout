import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { LEDGER_SOURCE } from "@tieout/adapters";
import { getSeedAdapter } from "../pipeline/adapters.js";
import { landSource } from "../pipeline/pipeline.js";
import { normalizeBatchTask } from "./normalize-batch.js";

const LOOKBACK_MS = 48 * 3_600_000;

/**
 * Land the internal ledger, then fan normalization out per batch (batchTrigger,
 * never trigger-in-a-loop). The batch idempotency key in the database makes
 * re-runs converge; the normalize idempotency keys dedupe the fan-out.
 */
export const landLedgerTask = task({
  id: "land-ledger",
  run: async (payload: { from?: string; to?: string }) => {
    const to = payload.to !== undefined ? new Date(payload.to) : new Date();
    const from =
      payload.from !== undefined ? new Date(payload.from) : new Date(to.getTime() - LOOKBACK_MS);
    const adapter = getSeedAdapter(LEDGER_SOURCE);
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const landed = await landSource(db, adapter, { from, to }, new Date());
      logger.info("ledger landed", { batches: landed });
      if (landed.length > 0) {
        await normalizeBatchTask.batchTriggerAndWait(
          landed.map((b) => ({
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
