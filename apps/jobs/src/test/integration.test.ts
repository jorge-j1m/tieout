import "../env.js";
import { readFileSync } from "node:fs";
import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BreakTxnDetail } from "@tieout/core";
import { LEDGER_SOURCE } from "@tieout/adapters";
import {
  breaks,
  landBatch,
  matchMembers,
  matches,
  normalizeBatch,
  quarantinedRecords,
  rawRecords,
  transactions,
} from "@tieout/db";
import { connectTestDb, type TestDb } from "@tieout/db/testing";
import { loadSeedFxRates, loadSeedManifest, seedFiles, type SeedLedgerEntry } from "@tieout/seed";
import { createSeedAdapters } from "../pipeline/adapters.js";
import { fullRecon, runRecon, type FullReconResult } from "../pipeline/pipeline.js";

/** Order-independent fingerprints of a run's matches and breaks, for run-vs-run comparison. */
async function runFingerprint(client: TestDb, runId: string) {
  const memberRows = await client.db
    .select({
      matchId: matchMembers.matchId,
      kind: matches.kind,
      sourceId: transactions.sourceId,
      version: matchMembers.transactionVersion,
    })
    .from(matchMembers)
    .innerJoin(matches, eq(matchMembers.matchId, matches.id))
    .innerJoin(transactions, eq(matchMembers.transactionId, transactions.id))
    .where(eq(matches.runId, runId));
  const byMatch = new Map<string, { kind: string; members: string[] }>();
  for (const row of memberRows) {
    const entry = byMatch.get(row.matchId) ?? { kind: row.kind, members: [] };
    entry.members.push(`${row.sourceId}@v${row.version}`);
    byMatch.set(row.matchId, entry);
  }
  const matchSigs = [...byMatch.values()]
    .map((m) => `${m.kind}:${m.members.sort().join("+")}`)
    .sort();

  const breakRows = await client.db.select().from(breaks).where(eq(breaks.runId, runId));
  const breakSigs = breakRows
    .map((b) => {
      const txns = (b.details as { txns: BreakTxnDetail[] }).txns;
      return `${b.type}:${txns.map((t) => `${t.sourceId}@v${t.version}`).sort().join("+")}`;
    })
    .sort();

  return { matchSigs, breakSigs };
}

describe("Stage 1 acceptance: full pipeline over the seed dataset", () => {
  let client: TestDb;
  let first: FullReconResult;
  let second: FullReconResult;

  beforeAll(async () => {
    client = await connectTestDb();
    await client.db.execute(dsql`
      TRUNCATE TABLE exception_events, exceptions, outbox, fx_rates,
        match_members, matches, breaks, recon_runs,
        quarantined_records, transactions, raw_records, ingestion_batches, source_cursors
      CASCADE
    `);
    first = await fullRecon(client.db, createSeedAdapters(), {
      now: new Date("2026-06-05T00:00:00Z"),
      fxRates: loadSeedFxRates(),
    });
    second = await fullRecon(client.db, createSeedAdapters(), {
      now: new Date("2026-06-06T00:00:00Z"),
      fxRates: loadSeedFxRates(),
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("finds exactly the planted breaks — no more, no fewer", async () => {
    const { plantedBreaks } = loadSeedManifest();
    const breakRows = await client.db
      .select()
      .from(breaks)
      .where(eq(breaks.runId, first.summary.runId));
    expect(breakRows).toHaveLength(plantedBreaks.length);
    for (const planted of plantedBreaks) {
      const found = breakRows.find(
        (b) =>
          b.type === planted.breakType &&
          (b.details as { txns: BreakTxnDetail[] }).txns.some(
            (t) => t.sourceId === planted.sourceId,
          ),
      );
      expect(found, `${planted.id}: ${planted.reason}`).toBeDefined();
    }
  });

  it("matches everything the manifest promises; only the lying day-file quarantines", async () => {
    const { expected } = loadSeedManifest();
    const quarantined = await client.db.select().from(quarantinedRecords);
    // One batch-level row for the control-total failure (D13); zero line-level.
    expect(quarantined).toHaveLength(expected.quarantinedBatches);
    expect(quarantined.every((q) => q.stage === "batch")).toBe(true);

    expect(first.summary.matches).toBe(expected.matches.total);
    expect(first.summary.matchedTransactions).toBe(expected.matchedTransactions);
    expect(first.summary.totalBreaks).toBe(expected.totalBreaks);
    expect(first.summary.breaks).toMatchObject(expected.breaksByType);
    expect(first.summary.pendingBySource).toEqual({});

    const kindRows = await client.db
      .select({ kind: matches.kind })
      .from(matches)
      .where(eq(matches.runId, first.summary.runId));
    const byKind: Record<string, number> = {};
    for (const row of kindRows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    expect(byKind).toEqual({
      exact_reference: expected.matches.exact_reference,
      amount_date_window: expected.matches.amount_date_window,
      grouped_reference: expected.matches.grouped_reference,
    });
  });

  it("re-running ingestion creates zero duplicate raw or transaction rows", async () => {
    for (const results of Object.values(second.landed)) {
      for (const r of results) {
        expect(r.batchExisted).toBe(true);
        expect(r.rawInserted).toBe(0);
        expect(r.tombstoned).toBe(0);
      }
    }
    for (const results of Object.values(second.normalized)) {
      for (const r of results) {
        expect(r.normalized).toBe(0);
        expect(r.quarantined).toBe(0);
        expect(r.tombstoned).toBe(0);
      }
    }
    const { expected } = loadSeedManifest();
    const rawCount = await client.db.select().from(rawRecords);
    const txnCount = await client.db.select().from(transactions);
    expect(rawCount).toHaveLength(
      expected.ledgerRecords + expected.stripeRecords + expected.pagolatRecords,
    );
    expect(txnCount).toHaveLength(expected.transactions);
    expect(txnCount.filter((t) => t.isCurrent)).toHaveLength(expected.currentTransactions);
    expect(txnCount.filter((t) => t.isTombstone)).toHaveLength(expected.tombstonedTransactions);
  });

  it("the restated day-file tombstoned exactly the line PagoLat removed", async () => {
    const tombstones = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.isTombstone, true));
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({
      source: "pagolat",
      isCurrent: true,
      groupRef: "PL-mx-merchant-014-2026-05-25",
    });
    // Its live predecessor is superseded, never deleted.
    const versions = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.sourceId, tombstones[0]!.sourceId));
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => !v.isTombstone)).toMatchObject({ isCurrent: false, version: 1 });
  });

  it("settlement lag suppresses in-window breaks as pending — same data, different config", async () => {
    // txn_cl_d2 (2026-05-23) sits ~12.6 days before the watermark: a 14-day
    // stripe lag window makes it pending instead of missing_in_ledger.
    const lagged = await runRecon(client.db, {
      now: new Date("2026-06-09T00:00:00Z"),
      asOf: new Date(first.summary.asOf),
      lagMsBySource: { stripe: 14 * 86_400_000 },
    });
    expect(lagged.pendingBySource).toEqual({ stripe: 1 });
    expect(lagged.breaks.missing_in_ledger).toBe(first.summary.breaks.missing_in_ledger - 1);
    expect(lagged.totalBreaks).toBe(first.summary.totalBreaks - 1);
  });

  it("running recon twice produces identical results", async () => {
    expect(second.summary.runId).not.toBe(first.summary.runId);
    expect(second.summary.asOf).toBe(first.summary.asOf);
    expect(second.summary.matches).toBe(first.summary.matches);
    expect(second.summary.breaks).toEqual(first.summary.breaks);
    const a = await runFingerprint(client, first.summary.runId);
    const b = await runFingerprint(client, second.summary.runId);
    expect(b).toEqual(a);
  });

  it("a past run re-executes identically after a restatement — the audit claim, tested", async () => {
    const originalFingerprint = await runFingerprint(client, first.summary.runId);

    // Restate one ledger entry ($49.00 → $48.90), as a re-issued export would.
    const entries = JSON.parse(
      readFileSync(seedFiles.ledgerEntries, "utf8"),
    ) as SeedLedgerEntry[];
    const entry = entries.find((e) => e.entryId === "LED-2026-0001")!;
    const restatedAt = new Date("2026-06-07T00:00:00Z");
    const landed = await landBatch(
      client.db,
      {
        source: LEDGER_SOURCE,
        connection: "seed",
        kind: "seed",
        externalRef: "ledger-restated",
        idempotencyKey: "ledger:file:restated-test",
        records: [
          {
            sourceAccount: entry.account,
            sourceId: entry.entryId,
            payload: { ...entry, amount: "48.90" },
          },
        ],
      },
      restatedAt,
    );
    expect(landed.rawInserted).toBe(1);
    const normalized = await normalizeBatch(
      client.db,
      createSeedAdapters()[LEDGER_SOURCE]!,
      landed.batchId,
      restatedAt,
    );
    expect(normalized).toMatchObject({ normalized: 1, superseded: 1 });

    // The present-day run sees the contradiction…
    const today = await runRecon(client.db, { now: restatedAt });
    expect(today.asOf).not.toBe(first.summary.asOf);
    expect(today.breaks.amount_mismatch).toBe(1);

    // …while re-executing the original watermark reproduces the original
    // conclusions exactly, restatement notwithstanding.
    const replay = await runRecon(client.db, {
      now: new Date("2026-06-08T00:00:00Z"),
      asOf: new Date(first.summary.asOf),
    });
    expect(replay.asOf).toBe(first.summary.asOf);
    expect(replay.matches).toBe(first.summary.matches);
    expect(replay.breaks).toEqual(first.summary.breaks);
    expect(await runFingerprint(client, replay.runId)).toEqual(originalFingerprint);
  });
});
