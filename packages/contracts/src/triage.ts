import { z } from "zod";

/**
 * LLM-assisted exception triage (D33). The LLM never decides reconciliation
 * outcomes — matching stays deterministic. It only *suggests* a root-cause
 * classification for an exception the engine has already surfaced, and every
 * suggestion is recorded append-only with the model that produced it.
 */

/** Root-cause hypotheses, distinct from the deterministic break type. */
export const TRIAGE_CLASSIFICATIONS = [
  "timing_lag",
  "amount_mismatch",
  "missing_counterpart",
  "duplicate",
  "fx_rounding",
  "unknown",
] as const;
export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];

export const TRIAGE_CONFIDENCES = ["high", "medium", "low"] as const;
export type TriageConfidence = (typeof TRIAGE_CONFIDENCES)[number];

/** The structured output contract the model must satisfy — typed, never parsed from prose. */
export const triageResultSchema = z.object({
  classification: z.enum(TRIAGE_CLASSIFICATIONS),
  confidence: z.enum(TRIAGE_CONFIDENCES),
  /** 1–3 sentences of plain English a reviewer can act on. */
  explanation: z.string(),
  /** One concrete next step. */
  suggested_action: z.string(),
});
export type TriageResult = z.infer<typeof triageResultSchema>;
