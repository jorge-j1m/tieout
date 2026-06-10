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

/**
 * Totals a full pipeline run over the dataset must produce. Derived from the
 * generator's construction constants — never from running the matcher — so tests
 * asserting against them are a real cross-check, not the matcher agreeing with itself.
 */
export interface SeedExpectations {
  ledgerRecords: number;
  stripeRecords: number;
  /** Raw records and transactions after one clean run: every record, exactly once. */
  transactions: number;
  matches: { total: number; exact_reference: number; amount_date_window: number };
  breaksByType: Partial<Record<BreakType, number>>;
  totalBreaks: number;
}

/** The machine-readable acceptance contract (`data/manifest.json`) — the single source of truth for every count the tests and docs quote. */
export interface SeedManifest {
  plantedBreaks: PlantedBreak[];
  expected: SeedExpectations;
}

export interface MercadiaDataset {
  ledgerEntries: SeedLedgerEntry[];
  stripeBalanceTransactions: SeedStripeBalanceTransaction[];
  manifest: SeedManifest;
}
