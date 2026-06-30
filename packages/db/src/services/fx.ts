import { asc, desc, lte } from "drizzle-orm";
import type { FxRateInput } from "@tieout/contracts";
import type { Db } from "../client.js";
import { fxRates } from "../schema.js";

/**
 * FX rates as data (D7): upserted reference rows, applied at match time, recorded
 * on every match that used them. Append-only by uniqueness — re-seeding the same
 * (pair, day, source) converges instead of duplicating.
 */
export async function upsertFxRates(db: Db, rates: FxRateInput[]): Promise<void> {
  if (rates.length === 0) return;
  await db
    .insert(fxRates)
    .values(
      rates.map((r) => ({
        base: r.base,
        quote: r.quote,
        rate: r.rate,
        rateSource: r.rateSource,
        rateDate: r.rateDate,
      })),
    )
    .onConflictDoNothing({
      target: [fxRates.base, fxRates.quote, fxRates.rateDate, fxRates.rateSource],
    });
}

/**
 * The run's rate set (D29d): for each (base, quote) pair, the latest rate dated
 * on or before the watermark — exactly one per pair, deterministically (date,
 * then source name breaks ties). The matcher records whichever it applies.
 */
export async function loadFxRatesAsOf(db: Db, asOf: Date): Promise<FxRateInput[]> {
  const asOfDate = asOf.toISOString().slice(0, 10);
  return db
    .selectDistinctOn([fxRates.base, fxRates.quote], {
      base: fxRates.base,
      quote: fxRates.quote,
      rate: fxRates.rate,
      rateSource: fxRates.rateSource,
      rateDate: fxRates.rateDate,
    })
    .from(fxRates)
    .where(lte(fxRates.rateDate, asOfDate))
    .orderBy(
      asc(fxRates.base),
      asc(fxRates.quote),
      desc(fxRates.rateDate),
      desc(fxRates.rateSource),
    );
}
