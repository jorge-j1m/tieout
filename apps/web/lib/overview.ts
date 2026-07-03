import { BREAK_TYPES, type Break, type Run } from "@tieout/contracts";
import type { TypeRollup } from "@/components/data/TypedList";
import type { TrendPoint } from "@/components/data/TrendStrip";

/**
 * Pure Overview aggregations — kept out of the page so they can be tested
 * without a render. A break's amount is its subject transaction's magnitude
 * (`txns[0]`), summed in bigint minor units; no float touches the total.
 */

/** Group a run's breaks by type into count + total amount, in canonical type order. */
export function rollupBreaksByType(breaks: Break[]): TypeRollup[] {
  const byType = new Map<string, { count: number; total: bigint; currency: string }>();
  for (const b of breaks) {
    const subject = b.details.txns[0];
    if (subject === undefined) continue;
    const magnitude = subject.amountMinor.startsWith("-")
      ? BigInt(subject.amountMinor.slice(1))
      : BigInt(subject.amountMinor);
    const bucket = byType.get(b.type);
    if (bucket) {
      bucket.count += 1;
      bucket.total += magnitude;
    } else {
      byType.set(b.type, { count: 1, total: magnitude, currency: subject.currency });
    }
  }
  return BREAK_TYPES.filter((t) => byType.has(t)).map((type) => {
    const bucket = byType.get(type)!;
    return { type, count: bucket.count, totalMinor: bucket.total.toString(), currency: bucket.currency };
  });
}

/**
 * The most recent `size` runs as a chronological trend, each flagged rose/fell
 * against its predecessor. `getRuns` returns newest-first, so we take the head
 * and reverse it.
 */
export function buildTrend(runsNewestFirst: Run[], size = 12): TrendPoint[] {
  const chronological = runsNewestFirst.slice(0, size).reverse();
  return chronological.map((run, i) => {
    const breaks = run.stats.totalBreaks;
    const prev = i > 0 ? chronological[i - 1]!.stats.totalBreaks : null;
    const rose = prev === null || breaks === prev ? null : breaks > prev;
    return { runId: run.id, asOf: run.asOf, breaks, rose };
  });
}

/** Total transactions the run held as pending inside the settlement-lag window (D12). */
export function pendingCount(run: Run): number {
  return Object.values(run.stats.pendingBySource).reduce((n, v) => n + v, 0);
}

/** Run duration in whole seconds, or null if it never finished. */
export function runDurationSeconds(run: Run): number | null {
  if (run.finishedAt === null) return null;
  return Math.max(0, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000));
}
