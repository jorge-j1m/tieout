import type {
  BreakProposal,
  CanonicalTxnType,
  MatchProposal,
  TxnStatus,
} from "@tieout/contracts";

/**
 * Matching v1 (ruleset-v1): deterministic 1:1 tie-out between the internal ledger
 * and Stripe.
 *
 *   1. Same-side duplicate references → keep the canonical first, flag the rest
 *      (`duplicate_candidate`).
 *   2. Exact `reference` 1:1 — equal amount+currency matches; unequal is an
 *      `amount_mismatch` break.
 *   3. Fallback `(amountMinor, currency, occurredAt ± window)` 1:1, nearest in time.
 *   4. Leftovers become `missing_in_stripe` / `missing_in_ledger`.
 *
 * Tie-breaking is part of the ruleset, not an accident: everything resolves through
 * the canonical order `(occurredAt, sourceId, id)` — total, and decided by stable
 * source-derived keys (two records on one side always differ in `sourceId`). Pass 1
 * keeps the canonically-first duplicate; pass 3 lets each ledger record, in canonical
 * order, claim its nearest surviving counterpart, with exact-distance ties going to
 * the canonically-earlier candidate. Greedy and auditable rather than globally
 * optimised — simple to explain, deterministic to replay.
 *
 * Pure and deterministic: inputs are sorted canonically first, so result is
 * independent of input order. Time is data (`occurredAt`), never a clock read.
 */

export const RULESET_VERSION = "ruleset-v1";

export interface MatchableTxn {
  id: string;
  version: number;
  source: string;
  sourceAccount: string;
  sourceId: string;
  type: CanonicalTxnType;
  status: TxnStatus;
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  reference: string | null;
}

export interface MatchingConfig {
  /** Max |occurredAt difference| for the fallback pass. */
  windowMs: number;
}

export interface ReconcileResult {
  matches: MatchProposal[];
  breaks: BreakProposal[];
}

/** What a break records about a consumed transaction — enough to explain it later. */
export interface BreakTxnDetail {
  id: string;
  version: number;
  source: string;
  sourceAccount: string;
  sourceId: string;
  type: CanonicalTxnType;
  amountMinor: string;
  currency: string;
  occurredAt: string;
  reference: string | null;
}

function txnDetail(t: MatchableTxn): BreakTxnDetail {
  return {
    id: t.id,
    version: t.version,
    source: t.source,
    sourceAccount: t.sourceAccount,
    sourceId: t.sourceId,
    type: t.type,
    amountMinor: t.amountMinor.toString(),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    reference: t.reference,
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalOrder(a: MatchableTxn, b: MatchableTxn): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    compareStrings(a.sourceId, b.sourceId) ||
    compareStrings(a.id, b.id)
  );
}

export function reconcile(
  ledgerIn: readonly MatchableTxn[],
  stripeIn: readonly MatchableTxn[],
  config: MatchingConfig,
): ReconcileResult {
  const ledger = [...ledgerIn].sort(canonicalOrder);
  const stripe = [...stripeIn].sort(canonicalOrder);
  const matches: MatchProposal[] = [];
  const breaks: BreakProposal[] = [];
  const consumed = new Set<string>();

  // Phase 1 — same-side duplicate references. The canonical first occurrence stays
  // matchable; every extra is consumed as a duplicate_candidate.
  for (const [side, txns] of [
    ["ledger", ledger],
    ["stripe", stripe],
  ] as const) {
    const seenRef = new Map<string, MatchableTxn>();
    for (const t of txns) {
      if (t.reference === null) continue;
      const kept = seenRef.get(t.reference);
      if (kept === undefined) {
        seenRef.set(t.reference, t);
      } else {
        consumed.add(t.id);
        breaks.push({
          type: "duplicate_candidate",
          details: {
            side,
            reference: t.reference,
            kept: txnDetail(kept),
            txns: [txnDetail(t)],
          },
        });
      }
    }
  }

  // Phase 2 — exact reference, 1:1. References are unique per side now.
  const stripeByRef = new Map<string, MatchableTxn>();
  for (const s of stripe) {
    if (s.reference !== null && !consumed.has(s.id)) stripeByRef.set(s.reference, s);
  }
  for (const l of ledger) {
    if (l.reference === null || consumed.has(l.id)) continue;
    const s = stripeByRef.get(l.reference);
    if (s === undefined || consumed.has(s.id)) continue;
    consumed.add(l.id);
    consumed.add(s.id);
    if (l.amountMinor === s.amountMinor && l.currency === s.currency) {
      matches.push({
        kind: "exact_reference",
        members: [
          { id: l.id, version: l.version },
          { id: s.id, version: s.version },
        ],
      });
    } else {
      breaks.push({
        type: "amount_mismatch",
        details: {
          reference: l.reference,
          ledgerAmountMinor: l.amountMinor.toString(),
          stripeAmountMinor: s.amountMinor.toString(),
          txns: [txnDetail(l), txnDetail(s)],
        },
      });
    }
  }

  // Phase 3 — fallback (amount, currency, occurredAt ± window), nearest-in-time 1:1.
  const stripeByAmount = new Map<string, MatchableTxn[]>();
  for (const s of stripe) {
    if (consumed.has(s.id)) continue;
    const key = `${s.currency}:${s.amountMinor}`;
    const bucket = stripeByAmount.get(key);
    if (bucket === undefined) stripeByAmount.set(key, [s]);
    else bucket.push(s);
  }
  for (const l of ledger) {
    if (consumed.has(l.id)) continue;
    const bucket = stripeByAmount.get(`${l.currency}:${l.amountMinor}`) ?? [];
    let best: MatchableTxn | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const s of bucket) {
      if (consumed.has(s.id)) continue;
      const delta = Math.abs(l.occurredAt.getTime() - s.occurredAt.getTime());
      if (delta > config.windowMs) continue;
      if (
        delta < bestDelta ||
        (delta === bestDelta && best !== undefined && canonicalOrder(s, best) < 0)
      ) {
        best = s;
        bestDelta = delta;
      }
    }
    if (best !== undefined) {
      consumed.add(l.id);
      consumed.add(best.id);
      matches.push({
        kind: "amount_date_window",
        members: [
          { id: l.id, version: l.version },
          { id: best.id, version: best.version },
        ],
      });
    }
  }

  // Phase 4 — everything still unconsumed is a break. No settlement-lag logic in
  // Stage 1: unmatched means break.
  for (const l of ledger) {
    if (consumed.has(l.id)) continue;
    breaks.push({ type: "missing_in_stripe", details: { txns: [txnDetail(l)] } });
  }
  for (const s of stripe) {
    if (consumed.has(s.id)) continue;
    breaks.push({ type: "missing_in_ledger", details: { txns: [txnDetail(s)] } });
  }

  return { matches, breaks };
}
