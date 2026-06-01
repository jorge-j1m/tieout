import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createSeedAdapters } from "../pipeline/adapters.js";
import { formatSummary, fullRecon } from "../pipeline/pipeline.js";
import { postSlackSummary } from "../pipeline/slack.js";

/**
 * The whole Stage 1 story in one trigger — land both sources, normalize,
 * reconcile. Same code path as `pnpm recon`; the granular tasks are the
 * production shape, this is the demo button.
 */
export const reconAllTask = task({
  id: "recon-all",
  run: async () => {
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const result = await fullRecon(db, createSeedAdapters(), { now: new Date() });
      logger.info(formatSummary(result));
      await postSlackSummary(result.summary);
      return result.summary;
    } finally {
      await sql.end();
    }
  },
});
