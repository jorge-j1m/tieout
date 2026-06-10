import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  reconcile,
  type BreakTxnDetail,
  type MatchableTxn,
  type MatchingConfig,
  type ReconcileResult,
} from "./matching.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BASE = new Date("2026-05-10T12:00:00Z");
const AS_OF = new Date("2026-06-01T00:00:00Z");
const CONFIG: MatchingConfig = { windowMs: 2 * DAY_MS, asOf: AS_OF };

function txn(over: Partial<MatchableTxn> & { id: string; source: string }): MatchableTxn {
  const amountMinor = over.amountMinor ?? 1000n;
  return {
    version: 1,
    sourceAccount: "acct_main",
    sourceId: over.id,
    type: "payment",
    status: "settled",
    amountMinor,
    netMinor: amountMinor,
    currency: "USD",
    occurredAt: BASE,
    reference: null,
    groupRef: null,
    ...over,
  };
}

const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

describe("reconcile — stage 1 behaviors carried into ruleset-v2", () => {
  it("matches 1:1 on exact reference when amounts agree", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_1", amountMinor: 5000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_1", amountMinor: 5000n });
    const { matches, breaks, pending } = reconcile([l], [s], CONFIG);
    expect(breaks).toEqual([]);
    expect(pending).toEqual([]);
    expect(matches).toEqual([
      {
        kind: "exact_reference",
        members: [
          { id: "l1", version: 1 },
          { id: "s1", version: 1 },
        ],
      },
    ]);
  });

  it("turns a shared reference with different amounts into amount_mismatch", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_1", amountMinor: 5000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_1", amountMinor: 4990n });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: "amount_mismatch",
      details: { reference: "ch_1", ledgerAmountMinor: "5000", externalAmountMinor: "4990" },
    });
  });

  it("falls back to amount+currency within the date window, preferring nearest in time", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 7777n });
    const sFar = txn({ id: "s_far", source: "stripe", amountMinor: 7777n, occurredAt: at(DAY_MS) });
    const sNear = txn({ id: "s_near", source: "stripe", amountMinor: 7777n, occurredAt: at(-HOUR_MS) });
    const { matches, breaks } = reconcile([l], [sFar, sNear], CONFIG);
    expect(matches).toEqual([
      {
        kind: "amount_date_window",
        members: [
          { id: "l1", version: 1 },
          { id: "s_near", version: 1 },
        ],
      },
    ]);
    expect(breaks).toEqual([
      { type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s_far" })] } },
    ]);
  });

  it("does not fallback-match outside the window", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 7777n });
    const s = txn({ id: "s1", source: "stripe", amountMinor: 7777n, occurredAt: at(3 * DAY_MS) });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks.map((b) => b.type).sort()).toEqual(["missing_in_ledger", "missing_in_source"]);
  });

  it("flags same-side duplicate references and keeps the canonical first occurrence matchable", () => {
    const l1 = txn({ id: "l1", source: "ledger", reference: "ch_dup", amountMinor: 3000n });
    const l2 = txn({ id: "l2", source: "ledger", reference: "ch_dup", amountMinor: 3000n, occurredAt: at(60_000) });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_dup", amountMinor: 3000n });
    const { matches, breaks } = reconcile([l1, l2], [s], CONFIG);
    expect(matches).toEqual([
      {
        kind: "exact_reference",
        members: [
          { id: "l1", version: 1 },
          { id: "s1", version: 1 },
        ],
      },
    ]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: "duplicate_candidate",
      details: { side: "ledger", reference: "ch_dup" },
    });
    expect((breaks[0]!.details.txns as BreakTxnDetail[])[0]!.id).toBe("l2");
  });

  it("types leftovers by the side they are missing from", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_only_ledger", amountMinor: 100n });
    const s = txn({ id: "s1", source: "stripe", reference: "ord_77", amountMinor: 200n });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks).toEqual([
      { type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s1" })] } },
      { type: "missing_in_source", details: { txns: [expect.objectContaining({ id: "l1" })] } },
    ]);
  });

  it("classifies a leftover external fee as unexpected_fee", () => {
    const s = txn({ id: "s1", source: "stripe", reference: "fee_radar", amountMinor: -850n, type: "fee" });
    const { breaks } = reconcile([], [s], CONFIG);
    expect(breaks).toEqual([
      { type: "unexpected_fee", details: { txns: [expect.objectContaining({ id: "s1" })] } },
    ]);
  });
});

describe("reconcile — tie-breaking and ambiguity", () => {
  it("equidistant fallback candidates: the canonically earlier one wins", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 4321n });
    const sBefore = txn({ id: "s_before", source: "stripe", amountMinor: 4321n, occurredAt: at(-2 * HOUR_MS) });
    const sAfter = txn({ id: "s_after", source: "stripe", amountMinor: 4321n, occurredAt: at(2 * HOUR_MS) });
    const { matches, breaks } = reconcile([l], [sAfter, sBefore], CONFIG);
    expect(matches).toEqual([
      {
        kind: "amount_date_window",
        members: [
          { id: "l1", version: 1 },
          { id: "s_before", version: 1 },
        ],
      },
    ]);
    expect(breaks).toEqual([
      { type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s_after" })] } },
    ]);
  });

  it("equidistant candidates at the same instant: the smaller sourceId wins", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 4321n });
    const sB = txn({ id: "s_b", source: "stripe", amountMinor: 4321n, occurredAt: at(HOUR_MS) });
    const sA = txn({ id: "s_a", source: "stripe", amountMinor: 4321n, occurredAt: at(HOUR_MS) });
    const { matches } = reconcile([l], [sB, sA], CONFIG);
    expect(matches).toEqual([
      {
        kind: "amount_date_window",
        members: [
          { id: "l1", version: 1 },
          { id: "s_a", version: 1 },
        ],
      },
    ]);
  });

  it("N same-amount records vs N−1 counterparts: ledger claims nearest in canonical order, one break remains", () => {
    const ls = [0, 1, 2].map((i) =>
      txn({ id: `l${i}`, source: "ledger", amountMinor: 7250n, occurredAt: at(i * HOUR_MS) }),
    );
    const s0 = txn({ id: "s0", source: "stripe", amountMinor: 7250n, occurredAt: at(30 * 60_000) });
    const s1 = txn({ id: "s1", source: "stripe", amountMinor: 7250n, occurredAt: at(90 * 60_000) });
    const { matches, breaks } = reconcile(ls, [s1, s0], CONFIG);
    expect(matches).toEqual([
      {
        kind: "amount_date_window",
        members: [
          { id: "l0", version: 1 },
          { id: "s0", version: 1 },
        ],
      },
      {
        kind: "amount_date_window",
        members: [
          { id: "l1", version: 1 },
          { id: "s1", version: 1 },
        ],
      },
    ]);
    expect(breaks).toEqual([
      { type: "missing_in_source", details: { txns: [expect.objectContaining({ id: "l2" })] } },
    ]);
  });

  it("pass 1 duplicate sweep with identical timestamps keeps the smaller sourceId", () => {
    const lA = txn({ id: "l_a", source: "ledger", reference: "ch_dup", amountMinor: 3000n });
    const lB = txn({ id: "l_b", source: "ledger", reference: "ch_dup", amountMinor: 3000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_dup", amountMinor: 3000n });
    const { matches, breaks } = reconcile([lB, lA], [s], CONFIG);
    expect(matches).toEqual([
      {
        kind: "exact_reference",
        members: [
          { id: "l_a", version: 1 },
          { id: "s1", version: 1 },
        ],
      },
    ]);
    expect(breaks).toHaveLength(1);
    expect((breaks[0]!.details.txns as BreakTxnDetail[])[0]!.id).toBe("l_b");
  });

  it("a referenced ledger entry whose claim failed never pairs by amount coincidence", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_gone", amountMinor: 5151n });
    const s = txn({ id: "s1", source: "stripe", amountMinor: 5151n, occurredAt: at(HOUR_MS) });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks.map((b) => b.type).sort()).toEqual(["missing_in_ledger", "missing_in_source"]);
  });
});

describe("reconcile — reference-less double-posts", () => {
  const s = () => txn({ id: "s1", source: "stripe", amountMinor: 8421n });
  const post1 = () => txn({ id: "l_post1", source: "ledger", amountMinor: 8421n, occurredAt: at(30 * 60_000) });
  const post2 = () => txn({ id: "l_post2", source: "ledger", amountMinor: 8421n, occurredAt: at(31 * 60_000) });

  it("without the heuristic, the survivor reads missing_in_source (conservative default)", () => {
    const { matches, breaks } = reconcile([post2(), post1()], [s()], CONFIG);
    expect(matches).toHaveLength(1);
    expect(breaks).toEqual([
      { type: "missing_in_source", details: { txns: [expect.objectContaining({ id: "l_post2" })] } },
    ]);
  });

  it("with the heuristic, the survivor is relabeled duplicate_candidate naming its matched twin", () => {
    const { matches, breaks } = reconcile([post2(), post1()], [s()], {
      ...CONFIG,
      duplicateWindowMs: HOUR_MS,
    });
    expect(matches).toHaveLength(1);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: "duplicate_candidate",
      details: {
        heuristic: "referenceless_double_post",
        kept: expect.objectContaining({ id: "l_post1" }),
      },
    });
    expect((breaks[0]!.details.txns as BreakTxnDetail[])[0]!.id).toBe("l_post2");
  });

  it("the heuristic never fires across the window or across amounts", () => {
    const farPost = txn({ id: "l_far", source: "ledger", amountMinor: 8421n, occurredAt: at(5 * HOUR_MS) });
    const { breaks } = reconcile([post1(), farPost], [s()], { ...CONFIG, duplicateWindowMs: HOUR_MS });
    expect(breaks).toEqual([
      { type: "missing_in_source", details: { txns: [expect.objectContaining({ id: "l_far" })] } },
    ]);
  });
});

describe("reconcile — tolerances are explicit and recorded", () => {
  it("a reference pair within toleranceMinor matches, recording delta and tolerance", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_1", amountMinor: 5000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_1", amountMinor: 4999n });
    const { matches, breaks } = reconcile([l], [s], { ...CONFIG, toleranceMinor: 1n });
    expect(breaks).toEqual([]);
    expect(matches).toEqual([
      {
        kind: "exact_reference",
        members: [
          { id: "l1", version: 1 },
          { id: "s1", version: 1 },
        ],
        details: { deltaMinor: "1", toleranceMinor: "1" },
      },
    ]);
  });

  it("one minor unit past the tolerance is amount_mismatch, exactly as before", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_1", amountMinor: 5000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_1", amountMinor: 4998n });
    const { matches, breaks } = reconcile([l], [s], { ...CONFIG, toleranceMinor: 1n });
    expect(matches).toEqual([]);
    expect(breaks[0]).toMatchObject({ type: "amount_mismatch" });
  });
});

describe("reconcile — transfer legs (payout ↔ deposit)", () => {
  it("payout/deposit legs sum to zero and match with the rule recorded", () => {
    const deposit = txn({ id: "l1", source: "ledger", reference: "po_1", amountMinor: 250_000n, type: "payout" });
    const payout = txn({ id: "s1", source: "stripe", reference: "po_1", amountMinor: -250_000n, type: "payout" });
    const { matches, breaks } = reconcile([deposit], [payout], CONFIG);
    expect(breaks).toEqual([]);
    expect(matches).toEqual([
      {
        kind: "exact_reference",
        members: [
          { id: "l1", version: 1 },
          { id: "s1", version: 1 },
        ],
        details: { rule: "transfer_legs" },
      },
    ]);
  });

  it("legs that do not sum to zero are amount_mismatch", () => {
    const deposit = txn({ id: "l1", source: "ledger", reference: "po_1", amountMinor: 250_000n, type: "payout" });
    const payout = txn({ id: "s1", source: "stripe", reference: "po_1", amountMinor: -249_000n, type: "payout" });
    const { matches, breaks } = reconcile([deposit], [payout], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks[0]).toMatchObject({ type: "amount_mismatch" });
  });
});

describe("reconcile — grouped settlement (N:1, net basis)", () => {
  const anchor = (net: bigint, over: Partial<MatchableTxn> = {}) =>
    txn({ id: "l_settle", source: "ledger", reference: "PL-2026-05-21", amountMinor: net, ...over });
  const line = (id: string, amount: bigint, net: bigint, over: Partial<MatchableTxn> = {}) =>
    txn({ id, source: "pagolat", amountMinor: amount, netMinor: net, groupRef: "PL-2026-05-21", ...over });

  it("groups lines against the anchor on nets and records the group facts", () => {
    const parts = [line("p1", 10_000n, 9_700n), line("p2", 20_000n, 19_400n), line("p3", 5_000n, 4_850n)];
    const { matches, breaks } = reconcile([anchor(33_950n)], parts, CONFIG);
    expect(breaks).toEqual([]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: "grouped_reference",
      details: {
        groupKey: "PL-2026-05-21",
        source: "pagolat",
        partCount: 3,
        anchorNetMinor: "33950",
        partsNetMinor: "33950",
      },
    });
    expect(matches[0]!.members.map((m) => m.id).sort()).toEqual(["l_settle", "p1", "p2", "p3"]);
  });

  it("a group sum off beyond tolerance is amount_mismatch consuming the whole group", () => {
    const parts = [line("p1", 10_000n, 9_700n), line("p2", 20_000n, 19_400n)];
    const { matches, breaks } = reconcile([anchor(29_000n)], parts, CONFIG);
    expect(matches).toEqual([]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ type: "amount_mismatch", details: { deltaMinor: "100" } });
    expect((breaks[0]!.details.txns as BreakTxnDetail[]).map((t) => t.id).sort()).toEqual([
      "l_settle",
      "p1",
      "p2",
    ]);
  });

  it("a mismatch explained exactly by fee members is unexpected_fee naming the fees", () => {
    const parts = [
      line("p1", 10_000n, 9_700n),
      line("p_fee", -300n, -300n, { type: "fee", sourceId: "pl_account_fee" }),
    ];
    // The booking expected 9,700 — the line net without the surprise account fee.
    const { matches, breaks } = reconcile([anchor(9_700n)], parts, CONFIG);
    expect(matches).toEqual([]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: "unexpected_fee",
      details: { feeNetMinor: "-300", fees: [expect.objectContaining({ id: "p_fee" })] },
    });
  });

  it("group members never leak into other passes when the anchor is missing", () => {
    const parts = [line("p1", 10_000n, 9_700n), line("p2", 20_000n, 19_400n)];
    const { matches, breaks } = reconcile([], parts, CONFIG);
    expect(matches).toEqual([]);
    expect(breaks.map((b) => b.type)).toEqual(["missing_in_ledger", "missing_in_ledger"]);
  });

  it("converts cross-currency groups with the run's recorded rate", () => {
    const parts = [line("p1", 100_000n, 97_000n, { currency: "MXN" }), line("p2", 50_000n, 48_500n, { currency: "MXN" })];
    // 1,455.00 MXN net at 0.0588 = 85.554 → 85.55 USD (half-even).
    const { matches, breaks } = reconcile(
      [anchor(8_555n)],
      parts,
      {
        ...CONFIG,
        fx: {
          rates: [{ base: "MXN", quote: "USD", rate: "0.0588", rateSource: "test", rateDate: "2026-05-21" }],
          toleranceBps: 10,
        },
      },
    );
    expect(breaks).toEqual([]);
    expect(matches[0]).toMatchObject({
      kind: "grouped_reference",
      details: {
        partsNetMinor: "8555",
        fx: { rate: "0.0588", rateBase: "MXN", rateQuote: "USD", rateSource: "test" },
      },
    });
  });

  it("a cross-currency mismatch explained exactly by fee members is unexpected_fee, not fx_drift", () => {
    const parts = [
      line("p1", 100_000n, 97_500n, { currency: "MXN" }),
      line("p_fee", -25_000n, -25_000n, { currency: "MXN", type: "fee", sourceId: "pl_fee" }),
    ];
    // The booking expects convert(97,500) = 5,733; the fee drags the group to
    // convert(72,500) = 4,263 — residual = convert(25,000) exactly.
    const { matches, breaks } = reconcile(
      [anchor(5_733n)],
      parts,
      {
        ...CONFIG,
        fx: {
          rates: [{ base: "MXN", quote: "USD", rate: "0.0588", rateSource: "test", rateDate: "2026-05-21" }],
          toleranceBps: 10,
        },
      },
    );
    expect(matches).toEqual([]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: "unexpected_fee",
      details: { feeNetMinor: "-1470", fees: [expect.objectContaining({ id: "p_fee" })] },
    });
  });

  it("cross-currency drift beyond the bps tolerance is fx_drift, not amount_mismatch", () => {
    const parts = [line("p1", 100_000n, 97_000n, { currency: "MXN" })];
    // 970.00 MXN at 0.0588 = 57.04 USD; booked 58.00 → ~168 bps off.
    const { matches, breaks } = reconcile(
      [anchor(5_800n)],
      parts,
      {
        ...CONFIG,
        fx: {
          rates: [{ base: "MXN", quote: "USD", rate: "0.0588", rateSource: "test", rateDate: "2026-05-21" }],
          toleranceBps: 10,
        },
      },
    );
    expect(matches).toEqual([]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ type: "fx_drift" });
  });

  it("a needed rate that was not configured fails the run loudly", () => {
    const parts = [line("p1", 100_000n, 97_000n, { currency: "MXN" })];
    expect(() => reconcile([anchor(5_800n)], parts, CONFIG)).toThrow(/no fx rate configured/);
  });
});

describe("reconcile — settlement lag (pending, not breaks)", () => {
  it("an unmatched external record inside its source's lag window is pending", () => {
    const s = txn({ id: "s1", source: "stripe", reference: "ch_late", occurredAt: new Date(AS_OF.getTime() - DAY_MS) });
    const { breaks, pending } = reconcile([], [s], {
      ...CONFIG,
      lagMsBySource: { stripe: 2 * DAY_MS },
    });
    expect(breaks).toEqual([]);
    expect(pending).toEqual([
      { ref: { id: "s1", version: 1 }, source: "stripe", sourceId: "s1", remainingLagMs: DAY_MS },
    ]);
  });

  it("past the window the same data is a break — the asOf clock decides", () => {
    const s = txn({ id: "s1", source: "stripe", reference: "ch_late", occurredAt: new Date(AS_OF.getTime() - 3 * DAY_MS) });
    const { breaks, pending } = reconcile([], [s], {
      ...CONFIG,
      lagMsBySource: { stripe: 2 * DAY_MS },
    });
    expect(pending).toEqual([]);
    expect(breaks).toEqual([
      { type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s1" })] } },
    ]);
  });

  it("ledger entries awaiting settlement go pending under the ledger's window", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_pending", occurredAt: new Date(AS_OF.getTime() - DAY_MS) });
    const { breaks, pending } = reconcile([l], [], {
      ...CONFIG,
      lagMsBySource: { ledger: 2 * DAY_MS },
    });
    expect(breaks).toEqual([]);
    expect(pending).toHaveLength(1);
  });

  it("no lag configured means no pending — stage 1 behavior", () => {
    const s = txn({ id: "s1", source: "stripe", occurredAt: new Date(AS_OF.getTime() - 1000) });
    const { breaks, pending } = reconcile([], [s], CONFIG);
    expect(pending).toEqual([]);
    expect(breaks).toHaveLength(1);
  });
});

// --- Property tests -------------------------------------------------------

// Small pools of amounts/references/timestamps force collisions: duplicates,
// mismatches, and fallback candidates all occur organically.
const arbSide = (source: string) =>
  fc
    .array(
      fc.record({
        amountIdx: fc.integer({ min: 0, max: 8 }),
        minuteOffset: fc.integer({ min: 0, max: 12 * 24 * 60 }),
        refIdx: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
        mismatch: fc.boolean(),
      }),
      { maxLength: 25 },
    )
    .map((items) =>
      items.map((it, i): MatchableTxn => {
        const amountMinor = 5_000n + BigInt(it.amountIdx) * 137n + (it.mismatch ? 1n : 0n);
        return {
          id: `${source}_${i}`,
          version: 1,
          source,
          sourceAccount: "acct_main",
          sourceId: `${source}_sid_${i}`,
          type: "payment",
          status: "settled",
          amountMinor,
          netMinor: amountMinor,
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + it.minuteOffset * 60_000),
          reference: it.refIdx === null ? null : `ref_${it.refIdx}`,
          groupRef: null,
        };
      }),
    );

// A 2-hour time grid with tiny pools: exact ties and equidistant candidates occur
// by construction, not by luck — the tie-break rules get property coverage too.
const arbTieSide = (source: string) =>
  fc
    .array(
      fc.record({
        amountIdx: fc.integer({ min: 0, max: 3 }),
        hourSlot: fc.integer({ min: 0, max: 6 }),
        refIdx: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
        mismatch: fc.boolean(),
      }),
      { maxLength: 25 },
    )
    .map((items) =>
      items.map((it, i): MatchableTxn => {
        const amountMinor = 5_000n + BigInt(it.amountIdx) * 137n + (it.mismatch ? 1n : 0n);
        return {
          id: `${source}_${i}`,
          version: 1,
          source,
          sourceAccount: "acct_main",
          sourceId: `${source}_sid_${i}`,
          type: "payment",
          status: "settled",
          amountMinor,
          netMinor: amountMinor,
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + it.hourSlot * 2 * HOUR_MS),
          reference: it.refIdx === null ? null : `ref_${it.refIdx}`,
          groupRef: null,
        };
      }),
    );

// Settlement-shaped scenarios: groups whose anchors book the exact net sum, a
// corrupted anchor, surprise fee members — grouped matching under pressure.
interface GroupScenario {
  ledger: MatchableTxn[];
  external: MatchableTxn[];
}

const arbGroups: fc.Arbitrary<GroupScenario> = fc
  .array(
    fc.record({
      partNets: fc.array(fc.bigInt({ min: 1n, max: 1_000_000n }), { minLength: 1, maxLength: 6 }),
      anchorPresent: fc.boolean(),
      corruptBy: fc.option(fc.bigInt({ min: 1n, max: 999n }), { nil: null }),
      surpriseFee: fc.option(fc.bigInt({ min: 1n, max: 500n }), { nil: null }),
    }),
    { maxLength: 6 },
  )
  .map((specs) => {
    const ledger: MatchableTxn[] = [];
    const external: MatchableTxn[] = [];
    specs.forEach((spec, g) => {
      const key = `PL-G${g}`;
      let net = 0n;
      spec.partNets.forEach((partNet, i) => {
        net += partNet;
        external.push({
          id: `e_g${g}_${i}`,
          version: 1,
          source: "pagolat",
          sourceAccount: "mx-merchant",
          sourceId: `e_g${g}_${i}`,
          type: "payment",
          status: "settled",
          amountMinor: partNet + 100n,
          netMinor: partNet,
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + g * HOUR_MS),
          reference: null,
          groupRef: key,
        });
      });
      if (spec.surpriseFee !== null) {
        external.push({
          id: `e_g${g}_fee`,
          version: 1,
          source: "pagolat",
          sourceAccount: "mx-merchant",
          sourceId: `e_g${g}_fee`,
          type: "fee",
          status: "settled",
          amountMinor: -spec.surpriseFee,
          netMinor: -spec.surpriseFee,
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + g * HOUR_MS),
          reference: null,
          groupRef: key,
        });
      }
      if (spec.anchorPresent) {
        ledger.push({
          id: `l_g${g}`,
          version: 1,
          source: "ledger",
          sourceAccount: "acct_main",
          sourceId: `l_g${g}`,
          type: "payment",
          status: "settled",
          // Books the clean net sum; corruption and surprise fees make it disagree.
          amountMinor: net + (spec.corruptBy ?? 0n),
          netMinor: net + (spec.corruptBy ?? 0n),
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + g * HOUR_MS),
          reference: key,
          groupRef: null,
        });
      }
    });
    return { ledger, external };
  });

function consumedIds(result: ReconcileResult): string[] {
  return [
    ...result.matches.flatMap((m) => m.members.map((r) => r.id)),
    ...result.breaks.flatMap((b) => (b.details.txns as BreakTxnDetail[]).map((t) => t.id)),
    ...result.pending.map((p) => p.ref.id),
  ];
}

function serialize(result: ReconcileResult): string {
  return JSON.stringify(result);
}

const POOLS = [
  ["collision pool", arbSide],
  ["tie pool", arbTieSide],
] as const;

for (const [pool, side] of POOLS) {
  describe(`reconcile — ruleset-v2 invariants (${pool})`, () => {
    it("partitions every transaction into exactly one match, break, or pending", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, external) => {
          const result = reconcile(ledger, external, CONFIG);
          const ids = consumedIds(result);
          expect(new Set(ids).size).toBe(ids.length);
          expect([...ids].sort()).toEqual([...ledger, ...external].map((t) => t.id).sort());
        }),
      );
    });

    it("never puts a transaction in two matches", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, external) => {
          const { matches } = reconcile(ledger, external, CONFIG);
          const memberIds = matches.flatMap((m) => m.members.map((r) => r.id));
          expect(new Set(memberIds).size).toBe(memberIds.length);
        }),
      );
    });

    it("every 1:1 match pairs one txn per side with equal amount and currency", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, external) => {
          const byId = new Map([...ledger, ...external].map((t) => [t.id, t]));
          const { matches } = reconcile(ledger, external, CONFIG);
          for (const m of matches) {
            expect(m.members).toHaveLength(2);
            const txns = m.members.map((r) => byId.get(r.id)!);
            expect(txns.map((t) => t.source).sort()).toEqual(["ledger", "stripe"]);
            expect(txns[0]!.amountMinor).toBe(txns[1]!.amountMinor);
            expect(txns[0]!.currency).toBe(txns[1]!.currency);
          }
        }),
      );
    });

    it("is deterministic: input order never changes the result", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, external) => {
          const forward = reconcile(ledger, external, CONFIG);
          const reversed = reconcile([...ledger].reverse(), [...external].reverse(), CONFIG);
          expect(serialize(reversed)).toBe(serialize(forward));
        }),
      );
    });

    it("amount_mismatch only arises from a shared reference with unequal amounts", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, external) => {
          const byId = new Map([...ledger, ...external].map((t) => [t.id, t]));
          const { breaks } = reconcile(ledger, external, CONFIG);
          for (const b of breaks) {
            if (b.type !== "amount_mismatch") continue;
            const txns = (b.details.txns as BreakTxnDetail[]).map((d) => byId.get(d.id)!);
            expect(txns[0]!.reference).toBe(txns[1]!.reference);
            expect(txns[0]!.amountMinor === txns[1]!.amountMinor && txns[0]!.currency === txns[1]!.currency).toBe(false);
          }
        }),
      );
    });
  });
}

describe("reconcile — ruleset-v2 invariants (grouped pool)", () => {
  it("partitions every transaction exactly once, groups included", () => {
    fc.assert(
      fc.property(arbGroups, ({ ledger, external }) => {
        const result = reconcile(ledger, external, CONFIG);
        const ids = consumedIds(result);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual([...ledger, ...external].map((t) => t.id).sort());
      }),
    );
  });

  it("group sums are preserved: every grouped match's parts sum to its anchor's net", () => {
    fc.assert(
      fc.property(arbGroups, ({ ledger, external }) => {
        const byId = new Map([...ledger, ...external].map((t) => [t.id, t]));
        const { matches } = reconcile(ledger, external, CONFIG);
        for (const m of matches) {
          if (m.kind !== "grouped_reference") continue;
          const members = m.members.map((r) => byId.get(r.id)!);
          const anchor = members.find((t) => t.source === "ledger")!;
          const parts = members.filter((t) => t.source !== "ledger");
          expect(parts.length).toBeGreaterThan(0);
          expect(parts.reduce((n, t) => n + t.netMinor, 0n)).toBe(anchor.netMinor);
        }
      }),
    );
  });

  it("clean groups always match; corrupted ones always break, fee-explained ones precisely", () => {
    fc.assert(
      fc.property(arbGroups, ({ ledger, external }) => {
        const { matches, breaks } = reconcile(ledger, external, CONFIG);
        const anchors = new Set(ledger.map((l) => l.reference));
        const groupKeys = new Set(external.map((t) => t.groupRef).filter(Boolean));
        for (const key of groupKeys) {
          if (!anchors.has(key as string)) continue;
          const matched = matches.some(
            (m) => m.kind === "grouped_reference" && m.details?.groupKey === key,
          );
          const broke = breaks.some((b) => b.details.groupKey === key);
          expect(matched !== broke, `group ${key} must match xor break`).toBe(true);
        }
      }),
    );
  });

  it("is deterministic over grouped scenarios too", () => {
    fc.assert(
      fc.property(arbGroups, ({ ledger, external }) => {
        const forward = reconcile(ledger, external, CONFIG);
        const reversed = reconcile([...ledger].reverse(), [...external].reverse(), CONFIG);
        expect(serialize(reversed)).toBe(serialize(forward));
      }),
    );
  });
});
