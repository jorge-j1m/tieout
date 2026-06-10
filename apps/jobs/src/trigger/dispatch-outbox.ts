import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl, unprocessedOutbox } from "@tieout/db";
import { reconRunTask } from "./recon-run.js";

/**
 * The outbox dispatcher (D17): when supersessions or tombstones are waiting,
 * trigger a reconciliation run — re-evaluation is always a NEW run; past runs
 * are never mutated. The run itself stamps the events it covered, so this task
 * stays a thin "is there work?" poll, idempotent by construction.
 */
export const dispatchOutboxTask = task({
  id: "dispatch-outbox",
  run: async () => {
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const pending = await unprocessedOutbox(db, { limit: 1 });
      if (pending.length === 0) {
        logger.info("outbox empty — nothing to re-evaluate");
        return { dispatched: false };
      }
      await reconRunTask.triggerAndWait(
        {},
        { idempotencyKey: `outbox-dispatch:${pending[0]!.id}` },
      );
      return { dispatched: true };
    } finally {
      await sql.end();
    }
  },
});
