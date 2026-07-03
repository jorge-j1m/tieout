import "../env.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  breaks,
  exceptions,
  ingestionBatches,
  matches,
  matchMembers,
  quarantinedRecords,
  rawRecords,
  reconRuns,
  syncExceptionsForRun,
  transactions,
  triageSuggestions,
} from "@tieout/db";
import { connectTestDb, truncateAll, type TestDb } from "@tieout/db/testing";
import { createApp } from "../app.js";
import { parseOperatorTokens } from "../auth.js";

const T0 = new Date("2026-06-01T00:00:00Z");
const T1 = new Date("2026-06-02T00:00:00Z");
const T2 = new Date("2026-06-03T00:00:00Z");

const OPERATOR = { authorization: "Bearer supersecret" };
const post = (path: string, body?: unknown, headers?: Record<string, string>) =>
  new Request(`http://api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });

describe("api: demo persona reads, operators mutate exceptions", () => {
  let client: TestDb;
  let app: ReturnType<typeof createApp>;
  let run1: string;
  let run2: string;
  let run3: string;
  let openExceptionId: string;
  let currentTxnId: string;
  let rawId: string;

  beforeAll(async () => {
    client = await connectTestDb();
    const db = client.db;
    await truncateAll(db);
    app = createApp({ db, operatorTokens: parseOperatorTokens("ana:supersecret") });

    const insertRun = async (at: Date) => {
      const [run] = await db
        .insert(reconRuns)
        .values({
          asOf: at,
          rulesetVersion: "ruleset-v2",
          status: "completed",
          stats: {},
          startedAt: at,
          finishedAt: at,
        })
        .returning({ id: reconRuns.id });
      return run!.id;
    };
    const insertBreak = async (runId: string, fingerprint: string) => {
      await db.insert(breaks).values({
        runId,
        type: "missing_in_ledger",
        details: { txns: [{ sourceId: "txn_x" }] },
        fingerprint,
      });
    };

    // Run 1 opens fp_a; run 2 (break gone) self-resolves it; run 3 opens fp_b.
    run1 = await insertRun(T0);
    await insertBreak(run1, "fp_a");
    await syncExceptionsForRun(db, run1, T0);
    run2 = await insertRun(T1);
    await syncExceptionsForRun(db, run2, T1);
    run3 = await insertRun(T2);
    await insertBreak(run3, "fp_b");
    await syncExceptionsForRun(db, run3, T2);
    const openRows = await db.select().from(exceptions);
    openExceptionId = openRows.find((e) => e.fingerprint === "fp_b")!.id;

    // One identity with two transaction versions, for the version-chain read.
    const [batch] = await db
      .insert(ingestionBatches)
      .values({
        source: "ledger",
        connection: "seed",
        kind: "seed",
        externalRef: "api-test",
        idempotencyKey: "api-test:batch",
        contentHash: "batch-hash",
        observedAt: T0,
      })
      .returning({ id: ingestionBatches.id });
    const raws = await db
      .insert(rawRecords)
      .values(
        [1, 2].map((version) => ({
          batchId: batch!.id,
          source: "ledger",
          sourceAccount: "acct_main",
          sourceId: "LED-1",
          version,
          contentHash: `content-${version}`,
          payload: { entryId: "LED-1", amount: version === 1 ? "49.00" : "48.90" },
          observedAt: version === 1 ? T0 : T1,
        })),
      )
      .returning({ id: rawRecords.id, version: rawRecords.version });
    rawId = raws.find((r) => r.version === 1)!.id;
    const txnBase = {
      source: "ledger",
      sourceAccount: "acct_main",
      sourceId: "LED-1",
      sourceType: "payment",
      type: "payment",
      currency: "USD",
      occurredAt: T0,
      account: "acct_main",
      status: "settled",
      normalizerVersion: "ledger-v1",
      metadata: {},
    } as const;
    const txns = await db
      .insert(transactions)
      .values([
        {
          ...txnBase,
          rawId,
          version: 1,
          isCurrent: false,
          supersededAt: T1,
          amountMinor: 4900n,
          netMinor: 4900n,
          observedAt: T0,
          createdAt: T0,
        },
        {
          ...txnBase,
          rawId: raws.find((r) => r.version === 2)!.id,
          version: 2,
          isCurrent: true,
          amountMinor: 4890n,
          netMinor: 4890n,
          observedAt: T1,
          createdAt: T1,
        },
      ])
      .returning({ id: transactions.id, version: transactions.version });
    currentTxnId = txns.find((t) => t.version === 2)!.id;

    await db.insert(quarantinedRecords).values({
      batchId: batch!.id,
      stage: "batch",
      source: "pagolat",
      errors: [{ path: "footer", message: "control totals do not tie" }],
      observedAt: T0,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("serves runs to the unauthenticated demo persona, newest first", async () => {
    const res = await app.request("/runs");
    expect(res.status).toBe(200);
    const runs = (await res.json()) as { id: string }[];
    expect(runs.map((r) => r.id)).toEqual([run3, run2, run1]);

    const detail = await app.request(`/runs/${run1}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { rulesetVersion: string }).rulesetVersion).toBe("ruleset-v2");
  });

  it("404s unknown and malformed ids without leaking errors", async () => {
    expect((await app.request(`/runs/${randomUUID()}`)).status).toBe(404);
    expect((await app.request("/runs/not-a-uuid")).status).toBe(404);
    expect((await app.request(`/transactions/${randomUUID()}`)).status).toBe(404);
    expect((await app.request(`/exceptions/${randomUUID()}`)).status).toBe(404);
  });

  it("filters a run's breaks by type", async () => {
    const all = await app.request(`/runs/${run1}/breaks`);
    expect(((await all.json()) as unknown[]).length).toBe(1);
    const none = await app.request(`/runs/${run1}/breaks?type=fx_drift`);
    expect(((await none.json()) as unknown[]).length).toBe(0);
    const bad = await app.request(`/runs/${run1}/breaks?type=nonsense`);
    expect(bad.status).toBe(400);
  });

  it("diffs a run from the persisted exception lifecycle (appeared / self-resolved)", async () => {
    const diff1 = (await (await app.request(`/runs/${run1}/diff`)).json()) as {
      appeared: { fingerprint: string }[];
      selfResolved: unknown[];
    };
    expect(diff1.appeared.map((e) => e.fingerprint)).toEqual(["fp_a"]);
    expect(diff1.selfResolved).toEqual([]);

    const diff2 = (await (await app.request(`/runs/${run2}/diff`)).json()) as {
      appeared: unknown[];
      selfResolved: { fingerprint: string }[];
    };
    expect(diff2.appeared).toEqual([]);
    expect(diff2.selfResolved.map((e) => e.fingerprint)).toEqual(["fp_a"]);
  });

  it("returns a transaction with its full version chain, money as strings", async () => {
    const res = await app.request(`/transactions/${currentTxnId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      amountMinor: string;
      versions: { version: number; amountMinor: string; isCurrent: boolean; rawId: string }[];
    };
    expect(body.amountMinor).toBe("4890");
    expect(body.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(body.versions[0]).toMatchObject({ amountMinor: "4900", isCurrent: false });
  });

  it("drills from a raw record down to its batch", async () => {
    const res = await app.request(`/raw/${rawId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payload: { amount: string }; batch: { id: string } };
    expect(body.payload.amount).toBe("49.00");
    expect(body.batch.id).toBeDefined();
  });

  it("lists quarantine for the demo persona", async () => {
    const rows = (await (await app.request("/quarantine")).json()) as { stage: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe("batch");
  });

  it("rejects every mutation from the demo persona — no token, bad token", async () => {
    for (const headers of [undefined, { authorization: "Bearer wrong" }] as const) {
      const ack = await app.request(post(`/exceptions/${openExceptionId}/acknowledge`, {}, headers));
      expect(ack.status).toBe(401);
      const res = await app.request(
        post(`/exceptions/${openExceptionId}/resolve`, { reason: "x" }, headers),
      );
      expect(res.status).toBe(401);
    }
    const worklist = (await (await app.request("/exceptions?status=open")).json()) as unknown[];
    expect(worklist).toHaveLength(1); // nothing moved
  });

  it("walks an operator through acknowledge → resolve with an append-only trail", async () => {
    const noReason = await app.request(post(`/exceptions/${openExceptionId}/resolve`, {}, OPERATOR));
    expect(noReason.status).toBe(400);

    const ack = await app.request(
      post(`/exceptions/${openExceptionId}/acknowledge`, { note: "looking into it" }, OPERATOR),
    );
    expect(ack.status).toBe(200);
    expect(((await ack.json()) as { status: string }).status).toBe("acknowledged");

    const resolved = await app.request(
      post(`/exceptions/${openExceptionId}/resolve`, { reason: "fee booked manually" }, OPERATOR),
    );
    expect(resolved.status).toBe(200);
    expect(((await resolved.json()) as { status: string }).status).toBe("resolved");

    const again = await app.request(
      post(`/exceptions/${openExceptionId}/resolve`, { reason: "twice" }, OPERATOR),
    );
    expect(again.status).toBe(409);

    const detail = (await (await app.request(`/exceptions/${openExceptionId}`)).json()) as {
      events: { kind: string; actor: string; note: string | null }[];
      currentBreak: { fingerprint: string };
    };
    expect(detail.events.map((e) => e.kind)).toEqual(["opened", "acknowledged", "resolved"]);
    expect(detail.events.at(-1)).toMatchObject({ actor: "ana", note: "fee booked manually" });
    expect(detail.currentBreak.fingerprint).toBe("fp_b");
  });

  it("attaches triage suggestions to the exception detail — read-only annotations (D33)", async () => {
    const db = client.db;
    const [exc] = await db.select().from(exceptions).where(eq(exceptions.id, openExceptionId));
    await db.insert(triageSuggestions).values({
      exceptionId: openExceptionId,
      breakId: exc!.currentBreakId,
      inputHash: "api-test-hash",
      model: "claude-opus-4-8",
      promptVersion: "triage-v1",
      classification: "timing_lag",
      confidence: "high",
      explanation: "The counterpart likely settles after the ledger cutoff.",
      suggestedAction: "Re-check after the next ledger export.",
    });

    const detail = (await (await app.request(`/exceptions/${openExceptionId}`)).json()) as {
      triageSuggestions: {
        model: string;
        classification: string;
        confidence: string;
        explanation: string;
        suggestedAction: string;
        promptVersion: string;
      }[];
    };
    expect(detail.triageSuggestions).toHaveLength(1);
    expect(detail.triageSuggestions[0]).toMatchObject({
      model: "claude-opus-4-8",
      classification: "timing_lag",
      confidence: "high",
      suggestedAction: "Re-check after the next ledger export.",
    });
  });

  // ── Stage-3 web read endpoints ──────────────────────────────────────────────

  it("GET /me resolves both personas", async () => {
    expect(await (await app.request("/me")).json()).toEqual({ operator: null });
    const asOperator = await app.request("/me", { headers: OPERATOR });
    expect(await asOperator.json()).toEqual({ operator: "ana" });
  });

  it("GET /breaks/:id returns one break with its details; 404s the unknown", async () => {
    const [aBreak] = await client.db.select().from(breaks).where(eq(breaks.runId, run1));
    const res = await app.request(`/breaks/${aBreak!.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; details: { txns: unknown[] } };
    expect(body.id).toBe(aBreak!.id);
    expect(Array.isArray(body.details.txns)).toBe(true);
    expect((await app.request(`/breaks/${randomUUID()}`)).status).toBe(404);
    expect((await app.request("/breaks/not-a-uuid")).status).toBe(404);
  });

  it("GET /runs/:id/matches groups members under each match", async () => {
    const [match] = await client.db
      .insert(matches)
      .values({ runId: run1, rulesetVersion: "ruleset-v2", kind: "exact_reference", details: { reference: "ch_x" } })
      .returning({ id: matches.id });
    await client.db
      .insert(matchMembers)
      .values({ matchId: match!.id, runId: run1, transactionId: currentTxnId, transactionVersion: 2 });

    const res = await app.request(`/runs/${run1}/matches`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      members: { transactionId: string; transactionVersion: number }[];
    }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.kind).toBe("exact_reference");
    expect(body[0]!.members).toEqual([{ transactionId: currentTxnId, transactionVersion: 2 }]);
    expect((await app.request(`/runs/${randomUUID()}/matches`)).status).toBe(404);
  });

  it("GET /sources summarizes records, batches, and quarantined units per source", async () => {
    const rows = (await (await app.request("/sources")).json()) as {
      source: string;
      records: number;
      batches: number;
      quarantinedUnits: number;
      lastLanded: string | null;
    }[];
    const ledger = rows.find((r) => r.source === "ledger")!;
    expect(ledger).toMatchObject({ records: 2, batches: 1, quarantinedUnits: 0 });
    expect(ledger.lastLanded).not.toBeNull();
    expect(rows.find((r) => r.source === "pagolat")!.quarantinedUnits).toBe(1);
  });

  it("computes seenInRuns on the worklist and the detail", async () => {
    // No status filter: earlier tests already walked this exception to `resolved`.
    const list = (await (await app.request("/exceptions")).json()) as {
      id: string;
      seenInRuns: number;
    }[];
    const open = list.find((e) => e.id === openExceptionId)!;
    expect(open.seenInRuns).toBe(1);
    const detail = (await (await app.request(`/exceptions/${openExceptionId}`)).json()) as {
      seenInRuns: number;
    };
    expect(detail.seenInRuns).toBe(1);
  });
});
