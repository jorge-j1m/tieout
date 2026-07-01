import "../env.js";
import { logger, task } from "@trigger.dev/sdk";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createTriageClient, runTriagePass } from "@tieout/triage";

/**
 * LLM triage sweep (D33): annotate open exceptions with suggested
 * classifications. Thin by design — all logic lives in @tieout/triage, testable
 * with a mocked client. Idempotent at the content level: suggestions are cached
 * per input hash, so re-running over unchanged breaks makes zero LLM calls, and
 * the per-pass call cap bounds spend even on a fresh worklist.
 *
 * Off unless TIEOUT_TRIAGE_ENABLED=true AND TIEOUT_TRIAGE_API_KEY is set — the
 * deterministic pipeline never depends on this task, and the public demo serves
 * only suggestions precomputed by earlier passes. Provider-agnostic: any
 * OpenAI-compatible endpoint via TIEOUT_TRIAGE_BASE_URL + model.
 */
export const triageExceptionsTask = task({
  id: "triage-exceptions",
  run: async (_payload: Record<string, never>) => {
    if (process.env.TIEOUT_TRIAGE_ENABLED !== "true") {
      logger.info("triage disabled (TIEOUT_TRIAGE_ENABLED != true) — skipping");
      return { skipped: true as const };
    }
    if (!process.env.TIEOUT_TRIAGE_API_KEY) {
      logger.warn("triage enabled but TIEOUT_TRIAGE_API_KEY is unset — skipping");
      return { skipped: true as const };
    }
    const model = process.env.TIEOUT_TRIAGE_MODEL ?? "claude-opus-4-8";
    const maxCalls = Number(process.env.TIEOUT_TRIAGE_MAX_CALLS ?? 25);
    const { db, sql } = createDbClient(requireDatabaseUrl());
    try {
      const summary = await runTriagePass(db, createTriageClient(), { model, maxCalls });
      logger.info(
        `triage: ${summary.candidates} candidates, ${summary.cached} cached, ` +
          `${summary.called} called, ${summary.recorded} recorded, ` +
          `${summary.transientFailures} transient failures (model ${model})`,
      );
      return { skipped: false as const, model, ...summary };
    } finally {
      await sql.end();
    }
  },
});
