import { logger } from "@trigger.dev/sdk";
import type { SourceAdapter } from "@tieout/contracts";
import { createDbClient, getCursor, requireDatabaseUrl, type LandResult } from "@tieout/db";
import { landSource } from "../pipeline/pipeline.js";
import { normalizeBatchTask } from "./normalize-batch.js";

const LOOKBACK_MS = 48 * 3_600_000;

export function parseWindow(payload: { from?: string; to?: string }): {
  from?: Date;
  to?: Date;
} {
  return {
    from: payload.from !== undefined ? new Date(payload.from) : undefined,
    to: payload.to !== undefined ? new Date(payload.to) : undefined,
  };
}

/**
 * The shared body of every land-* task: land the window, then fan normalization
 * out per batch (batchTrigger, never trigger-in-a-loop), skipping units that
 * quarantined whole at the door (D13) — there is nothing in them to normalize,
 * and the quarantine row is already the worklist entry. Batch idempotency makes
 * re-landing converge; the normalize idempotency keys dedupe the fan-out.
 *
 * The default window re-covers a lookback behind the source's cursor watermark
 * (D12), not just behind the clock — after downtime the window stretches back
 * to the last data actually seen instead of silently skipping the gap.
 */
export async function landAndFanOut(
  adapter: SourceAdapter,
  window: { from?: Date; to?: Date },
): Promise<LandResult[]> {
  const { db, sql } = createDbClient(requireDatabaseUrl());
  try {
    const to = window.to ?? new Date();
    let from = window.from;
    if (from === undefined) {
      const watermark = await getCursor(db, adapter.source);
      from = new Date(Math.min(watermark?.getTime() ?? to.getTime(), to.getTime()) - LOOKBACK_MS);
    }
    const landed = await landSource(db, adapter, { from, to }, new Date());
    logger.info(`${adapter.source} landed`, { batches: landed });
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
}
