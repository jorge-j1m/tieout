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
const BASE = new Date("2026-05-10T12:00:00Z");
const CONFIG: MatchingConfig = { windowMs: 2 * DAY_MS };

function txn(over: Partial<MatchableTxn> & { id: string; source: string }): MatchableTxn {
  return {
    version: 1,
    sourceAccount: "acct_main",
    sourceId: over.id,
    type: "payment",
    status: "settled",
    amountMinor: 1000n,
    currency: "USD",
    occurredAt: BASE,
    reference: null,
    ...over,
  };
}

const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

describe("reconcile — ruleset-v1 behavior", () => {
  it("matches 1:1 on exact reference when amounts agree", () => {
    const l = txn({ id: "l1", source: "ledger", reference: "ch_1", amountMinor: 5000n });
    const s = txn({ id: "s1", source: "stripe", reference: "ch_1", amountMinor: 5000n });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(breaks).toEqual([]);
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
      details: { reference: "ch_1", ledgerAmountMinor: "5000", stripeAmountMinor: "4990" },
    });
  });

  it("falls back to amount+currency within the date window, preferring nearest in time", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 7777n });
    const sFar = txn({ id: "s_far", source: "stripe", amountMinor: 7777n, occurredAt: at(DAY_MS) });
    const sNear = txn({ id: "s_near", source: "stripe", amountMinor: 7777n, occurredAt: at(-3_600_000) });
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
    expect(breaks).toEqual([{ type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s_far" })] } }]);
  });

  it("does not fallback-match outside the window", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 7777n });
    const s = txn({ id: "s1", source: "stripe", amountMinor: 7777n, occurredAt: at(3 * DAY_MS) });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks.map((b) => b.type).sort()).toEqual(["missing_in_ledger", "missing_in_stripe"]);
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
    const s = txn({ id: "s1", source: "stripe", reference: "fee_only_stripe", amountMinor: -85n, type: "fee" });
    const { matches, breaks } = reconcile([l], [s], CONFIG);
    expect(matches).toEqual([]);
    expect(breaks).toEqual([
      { type: "missing_in_stripe", details: { txns: [expect.objectContaining({ id: "l1" })] } },
      { type: "missing_in_ledger", details: { txns: [expect.objectContaining({ id: "s1" })] } },
    ]);
  });
});

// --- Tie-breaking and ambiguity (the hard part, pinned) --------------------

describe("reconcile — tie-breaking and ambiguity", () => {
  it("equidistant fallback candidates: the canonically earlier one wins", () => {
    const l = txn({ id: "l1", source: "ledger", amountMinor: 4321n });
    const sBefore = txn({ id: "s_before", source: "stripe", amountMinor: 4321n, occurredAt: at(-2 * 3_600_000) });
    const sAfter = txn({ id: "s_after", source: "stripe", amountMinor: 4321n, occurredAt: at(2 * 3_600_000) });
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
    const sB = txn({ id: "s_b", source: "stripe", amountMinor: 4321n, occurredAt: at(3_600_000) });
    const sA = txn({ id: "s_a", source: "stripe", amountMinor: 4321n, occurredAt: at(3_600_000) });
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
      txn({ id: `l${i}`, source: "ledger", amountMinor: 7250n, occurredAt: at(i * 3_600_000) }),
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
      { type: "missing_in_stripe", details: { txns: [expect.objectContaining({ id: "l2" })] } },
    ]);
  });

  it("a reference-less double-post pairs one copy and reports the other missing_in_stripe — pinned until Stage 2 relabels it", () => {
    // A true double-post with no reference gives pass 1 nothing to sweep on; pass 3
    // pairs the nearer copy and the survivor reads as missing_in_stripe — the human
    // investigates "where is my money" instead of "we booked twice". Known Stage 1
    // labeling limit, planted in the seed manifest and noted in the stage-2 backlog.
    const s = txn({ id: "s1", source: "stripe", amountMinor: 8421n });
    const post1 = txn({ id: "l_post1", source: "ledger", amountMinor: 8421n, occurredAt: at(30 * 60_000) });
    const post2 = txn({ id: "l_post2", source: "ledger", amountMinor: 8421n, occurredAt: at(31 * 60_000) });
    const { matches, breaks } = reconcile([post2, post1], [s], CONFIG);
    expect(matches).toEqual([
      {
        kind: "amount_date_window",
        members: [
          { id: "l_post1", version: 1 },
          { id: "s1", version: 1 },
        ],
      },
    ]);
    expect(breaks).toEqual([
      { type: "missing_in_stripe", details: { txns: [expect.objectContaining({ id: "l_post2" })] } },
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
    expect(breaks[0]).toMatchObject({ type: "duplicate_candidate" });
    expect((breaks[0]!.details.txns as BreakTxnDetail[])[0]!.id).toBe("l_b");
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
      items.map(
        (it, i): MatchableTxn => ({
          id: `${source}_${i}`,
          version: 1,
          source,
          sourceAccount: "acct_main",
          sourceId: `${source}_sid_${i}`,
          type: "payment",
          status: "settled",
          amountMinor: 5_000n + BigInt(it.amountIdx) * 137n + (it.mismatch ? 1n : 0n),
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + it.minuteOffset * 60_000),
          reference: it.refIdx === null ? null : `ref_${it.refIdx}`,
        }),
      ),
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
      items.map(
        (it, i): MatchableTxn => ({
          id: `${source}_${i}`,
          version: 1,
          source,
          sourceAccount: "acct_main",
          sourceId: `${source}_sid_${i}`,
          type: "payment",
          status: "settled",
          amountMinor: 5_000n + BigInt(it.amountIdx) * 137n + (it.mismatch ? 1n : 0n),
          currency: "USD",
          occurredAt: new Date(BASE.getTime() + it.hourSlot * 2 * 3_600_000),
          reference: it.refIdx === null ? null : `ref_${it.refIdx}`,
        }),
      ),
    );

function consumedIds(result: ReconcileResult): string[] {
  return [
    ...result.matches.flatMap((m) => m.members.map((r) => r.id)),
    ...result.breaks.flatMap((b) => (b.details.txns as BreakTxnDetail[]).map((t) => t.id)),
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
  describe(`reconcile — ruleset-v1 invariants (${pool})`, () => {
    it("partitions every transaction into exactly one match or break", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, stripe) => {
          const result = reconcile(ledger, stripe, CONFIG);
          const ids = consumedIds(result);
          expect(new Set(ids).size).toBe(ids.length);
          expect([...ids].sort()).toEqual([...ledger, ...stripe].map((t) => t.id).sort());
        }),
      );
    });

    it("never puts a transaction in two matches", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, stripe) => {
          const { matches } = reconcile(ledger, stripe, CONFIG);
          const memberIds = matches.flatMap((m) => m.members.map((r) => r.id));
          expect(new Set(memberIds).size).toBe(memberIds.length);
        }),
      );
    });

    it("every match pairs one txn per side with equal amount and currency", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, stripe) => {
          const byId = new Map([...ledger, ...stripe].map((t) => [t.id, t]));
          const { matches } = reconcile(ledger, stripe, CONFIG);
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
        fc.property(side("ledger"), side("stripe"), (ledger, stripe) => {
          const forward = reconcile(ledger, stripe, CONFIG);
          const reversed = reconcile([...ledger].reverse(), [...stripe].reverse(), CONFIG);
          expect(serialize(reversed)).toBe(serialize(forward));
        }),
      );
    });

    it("amount_mismatch only arises from a shared reference with unequal amounts", () => {
      fc.assert(
        fc.property(side("ledger"), side("stripe"), (ledger, stripe) => {
          const byId = new Map([...ledger, ...stripe].map((t) => [t.id, t]));
          const { breaks } = reconcile(ledger, stripe, CONFIG);
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
