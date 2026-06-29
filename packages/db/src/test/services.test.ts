import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LandedBatch, LandedRecord, SourceAdapter } from "@tieout/contracts";
import { eq, and, asc } from "drizzle-orm";
import {
  ingestionBatches,
  outbox,
  quarantinedRecords,
  rawRecords,
  reconRuns,
  sourceCursors,
  transactions,
} from "../schema.js";
import { advanceCursor } from "../services/cursors.js";
import { landBatch } from "../services/ingest.js";
import { normalizeBatch } from "../services/normalize.js";
import { markOutboxProcessed, unprocessedOutbox } from "../services/outbox.js";
import { loadTransactionsAsOf } from "../services/recon.js";
import { connectTestDb, truncateAll, type TestDb } from "./helpers.js";

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
        netMinor: BigInt(p.amountMinor),
        currency: "USD",
        occurredAt: new Date("2026-05-15T00:00:00Z"),
        valueDate: null,
        account: "main",
        reference: raw.sourceId,
        groupRef: null,
        status: "settled",
        metadata: {},
      },
    };
  },
};

describe("ingestion services", () => {
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

  it("renormalizing with a bumped version writes nothing when output is identical", async () => {
    const { db } = client;
    const { batchId } = await landBatch(
      db,
      batch("ledger:w1", [record("e1", { amountMinor: "1000" })]),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, batchId, NOW);

    const v2: SourceAdapter = { ...stubAdapter, normalizerVersion: "stub-v2" };
    const result = await normalizeBatch(db, v2, batchId, LATER);
    expect(result).toMatchObject({ normalized: 0, unchanged: 1, superseded: 0, quarantined: 0 });

    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      version: 1,
      isCurrent: true,
      normalizerVersion: "stub-v1",
      supersededAt: null,
    });
  });

  it("renormalizing with changed output supersedes with a new version", async () => {
    const { db } = client;
    const { batchId } = await landBatch(
      db,
      batch("ledger:w1", [record("e1", { amountMinor: "1000" })]),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, batchId, NOW);

    const v2Changed: SourceAdapter = {
      ...stubAdapter,
      normalizerVersion: "stub-v2",
      normalize: (raw) => {
        const r = stubAdapter.normalize(raw);
        return r.ok ? { ok: true, txn: { ...r.txn, amountMinor: r.txn.amountMinor * 2n } } : r;
      },
    };
    const result = await normalizeBatch(db, v2Changed, batchId, LATER);
    expect(result).toMatchObject({ normalized: 1, unchanged: 0, superseded: 1 });

    const versions = await db.select().from(transactions).orderBy(asc(transactions.version));
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, isCurrent: false, normalizerVersion: "stub-v1" });
    expect(versions[1]).toMatchObject({
      version: 2,
      isCurrent: true,
      amountMinor: 2000n,
      normalizerVersion: "stub-v2",
    });
  });

  it("a restated raw with identical canonical output still versions — the observation changed", async () => {
    const { db } = client;
    const w1 = await landBatch(
      db,
      batch("ledger:w1", [record("e1", { amountMinor: "1000" })]),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, w1.batchId, NOW);

    // Different payload bytes, same canonical output (the stub ignores `note`).
    const w2 = await landBatch(
      db,
      batch("ledger:w2", [record("e1", { amountMinor: "1000", note: "restated" })]),
      LATER,
    );
    const result = await normalizeBatch(db, stubAdapter, w2.batchId, LATER);
    expect(result).toMatchObject({ normalized: 1, superseded: 1, unchanged: 0 });
  });

  it("a restated complete unit tombstones identities that vanished — and only those", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    await landBatch(
      db,
      batch("ledger:v1", [record("e1", { amountMinor: "1000" }), record("e2", { amountMinor: "2000" })], {
        completeUnit: unit,
      }),
      NOW,
    );
    // The restated file no longer contains e2.
    const restated = await landBatch(
      db,
      batch("ledger:v2", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      LATER,
    );
    expect(restated).toMatchObject({ rawInserted: 0, rawSkipped: 1, tombstoned: 1 });

    const raws = await db
      .select()
      .from(rawRecords)
      .where(eq(rawRecords.sourceId, "e2"))
      .orderBy(asc(rawRecords.version));
    expect(raws).toHaveLength(2);
    expect(raws[1]).toMatchObject({ version: 2, isTombstone: true });
    expect(raws[1]!.payload).toMatchObject({ tombstone: true, unitKey: unit.key });

    // Re-landing the same restated unit converges: the tombstone is already latest.
    const again = await landBatch(
      db,
      batch("ledger:v2", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      LATER,
    );
    expect(again).toMatchObject({ batchExisted: true, tombstoned: 0 });
  });

  it("a tombstone raw becomes a tombstone transaction version superseding the live one", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const v1 = await landBatch(
      db,
      batch("ledger:v1", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, v1.batchId, NOW);

    const v2 = await landBatch(db, batch("ledger:v2", [], { completeUnit: unit }), LATER);
    expect(v2.tombstoned).toBe(1);
    const result = await normalizeBatch(db, stubAdapter, v2.batchId, LATER);
    expect(result).toMatchObject({ normalized: 0, tombstoned: 1, superseded: 1 });

    const versions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.sourceId, "e1"))
      .orderBy(asc(transactions.version));
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, isCurrent: false, isTombstone: false });
    expect(versions[1]).toMatchObject({
      version: 2,
      isCurrent: true,
      isTombstone: true,
      // The tombstone carries the predecessor's money facts forward.
      amountMinor: 1000n,
    });
  });

  it("re-executing a pre-tombstone watermark still sees the live version (D27 holds)", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const v1 = await landBatch(
      db,
      batch("ledger:v1", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, v1.batchId, NOW);
    const v2 = await landBatch(db, batch("ledger:v2", [], { completeUnit: unit }), LATER);
    await normalizeBatch(db, stubAdapter, v2.batchId, LATER);

    const atV1 = await loadTransactionsAsOf(db, NOW);
    expect(atV1).toHaveLength(1);
    expect(atV1[0]).toMatchObject({ version: 1, isTombstone: false });

    const atV2 = await loadTransactionsAsOf(db, LATER);
    expect(atV2).toHaveLength(1);
    expect(atV2[0]).toMatchObject({ version: 2, isTombstone: true });
  });

  it("a vanished identity that only ever quarantined has nothing to tombstone", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const v1 = await landBatch(
      db,
      batch("ledger:v1", [record("e_bad", { bad: true })], { completeUnit: unit }),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, v1.batchId, NOW);
    const v2 = await landBatch(db, batch("ledger:v2", [], { completeUnit: unit }), LATER);
    expect(v2.tombstoned).toBe(1); // the raw disappearance is still recorded
    const result = await normalizeBatch(db, stubAdapter, v2.batchId, LATER);
    expect(result).toMatchObject({ tombstoned: 0, normalized: 0 });
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("a later delivery resurrects a tombstoned identity as a normal new version", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const v1 = await landBatch(
      db,
      batch("ledger:v1", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, v1.batchId, NOW);
    const v2 = await landBatch(db, batch("ledger:v2", [], { completeUnit: unit }), LATER);
    await normalizeBatch(db, stubAdapter, v2.batchId, LATER);

    const EVEN_LATER = new Date("2026-06-03T00:00:00Z");
    const v3 = await landBatch(
      db,
      batch("ledger:v3", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      EVEN_LATER,
    );
    expect(v3).toMatchObject({ rawInserted: 1, tombstoned: 0 });
    const result = await normalizeBatch(db, stubAdapter, v3.batchId, EVEN_LATER);
    expect(result).toMatchObject({ normalized: 1, superseded: 1, tombstoned: 0 });

    const current = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.sourceId, "e1"), eq(transactions.isCurrent, true)));
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ version: 3, isTombstone: false, amountMinor: 1000n });
  });

  it("re-landing an older delivery of a complete unit is stale — it cannot resurrect removals (D8)", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const deliveryA = batch(
      "ledger:v1",
      [record("e1", { amountMinor: "1000" }), record("e2", { amountMinor: "2000" })],
      { completeUnit: unit },
    );
    await landBatch(db, deliveryA, NOW);
    // The restated file no longer contains e2.
    await landBatch(
      db,
      batch("ledger:v2", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      LATER,
    );

    // A pipeline re-run replays the pre-restatement delivery: history, not state.
    const EVEN_LATER = new Date("2026-06-03T00:00:00Z");
    const relanded = await landBatch(db, deliveryA, EVEN_LATER);
    expect(relanded).toMatchObject({
      batchExisted: true,
      staleUnit: true,
      rawInserted: 0,
      rawSkipped: 2,
      tombstoned: 0,
    });

    // No new raw versions, and e2's tombstone stays the latest word.
    expect(await db.select().from(rawRecords)).toHaveLength(3);
    const e2 = await db
      .select()
      .from(rawRecords)
      .where(eq(rawRecords.sourceId, "e2"))
      .orderBy(asc(rawRecords.version));
    expect(e2).toHaveLength(2);
    expect(e2[1]).toMatchObject({ version: 2, isTombstone: true });
  });

  it("a supersession writes exactly one outbox event, in the same transaction (D17)", async () => {
    const { db } = client;
    const w1 = await landBatch(db, batch("ledger:w1", [record("e1", { amountMinor: "1000" })]), NOW);
    await normalizeBatch(db, stubAdapter, w1.batchId, NOW);
    expect(await db.select().from(outbox)).toHaveLength(0); // first versions are not events

    const w2 = await landBatch(db, batch("ledger:w2", [record("e1", { amountMinor: "2000" })]), LATER);
    await normalizeBatch(db, stubAdapter, w2.batchId, LATER);

    const events = await db.select().from(outbox);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ topic: "transaction.superseded", processedAt: null });
    const versions = await db.select().from(transactions).orderBy(asc(transactions.version));
    expect(events[0]!.payload).toMatchObject({
      source: "ledger",
      sourceId: "e1",
      oldTransactionId: versions[0]!.id,
      oldVersion: 1,
      newTransactionId: versions[1]!.id,
      newVersion: 2,
    });

    // Idempotent: re-normalizing (everything processed) emits nothing new.
    await normalizeBatch(db, stubAdapter, w2.batchId, LATER);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("a tombstone writes a transaction.tombstoned event; an unchanged re-translation writes none", async () => {
    const { db } = client;
    const unit = { key: "ledger:entries.json" };
    const v1 = await landBatch(
      db,
      batch("ledger:v1", [record("e1", { amountMinor: "1000" })], { completeUnit: unit }),
      NOW,
    );
    await normalizeBatch(db, stubAdapter, v1.batchId, NOW);

    // D26 skip: bumped version, identical output — no event.
    const v2Same: SourceAdapter = { ...stubAdapter, normalizerVersion: "stub-v2" };
    await normalizeBatch(db, v2Same, v1.batchId, LATER);
    expect(await db.select().from(outbox)).toHaveLength(0);

    const v2 = await landBatch(db, batch("ledger:v2", [], { completeUnit: unit }), LATER);
    await normalizeBatch(db, stubAdapter, v2.batchId, LATER);
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ topic: "transaction.tombstoned" });
  });

  it("dispatching claims events once: the stamp is guarded against double-processing", async () => {
    const { db } = client;
    const w1 = await landBatch(db, batch("ledger:w1", [record("e1", { amountMinor: "1000" })]), NOW);
    await normalizeBatch(db, stubAdapter, w1.batchId, NOW);
    const w2 = await landBatch(db, batch("ledger:w2", [record("e1", { amountMinor: "2000" })]), LATER);
    await normalizeBatch(db, stubAdapter, w2.batchId, LATER);

    const claimed = await unprocessedOutbox(db);
    expect(claimed).toHaveLength(1);

    // A run id to stamp with — any run row works for the FK.
    const [run] = await db
      .insert(reconRuns)
      .values({ asOf: LATER, rulesetVersion: "ruleset-v2", status: "completed", stats: {}, startedAt: LATER })
      .returning({ id: reconRuns.id });

    expect(await markOutboxProcessed(db, claimed.map((e) => e.id), run!.id, LATER)).toBe(1);
    expect(await markOutboxProcessed(db, claimed.map((e) => e.id), run!.id, LATER)).toBe(0);
    expect(await unprocessedOutbox(db)).toHaveLength(0);

    const [event] = await db.select().from(outbox);
    expect(event).toMatchObject({ processedByRunId: run!.id });
    expect(event!.processedAt).not.toBeNull();
  });

  it("a batch declaring integrity failure quarantines whole: no raws, one batch-level row (D13)", async () => {
    const { db } = client;
    const result = await landBatch(
      db,
      batch("pagolat:bad", [record("l1", { x: 1 })], {
        source: "pagolat",
        integrityFailure: [{ path: "footer.total_net", message: "lines sum to 1 but file declares 2" }],
      }),
      NOW,
    );
    expect(result).toMatchObject({ batchQuarantined: true, rawInserted: 0, tombstoned: 0 });
    expect(await db.select().from(rawRecords)).toHaveLength(0);
    const quarantined = await db.select().from(quarantinedRecords);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ stage: "batch", source: "pagolat", rawId: null });

    // Re-landing the same lying unit converges without duplicating the quarantine row.
    const again = await landBatch(
      db,
      batch("pagolat:bad", [record("l1", { x: 1 })], {
        source: "pagolat",
        integrityFailure: [{ path: "footer.total_net", message: "lines sum to 1 but file declares 2" }],
      }),
      LATER,
    );
    expect(again).toMatchObject({ batchExisted: true, batchQuarantined: true });
    expect(await db.select().from(quarantinedRecords)).toHaveLength(1);
  });

  it("the circuit breaker halts a batch that quarantines past the threshold (D14)", async () => {
    const { db } = client;
    const { batchId } = await landBatch(
      db,
      batch("ledger:w1", [
        record("e1", { bad: true }),
        record("e2", { bad: true }),
        record("e3", { bad: true }),
        record("e4", { amountMinor: "1000" }),
      ]),
      NOW,
    );
    const result = await normalizeBatch(db, stubAdapter, batchId, NOW);
    // The parseable remainder is collateral — quarantined with an explicit reason.
    expect(result).toMatchObject({ normalized: 0, quarantined: 4 });
    expect(await db.select().from(transactions)).toHaveLength(0);
    const collateral = await db
      .select()
      .from(quarantinedRecords)
      .where(eq(quarantinedRecords.sourceId, "e4"));
    expect(collateral[0]!.errors).toEqual([
      { path: "batch", message: "not processed: batch halted by the quarantine-rate circuit breaker" },
    ]);
    const [batchRow] = await db.select().from(ingestionBatches);
    expect(batchRow!.status).toBe("halted");

    // Re-running changes nothing and the halt stays visible.
    const again = await normalizeBatch(db, stubAdapter, batchId, LATER);
    expect(again).toMatchObject({ normalized: 0, quarantined: 0, skipped: 4 });
    expect((await db.select().from(ingestionBatches))[0]!.status).toBe("halted");
  });

  it("cursors only move forward", async () => {
    const { db } = client;
    await advanceCursor(db, "stripe", "acct_main", LATER, NOW);
    await advanceCursor(db, "stripe", "acct_main", NOW, LATER); // older watermark
    const [cursor] = await db.select().from(sourceCursors);
    expect(cursor!.watermark).toEqual(LATER);
  });
});
