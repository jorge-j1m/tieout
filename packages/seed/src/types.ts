import type { BreakType } from "@tieout/contracts";

/** Mercadia's internal ledger entry — the shape its own books export (a source shape, not ours). */
export interface SeedLedgerEntry {
  entryId: string;
  account: string;
  /** Dot-decimal string, signed from Mercadia's perspective. Parsed straight to bigint downstream. */
  amount: string;
  currency: "USD";
  /** UTC ISO timestamp. */
  bookedAt: string;
  /** YYYY-MM-DD. */
  valueDate: string;
  type: "payment" | "refund" | "fee" | "payout" | "adjustment";
  status: "posted" | "pending" | "void";
  /** PSP object id the booking refers to (ch_…, re_…), or null for manual journals. */
  reference: string | null;
  description: string;
}

/** Stripe balance transaction, shaped like the real API object. */
export interface SeedStripeBalanceTransaction {
  id: string;
  object: "balance_transaction";
  /** Integer minor units, signed. */
  amount: number;
  currency: "usd";
  /** Unix seconds. */
  created: number;
  available_on: number;
  description: string | null;
  fee: number;
  fee_details: { amount: number; currency: "usd"; type: string }[];
  net: number;
  reporting_category: string;
  source: string | null;
  status: "available" | "pending";
  type: "charge" | "refund" | "stripe_fee" | "payout" | "adjustment";
}

/** A break the dataset deliberately plants. Acceptance: recon finds exactly these. */
export interface PlantedBreak {
  id: string;
  breakType: BreakType;
  /** Which side the consumed (breaking) transaction lives on. */
  source: "ledger" | "stripe";
  /** sourceId of the consumed transaction, as it will appear in break details. */
  sourceId: string;
  reason: string;
}

export interface MercadiaDataset {
  ledgerEntries: SeedLedgerEntry[];
  stripeBalanceTransactions: SeedStripeBalanceTransaction[];
  manifest: PlantedBreak[];
}
