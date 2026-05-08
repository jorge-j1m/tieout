import type { BreakType, MatchKind } from "./canonical.js";

/** Matches reference transaction id + version (D17) so supersession is detectable. */
export interface TxnRef {
  id: string;
  version: number;
}

export interface MatchProposal {
  kind: MatchKind;
  members: TxnRef[];
}

export interface BreakProposal {
  type: BreakType;
  /** Enough to explain the break without re-deriving it: refs, amounts (as strings), references. */
  details: Record<string, unknown>;
}

export interface ReconSummary {
  runId: string;
  asOf: string;
  rulesetVersion: string;
  matches: number;
  matchedTransactions: number;
  breaks: Record<BreakType, number>;
  totalBreaks: number;
}
