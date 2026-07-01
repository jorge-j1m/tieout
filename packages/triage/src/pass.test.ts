import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { TriageResult } from "@tieout/contracts";
import { breaks, exceptions, reconRuns, triageSuggestions, type Db } from "@tieout/db";
import { connectTestDb, truncateAll, type TestDb } from "@tieout/db/testing";
import { runTriagePass } from "./pass.js";
import type { TriageClient } from "./triage.js";

const NOW = new Date("2026-07-01T00:00:00Z");

const answer: TriageResult = {
  classification: "timing_lag",
  confidence: "high",
  explanation: "The charge settled after the ledger cutoff.",
  suggested_action: "Wait for the next ledger export.",
};

const clientAnswering = (result: TriageResult | Error) => {
  const complete = vi.fn(() =>
    result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve({ content: JSON.stringify(result), finishReason: "stop" }),
  );
  const client: TriageClient = { complete };
  return { client, complete };
};

/** One open exception over one break — the minimal triage-able worklist row. */
async function seedException(
  db: Db,
  fingerprint: string,
  details: unknown = { txns: [{ sourceId: "ch_1" }] },
): Promise<{ exceptionId: string; breakId: string }> {
  const [run] = await db
    .insert(reconRuns)
    .values({
      asOf: NOW,
      rulesetVersion: "test-v1",
      status: "completed",
      stats: {},
      startedAt: NOW,
      finishedAt: NOW,
    })
    .returning({ id: reconRuns.id });
  const [brk] = await db
    .insert(breaks)
    .values({ runId: run!.id, type: "missing_in_ledger", details, fingerprint })
    .returning({ id: breaks.id });
  const [exc] = await db
    .insert(exceptions)
    .values({
      fingerprint,
      type: "missing_in_ledger",
      status: "open",
      firstSeenRunId: run!.id,
      lastSeenRunId: run!.id,
      currentBreakId: brk!.id,
      updatedAt: NOW,
    })
    .returning({ id: exceptions.id });
  return { exceptionId: exc!.id, breakId: brk!.id };
}

describe("runTriagePass", () => {
  let client: TestDb;

  beforeAll(async () => {
    client = await connectTestDb();
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAll(client.db);
  });

  it("records one suggestion per open exception, stamped with model and prompt version", async () => {
    const { exceptionId, breakId } = await seedException(client.db, "fp-1");
    const { client: llm, complete } = clientAnswering(answer);

    const summary = await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });

    expect(summary).toMatchObject({ candidates: 1, cached: 0, called: 1, recorded: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    const rows = await client.db
      .select()
      .from(triageSuggestions)
      .where(eq(triageSuggestions.exceptionId, exceptionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      breakId,
      model: "model-a",
      classification: "timing_lag",
      confidence: "high",
      explanation: answer.explanation,
      suggestedAction: answer.suggested_action,
    });
    expect(rows[0]!.promptVersion).toMatch(/^triage-v\d+$/);
  });

  it("is idempotent: a second pass over unchanged breaks makes zero LLM calls", async () => {
    await seedException(client.db, "fp-1");
    const { client: llm, complete } = clientAnswering(answer);

    await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });
    const second = await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ candidates: 1, cached: 1, called: 0, recorded: 0 });
    expect(await client.db.select().from(triageSuggestions)).toHaveLength(1);
  });

  it("caps LLM calls per pass — the spend budget", async () => {
    await seedException(client.db, "fp-1");
    await seedException(client.db, "fp-2");
    await seedException(client.db, "fp-3");
    const { client: llm, complete } = clientAnswering(answer);

    const summary = await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 2 });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ candidates: 3, called: 2, recorded: 2 });
  });

  it("does not record transient API failures, so the next pass retries them", async () => {
    await seedException(client.db, "fp-1");
    const { client: failing } = clientAnswering(new Error("network down"));

    const summary = await runTriagePass(client.db, failing, { model: "model-a", maxCalls: 10 });

    expect(summary).toMatchObject({ called: 1, recorded: 0, transientFailures: 1 });
    expect(await client.db.select().from(triageSuggestions)).toHaveLength(0);

    const { client: llm, complete } = clientAnswering(answer);
    const retry = await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(retry).toMatchObject({ called: 1, recorded: 1 });
  });

  it("re-triages the same fingerprint when the break content changed (restatement)", async () => {
    await seedException(client.db, "fp-1", { txns: [{ sourceId: "ch_1", amountMinor: "100" }] });
    const { client: llm } = clientAnswering(answer);
    await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });

    // The same logical exception recurs with restated details: new break row, re-pointed exception.
    const [exc] = await client.db.select().from(exceptions).orderBy(asc(exceptions.fingerprint));
    const [run] = await client.db.select().from(reconRuns);
    const [newBreak] = await client.db
      .insert(breaks)
      .values({
        runId: run!.id,
        type: "missing_in_ledger",
        details: { txns: [{ sourceId: "ch_1", amountMinor: "250" }] },
        fingerprint: "fp-1-restated",
      })
      .returning({ id: breaks.id });
    await client.db
      .update(exceptions)
      .set({ currentBreakId: newBreak!.id })
      .where(eq(exceptions.id, exc!.id));

    const { client: llm2, complete } = clientAnswering(answer);
    const summary = await runTriagePass(client.db, llm2, { model: "model-a", maxCalls: 10 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ called: 1, recorded: 1 });
  });

  it("ignores resolved exceptions — closed cases are not billed against the budget", async () => {
    const { exceptionId } = await seedException(client.db, "fp-1");
    await client.db
      .update(exceptions)
      .set({ status: "resolved" })
      .where(eq(exceptions.id, exceptionId));
    const { client: llm, complete } = clientAnswering(answer);

    const summary = await runTriagePass(client.db, llm, { model: "model-a", maxCalls: 10 });

    expect(complete).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ candidates: 0, called: 0 });
  });
});
