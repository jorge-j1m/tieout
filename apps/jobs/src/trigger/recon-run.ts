import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { runRecon } from "../pipeline/pipeline.js";
import { postSlackSummary } from "../pipeline/slack.js";

/**
 * One reconciliation run over whatever is currently normalized. The as-of
 * watermark derives from the data, so re-running without new data reproduces
 * the previous result exactly.
 */
export const reconRunTask = task({
  id: "recon-run",
  run: async (payload: { asOf?: string }) => {
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const summary = await runRecon(db, {
        now: new Date(),
        asOf: payload.asOf !== undefined ? new Date(payload.asOf) : undefined,
      });
      logger.info("recon complete", { ...summary });
      await postSlackSummary(summary);
      return summary;
    } finally {
      await sql.end();
    }
  },
});
