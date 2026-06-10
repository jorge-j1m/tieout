import type { BreakType, FxRateInput, ReconSummary, SourceAdapter } from "@tieout/contracts";
import { BREAK_TYPES } from "@tieout/contracts";
import { reconcile, RULESET_VERSION, type MatchableTxn, type MatchingConfig } from "@tieout/core";
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
  /** Ruleset-v2 knobs, all recorded in run stats so runs stay self-describing. */
  toleranceMinor?: bigint;
  fx?: { rates: FxRateInput[]; toleranceBps: number };
  lagMsBySource?: Record<string, number>;
  duplicateWindowMs?: number;
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
    // Rows normalized before the concept existed mean "net equals amount".
    netMinor: t.netMinor ?? t.amountMinor,
    currency: t.currency,
    occurredAt: t.occurredAt,
    reference: t.reference,
    groupRef: t.groupRef,
  });
  // Tombstoned versions are the source saying "this no longer exists" — they are
  // history, not matchable money.
  const live = rows.filter((t) => !t.isTombstone);
  const ledger = live.filter((t) => t.source === "ledger").map(toMatchable);
  const external = live.filter((t) => t.source !== "ledger").map(toMatchable);

  const config: MatchingConfig = {
    windowMs: opts.windowMs ?? DEFAULT_MATCH_WINDOW_MS,
    asOf,
    ...(opts.toleranceMinor !== undefined ? { toleranceMinor: opts.toleranceMinor } : {}),
    ...(opts.fx !== undefined ? { fx: opts.fx } : {}),
    ...(opts.lagMsBySource !== undefined ? { lagMsBySource: opts.lagMsBySource } : {}),
    ...(opts.duplicateWindowMs !== undefined ? { duplicateWindowMs: opts.duplicateWindowMs } : {}),
  };
  const { matches, breaks, pending } = reconcile(ledger, external, config);

  const breakCounts = Object.fromEntries(BREAK_TYPES.map((t) => [t, 0])) as Record<
    BreakType,
    number
  >;
  for (const b of breaks) breakCounts[b.type] += 1;
  const pendingBySource: Record<string, number> = {};
  for (const p of pending) {
    pendingBySource[p.source] = (pendingBySource[p.source] ?? 0) + 1;
  }

  const { runId } = await persistReconRun(db, {
    asOf,
    rulesetVersion: RULESET_VERSION,
    matches,
    breaks,
    stats: {
      evaluatedTransactions: live.length,
      ledgerTransactions: ledger.length,
      externalTransactions: external.length,
      matches: matches.length,
      breaks: breakCounts,
      pendingBySource,
      pending: pending.map((p) => ({ ...p.ref, source: p.source, sourceId: p.sourceId })),
      config: {
        windowMs: config.windowMs,
        toleranceMinor: (config.toleranceMinor ?? 0n).toString(),
        fxToleranceBps: config.fx?.toleranceBps ?? null,
        lagMsBySource: config.lagMsBySource ?? null,
        duplicateWindowMs: config.duplicateWindowMs ?? null,
      },
    },
    now: opts.now,
  });

  return {
    runId,
    asOf: asOf.toISOString(),
    rulesetVersion: RULESET_VERSION,
    matches: matches.length,
    matchedTransactions: matches.reduce((n, m) => n + m.members.length, 0),
    breaks: breakCounts,
    totalBreaks: breaks.length,
    pendingBySource,
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
  for (const [source, count] of Object.entries(summary.pendingBySource)) {
    lines.push(`  pending:  ${count} (${source}, inside settlement lag)`);
  }
  return lines.join("\n");
}
