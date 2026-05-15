import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { sourceCursors } from "../schema.js";

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
