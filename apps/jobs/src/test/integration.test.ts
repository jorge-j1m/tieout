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
import { loadSeedManifest, seedFiles, type SeedLedgerEntry } from "@tieout/seed";
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
    });
    second = await fullRecon(client.db, createSeedAdapters(), {
      now: new Date("2026-06-06T00:00:00Z"),
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

  it("quarantines nothing on clean seed data and matches everything else", async () => {
    const { expected } = loadSeedManifest();
    expect(await client.db.select().from(quarantinedRecords)).toHaveLength(0);
    expect(first.summary.matches).toBe(expected.matches.total);
    expect(first.summary.totalBreaks).toBe(expected.totalBreaks);
    expect(first.summary.breaks).toMatchObject(expected.breaksByType);

    const kindRows = await client.db
      .select({ kind: matches.kind })
      .from(matches)
      .where(eq(matches.runId, first.summary.runId));
    const byKind: Record<string, number> = {};
    for (const row of kindRows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    expect(byKind).toEqual({
      exact_reference: expected.matches.exact_reference,
      amount_date_window: expected.matches.amount_date_window,
    });
  });

  it("re-running ingestion creates zero duplicate raw or transaction rows", async () => {
    for (const results of Object.values(second.landed)) {
      for (const r of results) {
        expect(r.batchExisted).toBe(true);
        expect(r.rawInserted).toBe(0);
      }
    }
    for (const results of Object.values(second.normalized)) {
      for (const r of results) {
        expect(r.normalized).toBe(0);
        expect(r.quarantined).toBe(0);
      }
    }
    const { expected } = loadSeedManifest();
    const rawCount = await client.db.select().from(rawRecords);
    const txnCount = await client.db.select().from(transactions);
    expect(rawCount).toHaveLength(expected.ledgerRecords + expected.stripeRecords);
    expect(txnCount).toHaveLength(expected.transactions);
    expect(txnCount.every((t) => t.isCurrent && t.version === 1)).toBe(true);
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
