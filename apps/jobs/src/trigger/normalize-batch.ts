import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, normalizeBatch, requireDatabaseUrl } from "@tieout/db";
import { getSeedAdapter } from "../pipeline/adapters.js";

/** Normalize one landed batch. Idempotent: already-processed raw records are skipped. */
export const normalizeBatchTask = task({
  id: "normalize-batch",
  run: async (payload: { source: string; batchId: string }) => {
    const adapter = getSeedAdapter(payload.source);
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const result = await normalizeBatch(db, adapter, payload.batchId, new Date());
      logger.info("batch normalized", { ...result });
      return result;
    } finally {
      await sql.end();
    }
  },
});
