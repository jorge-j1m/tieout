import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { ingestionBatches, rawRecords } from "../schema.js";

export { connectTestDb, type TestDb } from "../testing.js";

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE match_members, matches, breaks, recon_runs,
      quarantined_records, transactions, raw_records, ingestion_batches, source_cursors
    CASCADE
  `);
}

/** Minimal batch + raw row so FK-bearing fixtures can exist. Returns the raw record id. */
export async function insertFixtureRaw(
  db: Db,
  identity: { source: string; sourceAccount: string; sourceId: string; version?: number },
): Promise<{ batchId: string; rawId: string }> {
  const observedAt = new Date("2026-06-01T00:00:00Z");
  const [batch] = await db
    .insert(ingestionBatches)
    .values({
      source: identity.source,
      connection: "test",
      kind: "seed",
      externalRef: "fixture",
      idempotencyKey: `fixture:${identity.source}:${identity.sourceAccount}:${identity.sourceId}:${identity.version ?? 1}`,
      contentHash: "fixture",
      status: "landed",
      observedAt,
    })
    .returning({ id: ingestionBatches.id });
  const [raw] = await db
    .insert(rawRecords)
    .values({
      batchId: batch!.id,
      source: identity.source,
      sourceAccount: identity.sourceAccount,
      sourceId: identity.sourceId,
      version: identity.version ?? 1,
      contentHash: `fixture:${identity.version ?? 1}`,
      payload: { fixture: true },
      observedAt,
    })
    .returning({ id: rawRecords.id });
  return { batchId: batch!.id, rawId: raw!.id };
}
