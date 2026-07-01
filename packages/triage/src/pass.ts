import {
  existingTriageHashes,
  listTriageCandidates,
  recordTriageSuggestions,
  type Db,
  type NewTriageSuggestion,
} from "@tieout/db";
import {
  TRIAGE_PROMPT_VERSION,
  triageException,
  triageInputHash,
  type TriageClient,
} from "./triage.js";

export interface TriagePassOptions {
  model: string;
  /** Per-pass spend cap: at most this many LLM calls. */
  maxCalls: number;
}

export interface TriagePassSummary {
  candidates: number;
  cached: number;
  called: number;
  recorded: number;
  /** API errors — not recorded, so the next pass retries them. */
  transientFailures: number;
}

/**
 * One triage sweep over the open worklist (D33): hash each exception's current
 * break content, skip everything already suggested, and spend at most
 * `maxCalls` LLM calls on the rest — sequentially, so the cap is a hard budget.
 * Idempotent by construction: re-running over unchanged breaks costs nothing.
 */
export async function runTriagePass(
  db: Db,
  client: TriageClient,
  opts: TriagePassOptions,
): Promise<TriagePassSummary> {
  const candidates = await listTriageCandidates(db);
  const hashed = candidates.map((candidate) => ({
    candidate,
    inputHash: triageInputHash(
      { fingerprint: candidate.fingerprint, type: candidate.type, details: candidate.details },
      opts.model,
    ),
  }));

  const cached = await existingTriageHashes(
    db,
    hashed.map((h) => h.inputHash),
  );
  const pending = hashed.filter((h) => !cached.has(h.inputHash)).slice(0, opts.maxCalls);

  const rows: NewTriageSuggestion[] = [];
  let transientFailures = 0;
  for (const { candidate, inputHash } of pending) {
    const outcome = await triageException(client, {
      model: opts.model,
      input: { fingerprint: candidate.fingerprint, type: candidate.type, details: candidate.details },
    });
    if (outcome.failure === "api_error") {
      transientFailures += 1;
      continue;
    }
    rows.push({
      exceptionId: candidate.exceptionId,
      breakId: candidate.breakId,
      inputHash,
      model: opts.model,
      promptVersion: TRIAGE_PROMPT_VERSION,
      classification: outcome.result.classification,
      confidence: outcome.result.confidence,
      explanation: outcome.result.explanation,
      suggestedAction: outcome.result.suggested_action,
    });
  }

  const recorded = await recordTriageSuggestions(db, rows);
  return {
    candidates: candidates.length,
    cached: cached.size,
    called: pending.length,
    recorded,
    transientFailures,
  };
}
