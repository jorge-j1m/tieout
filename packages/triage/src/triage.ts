import { createHash } from "node:crypto";
import {
  TRIAGE_CLASSIFICATIONS,
  TRIAGE_CONFIDENCES,
  triageResultSchema,
  type BreakType,
  type TriageResult,
} from "@tieout/contracts";

/**
 * LLM-assisted exception triage (D33). The model only *suggests* — a root-cause
 * classification, a plain-English explanation, one next step — for an exception
 * the deterministic engine already surfaced. It never decides reconciliation
 * outcomes and it never blocks the pipeline: every failure path degrades to a
 * recorded "unknown".
 *
 * Provider-agnostic by design: the client is the OpenAI-compatible
 * chat-completions shape (OpenAI, Anthropic's compat endpoint, Ollama, vLLM,
 * OpenRouter, ...). The answer must be one JSON object; it is validated against
 * the schema in `@tieout/contracts` — never trusted, never parsed from prose.
 */

/** Bump when the prompt changes — suggestions record it, and the cache keys on it. */
export const TRIAGE_PROMPT_VERSION = "triage-v2";

/** What the model gets to see: the exception's deterministic facts, nothing else. */
export interface TriageInput {
  fingerprint: string;
  type: BreakType;
  /** `breaks.details` — amounts, consumed txns, and the near-miss context the matcher recorded. */
  details: unknown;
}

/**
 * One chat completion against any OpenAI-compatible provider — injected so the
 * module is testable with a fake, exactly like SourceAdapters are.
 * `finishReason` is the provider's `finish_reason` ("stop" = answered fully).
 */
export interface TriageClient {
  complete(args: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<{ content: string | null; finishReason: string | null }>;
}

export interface TriageOutcome {
  result: TriageResult;
  /**
   * Why the result degraded to "unknown", when it did. `api_error` is transient
   * (callers should not cache it); the other two are properties of the input.
   */
  failure?: "stop_reason" | "parse_failure" | "api_error";
}

/** Recursively key-sorted JSON, so jsonb round-trips and object literals hash alike. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The cache key (D33): one suggestion per (logical break content, model, prompt).
 * A restated amount changes `details`, so the same fingerprint re-triages; the
 * same break recurring unchanged run after run does not.
 */
export function triageInputHash(input: TriageInput, model: string): string {
  return createHash("sha256")
    .update(
      stableStringify({
        fingerprint: input.fingerprint,
        type: input.type,
        details: input.details,
        model,
        promptVersion: TRIAGE_PROMPT_VERSION,
      }),
    )
    .digest("hex");
}

const SYSTEM_PROMPT = `You are a reconciliation analyst assistant for a payments reconciliation engine.
The engine ingests transactions from multiple sources (an internal ledger, payment processors, banks),
matches them deterministically, and surfaces unexplained differences as typed exceptions.

You will be given one exception: its deterministic break type and the full details the matcher
recorded, including the transactions it consumed and any near-miss candidates it considered.
Amounts are integer minor units (cents); currency exponents differ by currency.

Suggest the most likely root cause, choosing exactly one classification:
- timing_lag: the counterpart exists but settles later (settlement lag), so the break should clear on its own.
- amount_mismatch: both sides exist but disagree on amount — fees, partial captures, or data entry.
- missing_counterpart: one side genuinely has no matching record.
- duplicate: the same real-world transaction appears more than once on one side.
- fx_rounding: a cross-currency pair diverges only by conversion rounding or a stale rate.
- unknown: the evidence does not support any of the above.

Rules:
- You are producing a suggestion for a human reviewer, never a resolution. Matching stays deterministic.
- explanation: 1-3 plain-English sentences grounded in the details you were given.
- suggested_action: one concrete next step the reviewer can take.
- Prefer "unknown" with low confidence over a confident guess the details do not support.

Respond with a single JSON object and nothing else — no markdown, no prose around it:
{
  "classification": one of ${JSON.stringify(TRIAGE_CLASSIFICATIONS)},
  "confidence": one of ${JSON.stringify(TRIAGE_CONFIDENCES)},
  "explanation": string,
  "suggested_action": string
}`;

export function buildTriagePrompt(input: TriageInput): { system: string; user: string } {
  const user = [
    `Break type (deterministic): ${input.type}`,
    `Exception fingerprint: ${input.fingerprint}`,
    `Break details as recorded by the matcher:`,
    stableStringify(input.details),
  ].join("\n");
  return { system: SYSTEM_PROMPT, user };
}

const unknownResult = (explanation: string): TriageResult => ({
  classification: "unknown",
  confidence: "low",
  explanation,
  suggested_action: "Review this exception manually.",
});

/** The one JSON object in the answer, tolerating a markdown fence around it; null if absent/invalid. */
function parseTriageJson(content: string): TriageResult | null {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(unfenced);
  } catch {
    return null;
  }
  const validated = triageResultSchema.safeParse(raw);
  return validated.success ? validated.data : null;
}

/**
 * One triage call. Never throws — the LLM is an annotator, not a dependency;
 * a bad answer or a down API degrades to "unknown" and the pipeline moves on.
 */
export async function triageException(
  client: TriageClient,
  args: { model: string; input: TriageInput; maxTokens?: number },
): Promise<TriageOutcome> {
  const { system, user } = buildTriagePrompt(args.input);
  try {
    const completion = await client.complete({
      model: args.model,
      system,
      user,
      maxTokens: args.maxTokens ?? 1024,
    });
    if (completion.finishReason !== "stop") {
      return {
        result: unknownResult(
          `The model stopped before answering (finish reason: ${completion.finishReason ?? "none"}).`,
        ),
        failure: "stop_reason",
      };
    }
    const parsed = completion.content === null ? null : parseTriageJson(completion.content);
    if (parsed === null) {
      return {
        result: unknownResult("The model's answer did not match the triage schema."),
        failure: "parse_failure",
      };
    }
    return { result: parsed };
  } catch (error) {
    return {
      result: unknownResult(
        `Triage call failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
      failure: "api_error",
    };
  }
}
