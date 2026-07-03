import type {
  Batch,
  Break,
  BreakTxnDetail,
  BreakType,
  RawWithBatch,
  TransactionWithVersions,
} from "@tieout/contracts";
import { formatMoney } from "@/lib/money";
import { GLOSS, sourceLabel, TYPE_LABEL } from "./labels";

/**
 * The evidence-chain presenter (pure): it turns a break's *structured facts* —
 * the txns it consumed, the reference it couldn't pair, the delta, the applied
 * rate — into the plain-English narrative the hero screen reads. The prose is
 * derived here, never stored: the record holds facts, and this holds the way we
 * explain them. Deterministic in, deterministic out — hence unit-testable.
 */

/** One line in "what matching tried": did this pass hold, and what did it find. */
export interface MatchingStep {
  label: string;
  detail: string;
  pass: boolean;
}

export type EvidenceHop =
  | { kind: "conclusion"; title: string; type: BreakType; typeLabel: string; gloss: string }
  | { kind: "matching"; title: string; steps: MatchingStep[] }
  | {
      kind: "transaction";
      title: string;
      primary: BreakTxnDetail;
      transaction: TransactionWithVersions | null;
    }
  | { kind: "raw"; title: string; raw: RawWithBatch | null }
  | { kind: "batch"; title: string; batch: Batch | null };

// ── Reading the free-form details safely ──────────────────────────────────────

const str = (details: Break["details"], key: string): string | undefined =>
  typeof details[key] === "string" ? (details[key] as string) : undefined;

const obj = (details: Break["details"], key: string): Record<string, unknown> | undefined =>
  typeof details[key] === "object" && details[key] !== null
    ? (details[key] as Record<string, unknown>)
    : undefined;

/** The subject transaction — first consumed txn (the orphan, the anchor, the double post). */
function primaryTxn(b: Break): BreakTxnDetail {
  const [first] = b.details.txns;
  if (first === undefined) throw new Error(`break ${b.id} carries no txns in details`);
  return first;
}

/** Absolute money for display: refunds and fees are negative in the record, positive in prose. */
function absMoney(minor: string, currency: string): string {
  return formatMoney(minor.startsWith("-") ? minor.slice(1) : minor, currency);
}

/** The other side of a two-sided break (amount_mismatch, fx_drift 1:1). */
function counterpart(b: Break): BreakTxnDetail | undefined {
  return b.details.txns[1];
}

// ── The narrative ─────────────────────────────────────────────────────────────

const survivedSweep = (source: string): MatchingStep => ({
  label: "Duplicate sweep",
  detail: `Survived — no other ${sourceLabel(source)} record shares this id or reference.`,
  pass: true,
});

const settlementLag: MatchingStep = {
  label: "Settlement-lag window",
  detail: "Past its settlement-lag window → break.",
  pass: false,
};

function missingNarrative(b: Break, counterpartSide: "ledger" | "source"): MatchingStep[] {
  const txn = primaryTxn(b);
  const other = counterpartSide === "ledger" ? "ledger" : "source";
  const ref = txn.reference ?? str(b.details, "reference");
  return [
    survivedSweep(txn.source),
    {
      label: "Exact-reference pass",
      detail: ref
        ? `No ${other} entry cites reference \`${ref}\`.`
        : `No ${other} entry references this record.`,
      pass: false,
    },
    {
      label: "Amount / date window",
      detail: `No same-amount ${other} candidate within ±2 days.`,
      pass: false,
    },
    settlementLag,
  ];
}

function amountMismatchNarrative(b: Break): MatchingStep[] {
  const txn = primaryTxn(b);
  const ref = str(b.details, "reference") ?? txn.reference ?? undefined;
  const ledgerMinor = str(b.details, "ledgerAmountMinor") ?? txn.amountMinor;
  const externalMinor = str(b.details, "externalAmountMinor") ?? counterpart(b)?.amountMinor;
  const deltaMinor =
    str(b.details, "deltaMinor") ??
    (externalMinor !== undefined
      ? (BigInt(ledgerMinor) - BigInt(externalMinor) < 0n
          ? BigInt(externalMinor) - BigInt(ledgerMinor)
          : BigInt(ledgerMinor) - BigInt(externalMinor)
        ).toString()
      : undefined);
  const cur = txn.currency;
  const sides =
    externalMinor !== undefined
      ? `Ledger ${absMoney(ledgerMinor, cur)} vs source ${absMoney(externalMinor, cur)} — `
      : "";
  return [
    {
      label: "Exact-reference pass",
      detail: ref
        ? `Both sides cite \`${ref}\` — paired, but the amounts disagree.`
        : "Both sides pair, but the amounts disagree.",
      pass: true,
    },
    {
      label: "Tolerance check",
      // The break records the amounts, not the run's tolerance — so we state the
      // delta and that it exceeded tolerance, never a tolerance figure we don't have.
      detail: deltaMinor
        ? `${sides}a ${absMoney(deltaMinor, cur)} delta beyond the run's tolerance → break.`
        : "The delta exceeds the run's tolerance → break.",
      pass: false,
    },
  ];
}

function duplicateNarrative(b: Break): MatchingStep[] {
  const txn = primaryTxn(b);
  const side = str(b.details, "side") ?? txn.source;
  const ref = str(b.details, "reference") ?? txn.reference;
  return [
    {
      label: "Duplicate sweep",
      detail: ref
        ? `Two ${sourceLabel(side)} entries cite the same reference \`${ref}\`, identical amount — the later one appears twice.`
        : `A second ${sourceLabel(side)} entry repeats this one, identical amount.`,
      pass: false,
    },
    {
      label: "Resolution rule",
      detail: "Earlier-landed entry kept as primary; this later entry flagged as the duplicate.",
      pass: false,
    },
  ];
}

function unexpectedFeeNarrative(b: Break): MatchingStep[] {
  const txn = primaryTxn(b);
  const ref = txn.reference ?? str(b.details, "reference");
  return [
    survivedSweep(txn.source),
    {
      label: "Fee schedule check",
      detail: "No fee schedule entry anticipates this charge for the period.",
      pass: false,
    },
    {
      label: "Exact-reference pass",
      detail: ref ? `No ledger entry cites reference \`${ref}\`.` : "No ledger entry references it.",
      pass: false,
    },
    settlementLag,
  ];
}

function fxDriftNarrative(b: Break): MatchingStep[] {
  const fx = obj(b.details, "fx");
  const rate = fx !== undefined && typeof fx.rate === "string" ? fx.rate : undefined;
  const groupKey = str(b.details, "groupKey");
  const source = str(b.details, "source") ?? primaryTxn(b).source;
  const anchorNet = str(b.details, "anchorNetMinor");
  const partsNet = str(b.details, "partsNetMinor");
  const cur = primaryTxn(b).currency;

  const rateLine =
    rate !== undefined && anchorNet !== undefined && partsNet !== undefined
      ? `At the recorded rate ${rate} the lines net to ${formatMoney(partsNet, cur)}, but the booking records ${formatMoney(anchorNet, cur)}.`
      : rate !== undefined
        ? `The booking implies a rate that disagrees with the run's recorded ${rate}.`
        : "The booking implies a rate that disagrees with the run's recorded rate.";

  return [
    {
      label: "Grouped-reference pass",
      detail: groupKey
        ? `The ${sourceLabel(source)} lines net to the booking \`${groupKey}\` by reference.`
        : `The ${sourceLabel(source)} legs pair with the booking by reference.`,
      pass: true,
    },
    { label: "Rate check", detail: rateLine, pass: false },
    {
      label: "Tolerance check",
      detail: "Drift exceeds the run's rate tolerance → break.",
      pass: false,
    },
  ];
}

/** The ordered "what matching tried" steps for a break, derived from its type + details. */
export function matchingNarrative(b: Break): MatchingStep[] {
  switch (b.type) {
    case "missing_in_ledger":
      return missingNarrative(b, "ledger");
    case "missing_in_source":
    case "missing_in_stripe":
      return missingNarrative(b, "source");
    case "amount_mismatch":
      return amountMismatchNarrative(b);
    case "duplicate_candidate":
      return duplicateNarrative(b);
    case "unexpected_fee":
      return unexpectedFeeNarrative(b);
    case "fx_drift":
      return fxDriftNarrative(b);
  }
}

/** The plain-English one-liner naming the primary id and amount (worklist + hero header). */
export function headlineFor(b: Break): string {
  const txn = primaryTxn(b);
  const money = absMoney(txn.amountMinor, txn.currency);
  const ref = str(b.details, "reference") ?? txn.reference ?? txn.sourceId;
  switch (b.type) {
    case "missing_in_ledger":
      return `${sourceLabel(txn.source)} ${txn.type} \`${txn.sourceId}\` (${money}) has no ledger counterpart.`;
    case "missing_in_source":
    case "missing_in_stripe":
      return `Ledger entry \`${txn.sourceId}\` (${money}) has no counterpart in the sources.`;
    case "amount_mismatch":
      return `Ledger and source cite \`${ref}\` but disagree on the amount.`;
    case "duplicate_candidate":
      return `${sourceLabel(txn.source)} entry \`${txn.sourceId}\` (${money}) appears twice.`;
    case "unexpected_fee":
      return `${sourceLabel(txn.source)} fee \`${txn.sourceId}\` (${money}) was never anticipated by the books.`;
    case "fx_drift":
      return `The ${sourceLabel(str(b.details, "source") ?? txn.source)} settlement \`${str(b.details, "groupKey") ?? ref}\` disagrees with the recorded rate.`;
  }
}

/** The five provenance hops, in order, ready for the spine to render. */
export function buildEvidenceChain(input: {
  break: Break;
  transaction: TransactionWithVersions | null;
  raw: RawWithBatch | null;
}): EvidenceHop[] {
  const b = input.break;
  return [
    { kind: "conclusion", title: "Conclusion", type: b.type, typeLabel: TYPE_LABEL[b.type], gloss: GLOSS[b.type] },
    { kind: "matching", title: "What matching tried", steps: matchingNarrative(b) },
    { kind: "transaction", title: "The transaction", primary: primaryTxn(b), transaction: input.transaction },
    { kind: "raw", title: "The raw record", raw: input.raw },
    { kind: "batch", title: "The ingestion batch", batch: input.raw?.batch ?? null },
  ];
}
