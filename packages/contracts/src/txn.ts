import { z } from "zod";
import { canonicalTxnTypeSchema, txnStatusSchema } from "./canonical.js";

/**
 * The canonical transaction every adapter normalizes into.
 *
 * - `amountMinor` is bigint minor units, signed from the company's perspective
 *   (inflow positive, outflow negative — D5/D6). Floats never touch money.
 * - `occurredAt` is event time, UTC (D11). `valueDate` is a calendar date when the
 *   source distinguishes it.
 * - Identity is `(source, sourceAccount, sourceId)` (D10).
 */
export const normalizedTxnSchema = z.object({
  source: z.string().min(1),
  sourceAccount: z.string().min(1),
  sourceId: z.string().min(1),
  /** Source-native type, verbatim (D15). */
  sourceType: z.string().min(1),
  type: canonicalTxnTypeSchema,
  amountMinor: z.bigint(),
  /**
   * Amount net of source-side fees, when the source nets them inside the record
   * (Stripe's amount/fee/net, PagoLat's line commissions). Equal to `amountMinor`
   * for sources without the concept. Grouped settlement matching compares nets —
   * that's what actually arrives.
   */
  netMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z][A-Z0-9]{2,5}$/),
  occurredAt: z.date(),
  valueDate: z.iso.date().nullable(),
  /** The account the money story belongs to (ledger account, PSP balance, ...). */
  account: z.string().min(1),
  /** Cross-source matching key when the source carries one (e.g. a charge id). */
  reference: z.string().min(1).nullable(),
  /**
   * The settlement/payout unit this record belongs to, when the source declares one
   * (a PagoLat line's day-file, a charge's payout). Grouped matching buckets on it;
   * the ledger anchor's `reference` names the same key.
   */
  groupRef: z.string().min(1).nullable(),
  status: txnStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
});
export type NormalizedTxn = z.infer<typeof normalizedTxnSchema>;

/** Structured quarantine error — an exceptions surface, not a log line (D14). */
export const quarantineErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type QuarantineError = z.infer<typeof quarantineErrorSchema>;

/** Result of normalizing one raw record: a canonical txn, or quarantine. Never a silent guess. */
export type NormalizeResult =
  | { ok: true; txn: NormalizedTxn }
  | { ok: false; errors: QuarantineError[] };
