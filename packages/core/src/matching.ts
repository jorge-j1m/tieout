import type {
  BreakProposal,
  CanonicalTxnType,
  FxRateInput,
  MatchProposal,
  PendingProposal,
} from "@tieout/contracts";
import { convertMinor, isWithinBps, parseRate, type ParsedRate } from "./money.js";

/**
 * Matching v2 (ruleset-v2): deterministic tie-out between the internal ledger and
 * any number of external sources.
 *
 *   1. Same-side duplicate references → keep the canonical first, flag the rest
 *      (`duplicate_candidate`). Sides are the ledger and each external source.
 *   2. Grouped settlement (N:1): external records sharing `(source, groupRef)`
 *      against the ledger txn whose `reference` names the key, compared on a
 *      NET basis (what actually arrives) — groups are claimed before 1:1 passes.
 *   3. Exact `reference` 1:1 on gross amounts. Transfer legs (payout/transfer on
 *      both sides) must sum to zero; everything else must be equal — both within
 *      the configured tolerance.
 *   4. Fallback `(amountMinor, currency, occurredAt ± window)` 1:1, nearest in
 *      time, exact amount — deliberately tolerance-free: it is already a guess.
 *   5. Leftover classification: settlement lag → pending (not a break, D12);
 *      external fees → `unexpected_fee`; reference-less double-posts →
 *      `duplicate_candidate` (when configured); the rest → `missing_in_ledger` /
 *      `missing_in_source`.
 *
 * Cross-currency comparisons convert with the run's explicit rate (D7) and a
 * basis-point tolerance; beyond it the rate is the suspect → `fx_drift`. A pair
 * needed but not provided fails the run loudly — never guessed.
 *
 * Tie-breaking is part of the ruleset: everything resolves through the canonical
 * order `(occurredAt, sourceId, id)` — total, and decided by stable source-derived
 * keys. Greedy and auditable rather than globally optimised.
 *
 * Pure and deterministic: inputs are sorted canonically first, time is data
 * (`occurredAt`, `asOf`), never a clock read.
 */

export const RULESET_VERSION = "ruleset-v2";

export interface MatchableTxn {
  id: string;
  version: number;
  source: string;
  sourceAccount: string;
  sourceId: string;
  type: CanonicalTxnType;
  amountMinor: bigint;
  /** Net of source-side fees; loaders canonicalize unknown (pre-v2) values to the amount. */
  netMinor: bigint;
  currency: string;
  occurredAt: Date;
  reference: string | null;
  /** Settlement/payout unit membership — what the grouped pass buckets on. */
  groupRef: string | null;
}

export interface FxConfig {
  /** Exactly one rate per (base, quote) pair — the run's rate set, recorded on every use. */
  rates: FxRateInput[];
  toleranceBps: number;
}

export interface MatchingConfig {
  /** Max |occurredAt difference| for the fallback pass. */
  windowMs: number;
  /** The run's watermark — the clock all lag decisions read (time is data). */
  asOf: Date;
  /** Absolute same-currency tolerance on reference/grouped comparisons. Default 0n. */
  toleranceMinor?: bigint;
  fx?: FxConfig;
  /** Per-source settlement-lag windows (D12); an unmatched record inside its window is pending. */
  lagMsBySource?: Record<string, number>;
  /** Reference-less double-post heuristic window; 0/absent disables it. */
  duplicateWindowMs?: number;
}

export interface ReconcileResult {
  matches: MatchProposal[];
  breaks: BreakProposal[];
  pending: PendingProposal[];
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
  netMinor: string;
  currency: string;
  occurredAt: string;
  reference: string | null;
  groupRef: string | null;
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
    netMinor: t.netMinor.toString(),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    reference: t.reference,
    groupRef: t.groupRef,
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

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** The run's rate set, validated: at most one rate per direction, parsed once. */
class RateBook {
  private readonly rates = new Map<string, { input: FxRateInput; parsed: ParsedRate }>();

  constructor(inputs: readonly FxRateInput[]) {
    for (const input of inputs) {
      const key = `${input.base}:${input.quote}`;
      if (this.rates.has(key)) {
        throw new Error(`fx config carries two rates for ${key} — one per pair per run`);
      }
      this.rates.set(key, { input, parsed: parseRate(input.rate) });
    }
  }

  /** Throws when a needed pair is missing: an unpriceable comparison fails the run, loudly. */
  get(base: string, quote: string): { input: FxRateInput; parsed: ParsedRate } {
    const rate = this.rates.get(`${base}:${quote}`);
    if (!rate) {
      throw new Error(
        `no fx rate configured for ${base}→${quote}; cross-currency matching needs the run's rate`,
      );
    }
    return rate;
  }
}

function fxDetail(rate: { input: FxRateInput }): Record<string, string> {
  return {
    rate: rate.input.rate,
    rateBase: rate.input.base,
    rateQuote: rate.input.quote,
    rateSource: rate.input.rateSource,
    rateDate: rate.input.rateDate,
  };
}

export function reconcile(
  ledgerIn: readonly MatchableTxn[],
  externalIn: readonly MatchableTxn[],
  config: MatchingConfig,
): ReconcileResult {
  const ledger = [...ledgerIn].sort(canonicalOrder);
  const external = [...externalIn].sort(canonicalOrder);
  const tolerance = config.toleranceMinor ?? 0n;
  const fxToleranceBps = config.fx?.toleranceBps ?? 0;
  const rateBook = new RateBook(config.fx?.rates ?? []);
  const matches: MatchProposal[] = [];
  const breaks: BreakProposal[] = [];
  const pending: PendingProposal[] = [];
  const consumed = new Set<string>();

  const member = (t: MatchableTxn) => ({ id: t.id, version: t.version });

  /** Compare external money against a ledger expectation, converting when currencies differ. */
  function compareToLedger(
    externalValue: bigint,
    externalCurrency: string,
    ledgerValue: bigint,
    ledgerCurrency: string,
  ):
    | { verdict: "match"; details: Record<string, unknown> }
    | { verdict: "amount_mismatch" }
    | { verdict: "fx_drift"; details: Record<string, unknown> } {
    if (externalCurrency === ledgerCurrency) {
      const delta = abs(ledgerValue - externalValue);
      if (delta <= tolerance) {
        return {
          verdict: "match",
          details:
            delta === 0n
              ? {}
              : { deltaMinor: delta.toString(), toleranceMinor: tolerance.toString() },
        };
      }
      return { verdict: "amount_mismatch" };
    }
    const rate = rateBook.get(externalCurrency, ledgerCurrency);
    const converted = convertMinor(externalValue, externalCurrency, ledgerCurrency, rate.parsed);
    const fx = {
      ...fxDetail(rate),
      convertedMinor: converted.toString(),
      toleranceBps: fxToleranceBps,
    };
    if (isWithinBps(ledgerValue, converted, fxToleranceBps)) {
      return { verdict: "match", details: { fx } };
    }
    return { verdict: "fx_drift", details: { fx } };
  }

  /**
   * Sum parts' nets in the target currency: per-currency subtotals, each converted
   * at most once — minimal rounding. Every rate used is returned, sorted by currency.
   */
  function convertedNetSum(
    parts: readonly MatchableTxn[],
    target: string,
  ): { sum: bigint; fxUsed: Record<string, unknown>[] } {
    const subtotals = new Map<string, bigint>();
    for (const p of parts) {
      subtotals.set(p.currency, (subtotals.get(p.currency) ?? 0n) + p.netMinor);
    }
    let sum = 0n;
    const fxUsed: Record<string, unknown>[] = [];
    for (const [currency, subtotal] of [...subtotals.entries()].sort(([a], [b]) =>
      compareStrings(a, b),
    )) {
      if (currency === target) {
        sum += subtotal;
      } else {
        const rate = rateBook.get(currency, target);
        sum += convertMinor(subtotal, currency, target, rate.parsed);
        fxUsed.push({ ...fxDetail(rate), toleranceBps: fxToleranceBps });
      }
    }
    return { sum, fxUsed };
  }

  // Phase 1 — same-side duplicate references. The canonical first occurrence stays
  // matchable; every extra is consumed as a duplicate_candidate. Each external
  // source is its own reference space.
  const sides = new Map<string, MatchableTxn[]>([["ledger", ledger]]);
  for (const t of external) {
    const bucket = sides.get(t.source);
    if (bucket === undefined) sides.set(t.source, [t]);
    else bucket.push(t);
  }
  for (const [side, txns] of [...sides.entries()].sort(([a], [b]) => compareStrings(a, b))) {
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

  // Phase 2 — grouped settlement (N:1). External records sharing (source, groupRef)
  // are one delivery; the ledger txn whose reference names the key is its booking.
  // Compared on nets — fees the source kept never arrive. Groups claim their anchor
  // before the 1:1 passes can.
  const groups = new Map<string, { source: string; groupRef: string; parts: MatchableTxn[] }>();
  for (const t of external) {
    if (t.groupRef === null || consumed.has(t.id)) continue;
    const key = `${t.source}\u0000${t.groupRef}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { source: t.source, groupRef: t.groupRef, parts: [t] });
    else group.parts.push(t);
  }
  const ledgerByRef = new Map<string, MatchableTxn>();
  for (const l of ledger) {
    if (l.reference !== null && !consumed.has(l.id)) ledgerByRef.set(l.reference, l);
  }
  for (const { source, groupRef, parts } of [...groups.values()].sort(
    (a, b) => compareStrings(a.source, b.source) || compareStrings(a.groupRef, b.groupRef),
  )) {
    const anchor = ledgerByRef.get(groupRef);
    if (anchor === undefined || consumed.has(anchor.id)) continue; // parts fall through to leftover classification

    const { sum, fxUsed } = convertedNetSum(parts, anchor.currency);
    const crossCurrency = fxUsed.length > 0;
    const delta = abs(anchor.netMinor - sum);
    const within = crossCurrency
      ? isWithinBps(anchor.netMinor, sum, fxToleranceBps)
      : delta <= tolerance;

    const consumeAll = () => {
      consumed.add(anchor.id);
      for (const p of parts) consumed.add(p.id);
    };
    const groupDetails = {
      groupKey: groupRef,
      source,
      partCount: parts.length,
      anchorNetMinor: anchor.netMinor.toString(),
      partsNetMinor: sum.toString(),
      ...(crossCurrency ? { fx: fxUsed.length === 1 ? fxUsed[0] : fxUsed } : {}),
    };

    if (within) {
      consumeAll();
      matches.push({
        kind: "grouped_reference",
        members: [member(anchor), ...parts.map(member)],
        details: {
          ...groupDetails,
          ...(delta === 0n
            ? {}
            : { deltaMinor: delta.toString(), toleranceMinor: tolerance.toString() }),
        },
      });
      continue;
    }

    consumeAll();
    const allTxns = [txnDetail(anchor), ...parts.map(txnDetail)];

    // A mismatch explained exactly by fee-type members the booking ignored is a
    // sharper finding than "the numbers differ" or "the rate is off": name the
    // fees. Fee subtotals convert with the same run rate; when rounding makes the
    // explanation inexact, the generic break stands — never an approximate claim.
    const feeParts = parts.filter((p) => p.type === "fee");
    const feeSum = convertedNetSum(feeParts, anchor.currency).sum;
    if (feeParts.length > 0 && anchor.netMinor - sum === -feeSum) {
      breaks.push({
        type: "unexpected_fee",
        details: {
          ...groupDetails,
          feeNetMinor: feeSum.toString(),
          fees: feeParts.map(txnDetail),
          txns: allTxns,
        },
      });
    } else if (crossCurrency) {
      breaks.push({
        type: "fx_drift",
        details: { ...groupDetails, deltaMinor: delta.toString(), txns: allTxns },
      });
    } else {
      breaks.push({
        type: "amount_mismatch",
        details: { ...groupDetails, deltaMinor: delta.toString(), txns: allTxns },
      });
    }
  }

  // Phase 3 — exact reference, 1:1, gross amounts. Transfer legs (payout/transfer
  // both sides) record the same movement from opposite ends and must sum to zero;
  // everything else must agree.
  const externalByRef = new Map<string, MatchableTxn>();
  for (const s of external) {
    if (s.reference === null || consumed.has(s.id)) continue;
    // Cross-source reference collisions keep the canonical first; the other
    // surfaces through the later passes rather than silently losing the race.
    if (!externalByRef.has(s.reference)) externalByRef.set(s.reference, s);
  }
  for (const l of ledger) {
    if (l.reference === null || consumed.has(l.id)) continue;
    const s = externalByRef.get(l.reference);
    if (s === undefined) continue;
    consumed.add(l.id);
    consumed.add(s.id);

    const transferLegs =
      (l.type === "payout" || l.type === "transfer") &&
      (s.type === "payout" || s.type === "transfer");
    const result = transferLegs
      ? // Legs sum to zero: compare the external leg against the negated booking.
        compareToLedger(s.amountMinor, s.currency, -l.amountMinor, l.currency)
      : compareToLedger(s.amountMinor, s.currency, l.amountMinor, l.currency);

    if (result.verdict === "match") {
      const details = { ...(transferLegs ? { rule: "transfer_legs" } : {}), ...result.details };
      matches.push({
        kind: "exact_reference",
        members: [member(l), member(s)],
        ...(Object.keys(details).length > 0 ? { details } : {}),
      });
    } else if (result.verdict === "fx_drift") {
      breaks.push({
        type: "fx_drift",
        details: {
          reference: l.reference,
          ledgerAmountMinor: l.amountMinor.toString(),
          externalAmountMinor: s.amountMinor.toString(),
          ...result.details,
          txns: [txnDetail(l), txnDetail(s)],
        },
      });
    } else {
      breaks.push({
        type: "amount_mismatch",
        details: {
          reference: l.reference,
          ledgerAmountMinor: l.amountMinor.toString(),
          externalAmountMinor: s.amountMinor.toString(),
          txns: [txnDetail(l), txnDetail(s)],
        },
      });
    }
  }

  // Phase 4 — fallback (amount, currency, occurredAt ± window), nearest-in-time 1:1.
  // Exact amounts only: this pass is already a guess; tolerances would multiply
  // false pairs.
  const externalByAmount = new Map<string, MatchableTxn[]>();
  for (const s of external) {
    if (consumed.has(s.id)) continue;
    const key = `${s.currency}:${s.amountMinor}`;
    const bucket = externalByAmount.get(key);
    if (bucket === undefined) externalByAmount.set(key, [s]);
    else bucket.push(s);
  }
  for (const l of ledger) {
    if (consumed.has(l.id)) continue;
    // A referenced ledger entry whose claim found no counterpart keeps its claim:
    // pairing it to a same-amount stranger would bury the contradiction it carries.
    if (l.reference !== null) continue;
    const bucket = externalByAmount.get(`${l.currency}:${l.amountMinor}`) ?? [];
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
      matches.push({ kind: "amount_date_window", members: [member(l), member(best)] });
    }
  }

  // Phase 5 — leftovers: pending inside the lag window (D12), typed breaks past it.
  const lagMs = (source: string) => config.lagMsBySource?.[source] ?? 0;
  const withinLag = (t: MatchableTxn): number | null => {
    const lag = lagMs(t.source);
    if (lag <= 0) return null;
    const waited = config.asOf.getTime() - t.occurredAt.getTime();
    return waited < lag ? lag - waited : null;
  };

  for (const s of external) {
    if (consumed.has(s.id)) continue;
    const remaining = withinLag(s);
    if (remaining !== null) {
      pending.push({
        ref: member(s),
        source: s.source,
        sourceId: s.sourceId,
        remainingLagMs: remaining,
      });
      continue;
    }
    if (s.type === "fee") {
      breaks.push({ type: "unexpected_fee", details: { txns: [txnDetail(s)] } });
    } else {
      breaks.push({ type: "missing_in_ledger", details: { txns: [txnDetail(s)] } });
    }
  }

  // Matched reference-less ledger twins, for the double-post heuristic. A consumed
  // reference-less ledger txn was necessarily matched by the fallback pass — every
  // other pass that consumes ledger requires a reference.
  const duplicateWindow = config.duplicateWindowMs ?? 0;
  const matchedLedger =
    duplicateWindow > 0
      ? ledger.filter((l) => consumed.has(l.id) && l.reference === null)
      : [];

  for (const l of ledger) {
    if (consumed.has(l.id)) continue;
    if (duplicateWindow > 0 && l.reference === null) {
      const twin = matchedLedger.find(
        (m) =>
          m.sourceAccount === l.sourceAccount &&
          m.currency === l.currency &&
          m.amountMinor === l.amountMinor &&
          Math.abs(m.occurredAt.getTime() - l.occurredAt.getTime()) <= duplicateWindow,
      );
      if (twin !== undefined) {
        breaks.push({
          type: "duplicate_candidate",
          details: {
            side: "ledger",
            heuristic: "referenceless_double_post",
            kept: txnDetail(twin),
            txns: [txnDetail(l)],
          },
        });
        continue;
      }
    }
    const remaining = withinLag(l);
    if (remaining !== null) {
      pending.push({
        ref: member(l),
        source: l.source,
        sourceId: l.sourceId,
        remainingLagMs: remaining,
      });
      continue;
    }
    breaks.push({ type: "missing_in_source", details: { txns: [txnDetail(l)] } });
  }

  return { matches, breaks, pending };
}
