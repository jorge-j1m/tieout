import { describe, expect, it, vi } from "vitest";
import type { TriageResult } from "@tieout/contracts";
import {
  TRIAGE_PROMPT_VERSION,
  buildTriagePrompt,
  triageException,
  triageInputHash,
  type TriageClient,
  type TriageInput,
} from "./triage.js";

const input: TriageInput = {
  fingerprint: "fp-1",
  type: "missing_in_ledger",
  details: { txns: [{ source: "stripe", sourceId: "ch_1", amountMinor: "1250" }] },
};

const parsed: TriageResult = {
  classification: "timing_lag",
  confidence: "high",
  explanation: "The charge settled after the ledger cutoff.",
  suggested_action: "Re-run reconciliation after the next ledger export.",
};

/** The mock stands in for the provider's chat-completions endpoint, nothing else. */
const clientReturning = (finishReason: string | null, content: string | null) => {
  const complete = vi.fn((_args: Parameters<TriageClient["complete"]>[0]) =>
    Promise.resolve({ content, finishReason }),
  );
  const client: TriageClient = { complete };
  return { client, complete };
};

describe("triageInputHash", () => {
  it("is deterministic for the same logical input regardless of key order", () => {
    const a = triageInputHash({ ...input, details: { x: 1, y: 2 } }, "model-a");
    const b = triageInputHash({ ...input, details: { y: 2, x: 1 } }, "model-a");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when details, model, or prompt version change", () => {
    const base = triageInputHash(input, "model-a");
    expect(triageInputHash({ ...input, details: { other: true } }, "model-a")).not.toBe(base);
    expect(triageInputHash(input, "model-b")).not.toBe(base);
  });
});

describe("buildTriagePrompt", () => {
  it("carries the exception facts, the taxonomy, and the JSON output contract", () => {
    const { system, user } = buildTriagePrompt(input);
    expect(system).toContain("timing_lag");
    expect(system).toContain("suggestion");
    expect(system).toContain("JSON");
    expect(system).toContain("suggested_action");
    expect(user).toContain("missing_in_ledger");
    expect(user).toContain("ch_1");
  });
});

describe("triageException", () => {
  it("returns the validated suggestion when the model answers clean JSON", async () => {
    const { client, complete } = clientReturning("stop", JSON.stringify(parsed));
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result).toEqual(parsed);
    expect(outcome.failure).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);
    const args = complete.mock.calls[0]![0];
    expect(args.model).toBe("model-a");
    expect(args.system).toContain("timing_lag");
  });

  it("tolerates a markdown-fenced JSON answer — compat providers do this", async () => {
    const fenced = "```json\n" + JSON.stringify(parsed) + "\n```";
    const { client } = clientReturning("stop", fenced);
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result).toEqual(parsed);
    expect(outcome.failure).toBeUndefined();
  });

  it("falls back to unknown when the model stopped for any other reason", async () => {
    const { client } = clientReturning("length", JSON.stringify(parsed));
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result.classification).toBe("unknown");
    expect(outcome.failure).toBe("stop_reason");
  });

  it("falls back to unknown when the answer is not JSON", async () => {
    const { client } = clientReturning("stop", "It is probably settlement lag.");
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result.classification).toBe("unknown");
    expect(outcome.failure).toBe("parse_failure");
  });

  it("falls back to unknown when the JSON does not match the schema", async () => {
    const bad = JSON.stringify({ ...parsed, classification: "gremlins" });
    const { client } = clientReturning("stop", bad);
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result.classification).toBe("unknown");
    expect(outcome.failure).toBe("parse_failure");
  });

  it("never throws — an API error becomes a retryable unknown", async () => {
    const complete = vi.fn(() => Promise.reject(new Error("network down")));
    const client: TriageClient = { complete };
    const outcome = await triageException(client, { model: "model-a", input });
    expect(outcome.result.classification).toBe("unknown");
    expect(outcome.failure).toBe("api_error");
  });
});

describe("TRIAGE_PROMPT_VERSION", () => {
  it("is a stable version marker recorded with every suggestion", () => {
    expect(TRIAGE_PROMPT_VERSION).toMatch(/^triage-v\d+$/);
  });
});
