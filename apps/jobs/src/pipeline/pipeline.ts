import type { BreakType, ReconSummary, SourceAdapter } from "@tieout/contracts";
import { BREAK_TYPES } from "@tieout/contracts";
import { reconcile, RULESET_VERSION, type MatchableTxn } from "@tieout/core";
import {
  advanceCursor,
  currentWatermark,
  landBatch,
  loadTransactionsAsOf,
  normalizeBatch,
  persistReconRun,
  type Db,
  type LandResult,
  type NormalizeBatchResult,
} from "@tieout/db";

/** Fallback matching window: occurredAt within ±2 days. */
export const DEFAULT_MATCH_WINDOW_MS = 2 * 86_400_000;

export interface Window {
  from: Date;
  to: Date;
}

/** Land everything an adapter produces for a window, then advance its cursors. */
export async function landSource(
  db: Db,
  adapter: SourceAdapter,
  window: Window,
  now: Date,
): Promise<LandResult[]> {
  const batches = await adapter.land({ window });
  const results: LandResult[] = [];
  for (const batch of batches) {
    results.push(await landBatch(db, batch, now));
    for (const account of new Set(batch.records.map((r) => r.sourceAccount))) {
      await advanceCursor(db, batch.source, account, window.to, now);
    }
  }
  return results;
}

export async function normalizeBatches(
  db: Db,
  adapter: SourceAdapter,
  batchIds: string[],
  now: Date,
): Promise<NormalizeBatchResult[]> {
  const results: NormalizeBatchResult[] = [];
  for (const batchId of batchIds) {
    results.push(await normalizeBatch(db, adapter, batchId, now));
  }
  return results;
}

export interface ReconOptions {
  now: Date;
  asOf?: Date;
  windowMs?: number;
}

/**
 * One reconciliation run: snapshot the watermark, load the transaction versions
 * in effect at it (D27), match in core (pure), persist run + matches + breaks.
 * The watermark derives from the data — running twice on the same data produces
 * identical matches and breaks, and an explicit old `asOf` re-executes a past
 * run byte-for-byte even after restatements.
 */
export async function runRecon(db: Db, opts: ReconOptions): Promise<ReconSummary> {
  const asOf = opts.asOf ?? (await currentWatermark(db));
  if (asOf === null) {
    throw new Error("nothing has been ingested yet — land and normalize before reconciling");
  }
  const rows = await loadTransactionsAsOf(db, asOf);
  const toMatchable = (t: (typeof rows)[number]): MatchableTxn => ({
    id: t.id,
    version: t.version,
    source: t.source,
    sourceAccount: t.sourceAccount,
    sourceId: t.sourceId,
    type: t.type,
    status: t.status,
    amountMinor: t.amountMinor,
    currency: t.currency,
    occurredAt: t.occurredAt,
    reference: t.reference,
  });
  const ledger = rows.filter((t) => t.source === "ledger").map(toMatchable);
  const stripe = rows.filter((t) => t.source === "stripe").map(toMatchable);

  const { matches, breaks } = reconcile(ledger, stripe, {
    windowMs: opts.windowMs ?? DEFAULT_MATCH_WINDOW_MS,
  });

  const breakCounts = Object.fromEntries(BREAK_TYPES.map((t) => [t, 0])) as Record<
    BreakType,
    number
  >;
  for (const b of breaks) breakCounts[b.type] += 1;

  const { runId } = await persistReconRun(db, {
    asOf,
    rulesetVersion: RULESET_VERSION,
    matches,
    breaks,
    stats: {
      evaluatedTransactions: rows.length,
      ledgerTransactions: ledger.length,
      stripeTransactions: stripe.length,
      matches: matches.length,
      breaks: breakCounts,
    },
    now: opts.now,
  });

  return {
    runId,
    asOf: asOf.toISOString(),
    rulesetVersion: RULESET_VERSION,
    matches: matches.length,
    matchedTransactions: matches.length * 2,
    breaks: breakCounts,
    totalBreaks: breaks.length,
  };
}

export interface FullReconResult {
  landed: Record<string, LandResult[]>;
  normalized: Record<string, NormalizeBatchResult[]>;
  summary: ReconSummary;
}

/**
 * The whole Stage 1 story in one call: land both sources, normalize, reconcile.
 * Used by the CLI and the integration test; the Trigger.dev tasks run the same
 * steps as separate, individually idempotent units.
 */
export async function fullRecon(
  db: Db,
  adapters: Record<string, SourceAdapter>,
  opts: { now: Date; window?: Window },
): Promise<FullReconResult> {
  const window = opts.window ?? { from: new Date(0), to: opts.now };
  const landed: Record<string, LandResult[]> = {};
  const normalized: Record<string, NormalizeBatchResult[]> = {};
  for (const adapter of Object.values(adapters)) {
    const results = await landSource(db, adapter, window, opts.now);
    landed[adapter.source] = results;
    normalized[adapter.source] = await normalizeBatches(
      db,
      adapter,
      results.map((r) => r.batchId),
      opts.now,
    );
  }
  const summary = await runRecon(db, { now: opts.now });
  return { landed, normalized, summary };
}

export function formatSummary(result: FullReconResult): string {
  const { summary } = result;
  const lines: string[] = [];
  lines.push(`recon run ${summary.runId}`);
  lines.push(`  as of:    ${summary.asOf}`);
  lines.push(`  ruleset:  ${summary.rulesetVersion}`);
  for (const [source, results] of Object.entries(result.landed)) {
    const inserted = results.reduce((n, r) => n + r.rawInserted, 0);
    const skipped = results.reduce((n, r) => n + r.rawSkipped, 0);
    const norms = result.normalized[source] ?? [];
    const normalized = norms.reduce((n, r) => n + r.normalized, 0);
    const quarantined = norms.reduce((n, r) => n + r.quarantined, 0);
    lines.push(
      `  ${source}: ${results.length} batch(es), ${inserted} raw inserted, ${skipped} unchanged, ` +
        `${normalized} normalized, ${quarantined} quarantined`,
    );
  }
  lines.push(`  matches:  ${summary.matches} (${summary.matchedTransactions} transactions)`);
  lines.push(`  breaks:   ${summary.totalBreaks}`);
  for (const [type, count] of Object.entries(summary.breaks)) {
    if (count > 0) lines.push(`    - ${type}: ${count}`);
  }
  return lines.join("\n");
}
