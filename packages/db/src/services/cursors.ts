import { eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { sourceCursors } from "../schema.js";

/**
 * A source's poll floor: the MINIMUM watermark across its accounts (null when
 * none exist) — a scheduler must not skip past the most-lagged account.
 */
export async function getCursor(db: Db, source: string): Promise<Date | null> {
  const [row] = await db
    .select({
      // Raw aggregates bypass drizzle's column decoding; reuse the watermark's decoder.
      min: sql`min(${sourceCursors.watermark})`.mapWith(sourceCursors.watermark),
    })
    .from(sourceCursors)
    .where(eq(sourceCursors.source, source));
  return row?.min ?? null;
}

/** Move a source's watermark forward (never backward — late data re-covers via lookback, D12). */
export async function advanceCursor(
  db: Db,
  source: string,
  sourceAccount: string,
  watermark: Date,
  now: Date,
): Promise<void> {
  await db
    .insert(sourceCursors)
    .values({ source, sourceAccount, watermark, updatedAt: now })
    .onConflictDoUpdate({
      target: [sourceCursors.source, sourceCursors.sourceAccount],
      set: {
        watermark: sql`greatest(${sourceCursors.watermark}, excluded.watermark)`,
        updatedAt: now,
      },
    });
}
