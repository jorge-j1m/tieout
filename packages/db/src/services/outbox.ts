import { and, asc, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { outbox } from "../schema.js";

/**
 * The consuming half of the transactional outbox (D17). Events are written by
 * `normalizeBatch` in the same transaction as the supersession or tombstone they
 * announce; a dispatcher reads them here, triggers re-evaluation (a new recon
 * run — past runs are never mutated), and stamps them processed with the run
 * that covered them. Rows are never deleted: processed events are the audit
 * chain from "the world changed" to "we re-evaluated it".
 */

export async function unprocessedOutbox(db: Db, limit = 100) {
  return db
    .select()
    .from(outbox)
    .where(isNull(outbox.processedAt))
    .orderBy(asc(outbox.createdAt), asc(outbox.id))
    .limit(limit);
}

/**
 * Stamp events processed by `runId`. Guarded on `processedAt IS NULL` so a
 * dispatcher racing its own retry never re-stamps; returns how many rows this
 * call actually claimed.
 */
export async function markOutboxProcessed(
  db: Db,
  ids: string[],
  runId: string,
  now: Date,
): Promise<number> {
  if (ids.length === 0) return 0;
  const stamped = await db
    .update(outbox)
    .set({ processedAt: now, processedByRunId: runId })
    .where(and(inArray(outbox.id, ids), isNull(outbox.processedAt)))
    .returning({ id: outbox.id });
  return stamped.length;
}
