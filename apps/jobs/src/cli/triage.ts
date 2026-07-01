import "../env.js";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createTriageClient, runTriagePass } from "@tieout/triage";

// One triage pass without Trigger.dev — how the demo dataset's suggestions get
// precomputed (D33): run once after `pnpm recon`, and the deployed site serves
// stored suggestions with zero live LLM calls. Idempotent: unchanged breaks
// are cached by input hash and cost nothing on re-runs.
if (process.env.TIEOUT_TRIAGE_ENABLED !== "true") {
  console.log("triage disabled — set TIEOUT_TRIAGE_ENABLED=true (and TIEOUT_TRIAGE_API_KEY) to run");
  process.exit(0);
}
if (!process.env.TIEOUT_TRIAGE_API_KEY) {
  console.error("TIEOUT_TRIAGE_ENABLED=true but TIEOUT_TRIAGE_API_KEY is unset");
  process.exit(1);
}

const model = process.env.TIEOUT_TRIAGE_MODEL ?? "claude-opus-4-8";
const maxCalls = Number(process.env.TIEOUT_TRIAGE_MAX_CALLS ?? 25);
const { db, sql } = createDbClient(requireDatabaseUrl());
try {
  const summary = await runTriagePass(db, createTriageClient(), { model, maxCalls });
  console.log(
    `triage (${model}): ${summary.candidates} candidates, ${summary.cached} cached, ` +
      `${summary.called} called, ${summary.recorded} recorded, ` +
      `${summary.transientFailures} transient failures`,
  );
} finally {
  await sql.end();
}
