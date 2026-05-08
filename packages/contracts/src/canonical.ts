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

/** Typed breaks (D18). Stage 1 set; later stages extend. */
export const BREAK_TYPES = [
  "missing_in_ledger",
  "missing_in_stripe",
  "amount_mismatch",
  "duplicate_candidate",
] as const;
export type BreakType = (typeof BREAK_TYPES)[number];
export const breakTypeSchema = z.enum(BREAK_TYPES);

/** How a match was produced. */
export const MATCH_KINDS = ["exact_reference", "amount_date_window"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];
export const matchKindSchema = z.enum(MATCH_KINDS);

/** What kind of unit a batch landed from. */
export const BATCH_KINDS = ["api", "file", "seed"] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

export const BATCH_STATUSES = ["landed", "normalized", "failed"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const RUN_STATUSES = ["running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const QUARANTINE_STAGES = ["land", "normalize"] as const;
export type QuarantineStage = (typeof QUARANTINE_STAGES)[number];
