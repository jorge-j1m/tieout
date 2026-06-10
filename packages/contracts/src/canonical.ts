import { z } from "zod";

/** Canonical transaction types (D15). Source-native types map onto these; unmapped types quarantine. */
export const CANONICAL_TXN_TYPES = [
  "payment",
  "refund",
  "payout",
  "fee",
  "transfer",
  "reversal",
  "adjustment",
] as const;
export type CanonicalTxnType = (typeof CANONICAL_TXN_TYPES)[number];
export const canonicalTxnTypeSchema = z.enum(CANONICAL_TXN_TYPES);

/** Canonical statuses. Not monotonic: settled → reversed is real (chargebacks, reorgs). */
export const TXN_STATUSES = ["pending", "settled", "failed", "reversed"] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];
export const txnStatusSchema = z.enum(TXN_STATUSES);

/**
 * Typed breaks (D18).
 *
 * `missing_in_stripe` is legacy: ruleset-v1 emitted it for ledger entries with no
 * external counterpart; ruleset-v2 emits the source-generic `missing_in_source`
 * instead (the consumed txns name the sources involved). The value stays so
 * historical runs remain readable forever — never remove enum values (D8 spirit).
 */
export const BREAK_TYPES = [
  "missing_in_ledger",
  "missing_in_stripe",
  "missing_in_source",
  "amount_mismatch",
  "duplicate_candidate",
  "unexpected_fee",
  "fx_drift",
] as const;
export type BreakType = (typeof BREAK_TYPES)[number];
export const breakTypeSchema = z.enum(BREAK_TYPES);

/** How a match was produced. */
export const MATCH_KINDS = [
  "exact_reference",
  "amount_date_window",
  "grouped_reference",
] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];
export const matchKindSchema = z.enum(MATCH_KINDS);

/** What kind of unit a batch landed from. */
export const BATCH_KINDS = ["api", "file", "seed"] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

/**
 * `quarantined`: the whole unit failed its own integrity checks at landing (D13) —
 * no raw records written. `halted`: normalization tripped the failure-rate circuit
 * breaker (D14) — quarantine rows written, no transactions.
 */
export const BATCH_STATUSES = ["landed", "normalized", "failed", "quarantined", "halted"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const RUN_STATUSES = ["running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** `batch` = the whole unit was rejected at landing (control totals, D13). */
export const QUARANTINE_STAGES = ["land", "normalize", "batch"] as const;
export type QuarantineStage = (typeof QUARANTINE_STAGES)[number];

/** Exception workflow (D18): the human-facing lifecycle over recurring breaks. */
export const EXCEPTION_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** Append-only history events on an exception. */
export const EXCEPTION_EVENT_KINDS = [
  "opened",
  "acknowledged",
  "resolved",
  "reopened",
  "self_resolved",
] as const;
export type ExceptionEventKind = (typeof EXCEPTION_EVENT_KINDS)[number];

/** Topics the transactional outbox carries (D17). */
export const OUTBOX_TOPICS = ["transaction.superseded", "transaction.tombstoned"] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];
