import "../env.js";
import { logger, schedules } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { STRIPE_SOURCE } from "@tieout/adapters";
import { getSeedAdapter } from "../pipeline/adapters.js";
import { landSource } from "../pipeline/pipeline.js";
import { normalizeBatchTask } from "./normalize-batch.js";

const LOOKBACK_MS = 48 * 3_600_000;

/**
 * Scheduled, windowed Stripe landing (D12): every run re-covers a 48h lookback
 * window behind the schedule timestamp — late, out-of-order data is re-observed
 * and content-hash dedup makes the overlap free. Assume every run happens twice.
 */
export const landStripeTask = schedules.task({
  id: "land-stripe",
  cron: "0 * * * *",
  run: async (payload) => {
    const to = payload.timestamp;
    const from = new Date(to.getTime() - LOOKBACK_MS);
    const adapter = getSeedAdapter(STRIPE_SOURCE);
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const landed = await landSource(db, adapter, { from, to }, new Date());
      logger.info("stripe landed", { batches: landed });
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
