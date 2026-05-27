import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LandedBatch, LandedRecord, SourceAdapter } from "@tieout/contracts";
import { eq, and, asc } from "drizzle-orm";
import type { DbClient } from "../client.js";
import { quarantinedRecords, rawRecords, sourceCursors, transactions } from "../schema.js";
import { advanceCursor } from "../services/cursors.js";
import { landBatch } from "../services/ingest.js";
import { normalizeBatch } from "../services/normalize.js";
import { connectMigrated, hasDatabase, truncateAll } from "./helpers.js";

const NOW = new Date("2026-06-01T00:00:00Z");
const LATER = new Date("2026-06-02T00:00:00Z");

const record = (sourceId: string, payload: unknown): LandedRecord => ({
  sourceAccount: "acct_main",
  sourceId,
  payload,
});

const batch = (
  idempotencyKey: string,
  records: LandedRecord[],
  over: Partial<LandedBatch> = {},
): LandedBatch => ({
  source: "ledger",
  connection: "test",
  kind: "seed",
  externalRef: "unit-test",
  idempotencyKey,
  records,
  ...over,
});

/** Pure stub — exactly the SourceAdapter contract, no real source needed. */
const stubAdapter: SourceAdapter = {
  source: "ledger",
  normalizerVersion: "stub-v1",
  land: () => Promise.resolve([]),
  normalize: (raw) => {
    const p = raw.payload as { amountMinor?: string; bad?: boolean };
    if (p.bad || p.amountMinor === undefined) {
      return { ok: false, errors: [{ path: "amountMinor", message: "malformed fixture" }] };
    }
    return {
      ok: true,
      txn: {
        source: raw.source,
        sourceAccount: raw.sourceAccount,
        sourceId: raw.sourceId,
        sourceType: "payment",
        type: "payment",
        amountMinor: BigInt(p.amountMinor),
        currency: "USD",
        occurredAt: new Date("2026-05-15T00:00:00Z"),
        valueDate: null,
        account: "main",
        reference: raw.sourceId,
        status: "settled",
        metadata: {},
      },
    };
  },
};

describe.skipIf(!hasDatabase)("ingestion services", () => {
  let client: DbClient;

  beforeAll(async () => {
    client = await connectMigrated();
  });
  afterAll(async () => {
    await client.sql.end();
  });
  beforeEach(async () => {
    await truncateAll(client.db);
  });

  it("re-landing the same batch creates zero duplicate raw rows", async () => {
    const { db } = client;
    const b = batch("ledger:w1", [record("e1", { amount: "10.00" }), record("e2", { amount: "20.00" })]);
    const first = await landBatch(db, b, NOW);
    expect(first).toMatchObject({ batchExisted: false, rawInserted: 2, rawSkipped: 0 });

    const second = await landBatch(db, b, LATER);
    expect(second).toMatchObject({ batchExisted: true, batchId: first.batchId, rawInserted: 0, rawSkipped: 2 });

    const raws = await db.select().from(rawRecords);
    expect(raws).toHaveLength(2);
    expect(raws.every((r) => r.version === 1)).toBe(true);
  });

  it("a land killed mid-run converges on retry", async () => {
    const { db } = client;
    const records = [record("e1", { a: 1 }), record("e2", { a: 2 }), record("e3", { a: 3 })];
    // Simulate the crash: only part of the unit of work landed.
    await landBatch(db, batch("ledger:w1", records.slice(0, 1)), NOW);
    const retry = await landBatch(db, batch("ledger:w1", records), LATER);
    expect(retry).toMatchObject({ batchExisted: true, rawInserted: 2, rawSkipped: 1 });

    const raws = await db.select().from(rawRecords);
    expect(raws.map((r) => r.sourceId).sort()).toEqual(["e1", "e2", "e3"]);
    expect(raws.every((r) => r.version === 1)).toBe(true);
  });

  it("changed payloads become version n+1, never an overwrite", async () => {
    const { db } = client;
    await landBatch(db, batch("ledger:w1", [record("e1", { amount: "10.00" })]), NOW);
    const result = await landBatch(db, batch("ledger:w2", [record("e1", { amount: "12.00" })]), LATER);
    expect(result).toMatchObject({ batchExisted: false, rawInserted: 1 });

    const raws = await db
      .select()
      .from(rawRecords)
      .where(eq(rawRecords.sourceId, "e1"))
      .orderBy(asc(rawRecords.version));
    expect(raws.map((r) => r.version)).toEqual([1, 2]);
    expect(raws[0]!.payload).toEqual({ amount: "10.00" });
    expect(raws[1]!.payload).toEqual({ amount: "12.00" });
  });

  it("normalize is idempotent and quarantines instead of guessing", async () => {
    const { db } = client;
    const { batchId } = await landBatch(
      db,
      batch("ledger:w1", [record("e1", { amountMinor: "1000" }), record("e2", { bad: true })]),
      NOW,
    );

    const first = await normalizeBatch(db, stubAdapter, batchId, NOW);
    expect(first).toMatchObject({ normalized: 1, quarantined: 1, skipped: 0 });

    const again = await normalizeBatch(db, stubAdapter, batchId, LATER);
    expect(again).toMatchObject({ normalized: 0, quarantined: 0, skipped: 2 });

    expect(await db.select().from(transactions)).toHaveLength(1);
    const quarantined = await db.select().from(quarantinedRecords);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.errors).toEqual([{ path: "amountMinor", message: "malformed fixture" }]);
  });

  it("a restated record supersedes: new version current, old flipped — never deleted", async () => {
    const { db } = client;
    const w1 = await landBatch(db, batch("ledger:w1", [record("e1", { amountMinor: "1000" })]), NOW);
    await normalizeBatch(db, stubAdapter, w1.batchId, NOW);

    const w2 = await landBatch(db, batch("ledger:w2", [record("e1", { amountMinor: "2000" })]), LATER);
    const result = await normalizeBatch(db, stubAdapter, w2.batchId, LATER);
    expect(result).toMatchObject({ normalized: 1, superseded: 1 });

    const versions = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.source, "ledger"), eq(transactions.sourceId, "e1")))
      .orderBy(asc(transactions.version));
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, isCurrent: false, amountMinor: 1000n });
    expect(versions[0]!.supersededAt).not.toBeNull();
    expect(versions[1]).toMatchObject({ version: 2, isCurrent: true, amountMinor: 2000n, supersededAt: null });
  });

  it("cursors only move forward", async () => {
    const { db } = client;
    await advanceCursor(db, "stripe", "acct_main", LATER, NOW);
    await advanceCursor(db, "stripe", "acct_main", NOW, LATER); // older watermark
    const [cursor] = await db.select().from(sourceCursors);
    expect(cursor!.watermark).toEqual(LATER);
  });
});
