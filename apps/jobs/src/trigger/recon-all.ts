import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { loadSeedFxRates } from "@tieout/seed";
import { createSeedAdapters } from "../pipeline/adapters.js";
import { formatSummary, fullRecon } from "../pipeline/pipeline.js";
import { postSlackSummary } from "../pipeline/slack.js";
import { triageExceptionsTask } from "./triage-exceptions.js";

/**
 * The whole pipeline story in one trigger — land every source, normalize,
 * reconcile. Same code path as `pnpm recon`; the granular tasks are the
 * production shape, this is the demo button.
 */
export const reconAllTask = task({
  id: "recon-all",
  run: async () => {
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const result = await fullRecon(db, createSeedAdapters(), {
        now: new Date(),
        fxRates: loadSeedFxRates(),
      });
      logger.info(formatSummary(result));
      await postSlackSummary(result.summary);
      // Annotate the refreshed worklist (D33). Its own task: LLM retries and
      // spend stay isolated from the deterministic run, which never waits on it.
      if (process.env.TIEOUT_TRIAGE_ENABLED === "true") {
        await triageExceptionsTask.trigger({});
      }
      return result.summary;
    } finally {
      await sql.end();
    }
  },
});
