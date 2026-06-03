import "../env.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BreakTxnDetail } from "@tieout/core";
import {
  breaks,
  createDbClient,
  matchMembers,
  matches,
  migrationsFolder,
  quarantinedRecords,
  rawRecords,
  transactions,
  type DbClient,
} from "@tieout/db";
import { loadPlantedManifest } from "@tieout/seed";
import { createSeedAdapters } from "../pipeline/adapters.js";
import { fullRecon, type FullReconResult } from "../pipeline/pipeline.js";

const hasDatabase = process.env.DATABASE_URL !== undefined;

/** Order-independent fingerprints of a run's matches and breaks, for run-vs-run comparison. */
async function runFingerprint(client: DbClient, runId: string) {
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

describe.skipIf(!hasDatabase)("Stage 1 acceptance: full pipeline over the seed dataset", () => {
  let client: DbClient;
  let first: FullReconResult;
  let second: FullReconResult;

  beforeAll(async () => {
    client = createDbClient(process.env.DATABASE_URL!);
    await migrate(client.db, { migrationsFolder });
    await client.db.execute(dsql`
      TRUNCATE TABLE match_members, matches, breaks, recon_runs,
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
    await client.sql.end();
  });

  it("finds exactly the planted breaks — no more, no fewer", async () => {
    const manifest = loadPlantedManifest();
    const breakRows = await client.db
      .select()
      .from(breaks)
      .where(eq(breaks.runId, first.summary.runId));
    expect(breakRows).toHaveLength(manifest.length);
    for (const planted of manifest) {
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
    expect(await client.db.select().from(quarantinedRecords)).toHaveLength(0);
    // 40 charges + 3 booked refunds tie out; 3 of those matches come from the
    // amount+date-window fallback (manual ledger bookings without references).
    expect(first.summary.matches).toBe(43);
    expect(first.summary.totalBreaks).toBe(4);
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
    const rawCount = await client.db.select().from(rawRecords);
    const txnCount = await client.db.select().from(transactions);
    expect(rawCount).toHaveLength(90); // 45 ledger entries + 45 stripe balance txns
    expect(txnCount).toHaveLength(90);
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
});
