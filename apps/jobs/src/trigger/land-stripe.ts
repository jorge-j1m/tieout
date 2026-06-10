import "../env.js";
import { logger, schedules } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createStripeAdapterFromEnv } from "../pipeline/adapters.js";
import { landSource } from "../pipeline/pipeline.js";
import { normalizeBatchTask } from "./normalize-batch.js";

const LOOKBACK_MS = 48 * 3_600_000;

/**
 * Scheduled, windowed Stripe landing (D12): every run re-covers a 48h lookback
 * window behind the schedule timestamp — late, out-of-order data is re-observed
 * and content-hash dedup makes the overlap free. Assume every run happens twice.
 *
 * The hourly cron is back now that the live client exists (the Stage 2 promise):
 * with STRIPE_LIVE_LANDING=1 it polls the real test-mode API; without it the run
 * is an explicit no-op — fixtures land on demand, not on a clock.
 */
export const landStripeTask = schedules.task({
  id: "land-stripe",
  cron: "0 * * * *",
  run: async (payload) => {
    const { adapter, live } = createStripeAdapterFromEnv();
    if (!live) {
      logger.info("live stripe landing not configured (STRIPE_LIVE_LANDING) — skipping scheduled poll");
      return [];
    }
    const to = payload.timestamp;
    const from = new Date(to.getTime() - LOOKBACK_MS);
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
