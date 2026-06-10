import type { BreakType, MatchKind } from "./canonical.js";

/** Matches reference transaction id + version (D17) so supersession is detectable. */
export interface TxnRef {
  id: string;
  version: number;
}

export interface MatchProposal {
  kind: MatchKind;
  members: TxnRef[];
  /**
   * What the ruleset applied to accept this match, recorded so runs stay
   * self-describing: group key and side sums for grouped matches, applied
   * tolerance and delta when non-zero, FX rate (value/source/date) when
   * currencies crossed. Absent for plain stage-1-style matches.
   */
  details?: Record<string, unknown>;
}

export interface BreakProposal {
  type: BreakType;
  /** Enough to explain the break without re-deriving it: refs, amounts (as strings), references. */
  details: Record<string, unknown>;
}

/**
 * An unmatched transaction inside its source's settlement-lag window (D12):
 * reported as pending, NOT as a break — false breaks teach users to ignore the
 * product. Counted in run stats; re-derived (not persisted) on every run.
 */
export interface PendingProposal {
  ref: TxnRef;
  source: string;
  sourceId: string;
  /** Milliseconds the record may still legitimately wait, at this run's asOf. */
  remainingLagMs: number;
}

/**
 * An FX rate as matching input (D7): conversion happens at match time with an
 * explicit, recorded rate. `rate` is a decimal string (e.g. "0.058823") parsed
 * with bigint arithmetic — floats never touch money.
 */
export interface FxRateInput {
  base: string;
  quote: string;
  /** Decimal string: 1 unit of `base` = `rate` units of `quote`. */
  rate: string;
  /** Where the rate came from — recorded on every match that used it. */
  rateSource: string;
  /** The day the rate is for (YYYY-MM-DD). */
  rateDate: string;
}

export interface ReconSummary {
  runId: string;
  asOf: string;
  rulesetVersion: string;
  matches: number;
  matchedTransactions: number;
  breaks: Record<BreakType, number>;
  totalBreaks: number;
  /** Settlement-lag suppressions by source (D12). Empty when no lag is configured. */
  pendingBySource: Record<string, number>;
}
