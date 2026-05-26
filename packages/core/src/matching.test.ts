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

function consumedIds(result: ReconcileResult): string[] {
  return [
    ...result.matches.flatMap((m) => m.members.map((r) => r.id)),
    ...result.breaks.flatMap((b) => (b.details.txns as BreakTxnDetail[]).map((t) => t.id)),
  ];
}

function serialize(result: ReconcileResult): string {
  return JSON.stringify(result);
}

describe("reconcile — ruleset-v1 invariants", () => {
  it("partitions every transaction into exactly one match or break", () => {
    fc.assert(
      fc.property(arbSide("ledger"), arbSide("stripe"), (ledger, stripe) => {
        const result = reconcile(ledger, stripe, CONFIG);
        const ids = consumedIds(result);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual([...ledger, ...stripe].map((t) => t.id).sort());
      }),
    );
  });

  it("never puts a transaction in two matches", () => {
    fc.assert(
      fc.property(arbSide("ledger"), arbSide("stripe"), (ledger, stripe) => {
        const { matches } = reconcile(ledger, stripe, CONFIG);
        const memberIds = matches.flatMap((m) => m.members.map((r) => r.id));
        expect(new Set(memberIds).size).toBe(memberIds.length);
      }),
    );
  });

  it("every match pairs one txn per side with equal amount and currency", () => {
    fc.assert(
      fc.property(arbSide("ledger"), arbSide("stripe"), (ledger, stripe) => {
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
      fc.property(arbSide("ledger"), arbSide("stripe"), (ledger, stripe) => {
        const forward = reconcile(ledger, stripe, CONFIG);
        const reversed = reconcile([...ledger].reverse(), [...stripe].reverse(), CONFIG);
        expect(serialize(reversed)).toBe(serialize(forward));
      }),
    );
  });

  it("amount_mismatch only arises from a shared reference with unequal amounts", () => {
    fc.assert(
      fc.property(arbSide("ledger"), arbSide("stripe"), (ledger, stripe) => {
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
