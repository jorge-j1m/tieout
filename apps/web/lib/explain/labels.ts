import type { BreakType, MatchKind } from "@tieout/contracts";

/**
 * The canonical plain-English glosses — verbatim from the design brief, used as
 * headline copy for each break type. Jargon is the detail, never the lede.
 * `missing_in_stripe` is the legacy ruleset-v1 name for `missing_in_source`
 * (contracts keep it so historical runs stay readable forever).
 */
export const GLOSS: Record<BreakType, string> = {
  missing_in_ledger: "Money moved at the processor that your books don't show.",
  missing_in_stripe: "Your books claim money moved, but the source has no record.",
  missing_in_source: "Your books claim money moved, but the source has no record.",
  amount_mismatch: "Both sides describe the same event but disagree on the amount.",
  duplicate_candidate: "The same event appears twice on one side.",
  unexpected_fee: "The source charged a fee your books never anticipated.",
  fx_drift: "Cross-currency legs disagree beyond what the recorded rate explains.",
};

export const TYPE_LABEL: Record<BreakType, string> = {
  missing_in_ledger: "Missing in ledger",
  missing_in_stripe: "Missing in source",
  missing_in_source: "Missing in source",
  amount_mismatch: "Amount mismatch",
  duplicate_candidate: "Duplicate candidate",
  unexpected_fee: "Unexpected fee",
  fx_drift: "FX drift",
};

/** How each match was made — the rule that tied the two sides together. */
export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  exact_reference: "Exact reference",
  amount_date_window: "Amount + date",
  grouped_reference: "Grouped reference",
};

const SOURCE_LABEL: Record<string, string> = {
  stripe: "Stripe",
  ledger: "Ledger",
  pagolat: "PagoLat",
};

/** What each source is, in a phrase — the sources strip's second line. */
const SOURCE_KIND: Record<string, string> = {
  stripe: "Card processor",
  ledger: "Accounting ledger",
  pagolat: "LatAm settlement PSP",
};

/** Display name for a source id; unknown sources pass through verbatim. */
export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/** One-phrase description of a source; empty for unknown sources. */
export function sourceKind(source: string): string {
  return SOURCE_KIND[source] ?? "";
}
