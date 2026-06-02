import "../env.js";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createSeedAdapters } from "../pipeline/adapters.js";
import { formatSummary, fullRecon } from "../pipeline/pipeline.js";
import { postSlackSummary } from "../pipeline/slack.js";

// Full pipeline without Trigger.dev: land both seed sources → normalize → reconcile.
// Same code the tasks orchestrate — this is the quickstart's `pnpm recon`.
const { db, sql } = createDbClient(requireDatabaseUrl());
try {
  const result = await fullRecon(db, createSeedAdapters(), { now: new Date() });
  console.log(formatSummary(result));
  if (await postSlackSummary(result.summary)) {
    console.log("  (summary posted to Slack)");
  }
} finally {
  await sql.end();
}
