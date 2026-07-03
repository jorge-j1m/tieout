import type { Break, BreakTxnDetail } from "@tieout/contracts";

/**
 * Test fixtures shaped exactly as `packages/core/src/matching.ts` emits break
 * details (verified against its `breaks.push` sites) and as the seed's Mercadia
 * story tells them. If the engine's shapes change, these must change with it —
 * that is the point of testing against them.
 */

const txn = (over: Partial<BreakTxnDetail>): BreakTxnDetail => ({
  id: "11111111-0000-4000-8000-000000000001",
  version: 1,
  source: "stripe",
  sourceAccount: "acct_mercadia",
  sourceId: "txn_re_0014",
  type: "refund",
  amountMinor: "-6681",
  netMinor: "-6681",
  currency: "USD",
  occurredAt: "2026-05-14T18:22:00.000Z",
  reference: "ch_mercadia_0014",
  groupRef: null,
  ...over,
});

const base = {
  runId: "7e9b0611-0000-4000-8000-000000000000",
  createdAt: "2026-06-05T00:00:00.000Z",
};

/** The $66.81 Stripe refund nobody booked — the demo's hero break. */
export const missingInLedger: Break = {
  ...base,
  id: "brk-0014-0000-4000-8000-000000000001",
  type: "missing_in_ledger",
  fingerprint: "9f3ab2c1a04e",
  details: { txns: [txn({})] },
};

/** The $111.11 payment booked but never settled. */
export const missingInSource: Break = {
  ...base,
  id: "brk-ns01-0000-4000-8000-000000000002",
  type: "missing_in_source",
  fingerprint: "b207e51ac83d",
  details: {
    txns: [
      txn({
        source: "ledger",
        sourceAccount: "mercadia-books",
        sourceId: "LED-2026-NS01",
        type: "payment",
        amountMinor: "11111",
        netMinor: "11111",
        reference: "ord_mercadia_9981",
      }),
    ],
  },
};

/** 1:1 amount mismatch: both sides cite the reference, amounts differ by $7.50. */
export const amountMismatch: Break = {
  ...base,
  id: "brk-0030-0000-4000-8000-000000000003",
  type: "amount_mismatch",
  fingerprint: "71fbea205c93",
  details: {
    reference: "ord_mercadia_0030",
    ledgerAmountMinor: "50000",
    externalAmountMinor: "49250",
    txns: [
      txn({
        source: "ledger",
        sourceId: "LED-2026-0030",
        type: "payment",
        amountMinor: "50000",
        netMinor: "50000",
        reference: "ord_mercadia_0030",
      }),
      txn({
        id: "11111111-0000-4000-8000-000000000002",
        sourceId: "txn_ch_0030",
        type: "payment",
        amountMinor: "49250",
        netMinor: "49250",
        reference: "ord_mercadia_0030",
      }),
    ],
  },
};

/** The $85.99 double-post: kept the earlier entry, flagged the later one. */
export const duplicateCandidate: Break = {
  ...base,
  id: "brk-0028-0000-4000-8000-000000000004",
  type: "duplicate_candidate",
  fingerprint: "d5a913fc4b02",
  details: {
    side: "ledger",
    reference: "ord_mercadia_0028",
    kept: txn({
      source: "ledger",
      sourceId: "LED-2026-0028",
      type: "payment",
      amountMinor: "8599",
      netMinor: "8599",
      reference: "ord_mercadia_0028",
    }),
    txns: [
      txn({
        id: "11111111-0000-4000-8000-000000000003",
        source: "ledger",
        sourceId: "LED-2026-0028-DUP",
        type: "payment",
        amountMinor: "8599",
        netMinor: "8599",
        reference: "ord_mercadia_0028",
      }),
    ],
  },
};

/** The $8.50 Radar fee the books never anticipated (leftover form). */
export const unexpectedFee: Break = {
  ...base,
  id: "brk-fee1-0000-4000-8000-000000000005",
  type: "unexpected_fee",
  fingerprint: "5e12ab98d043",
  details: {
    txns: [
      txn({
        sourceId: "txn_fee_radar_0001",
        type: "fee",
        amountMinor: "-850",
        netMinor: "-850",
        reference: "fee_radar_mercadia_0001",
      }),
    ],
  },
};

/** The 05-23 PagoLat settlement whose booking implies a different rate (grouped form). */
export const fxDrift: Break = {
  ...base,
  id: "brk-fx23-0000-4000-8000-000000000006",
  type: "fx_drift",
  fingerprint: "0c9de24f7b18",
  details: {
    groupKey: "pagolat-day-2026-05-23",
    source: "pagolat",
    partCount: 3,
    anchorNetMinor: "17075",
    partsNetMinor: "16405",
    deltaMinor: "670",
    fx: {
      rate: "0.0588",
      rateBase: "MXN",
      rateQuote: "USD",
      rateSource: "seed",
      rateDate: "2026-05-23",
      toleranceBps: 50,
    },
    txns: [
      txn({
        source: "ledger",
        sourceId: "LED-2026-PL21B",
        type: "payment",
        amountMinor: "17075",
        netMinor: "17075",
        reference: "pagolat-day-2026-05-23",
      }),
      txn({
        id: "11111111-0000-4000-8000-000000000004",
        source: "pagolat",
        sourceId: "PL-0523-1",
        type: "payment",
        amountMinor: "95000",
        netMinor: "95000",
        currency: "MXN",
        groupRef: "pagolat-day-2026-05-23",
      }),
      txn({
        id: "11111111-0000-4000-8000-000000000005",
        source: "pagolat",
        sourceId: "PL-0523-2",
        type: "payment",
        amountMinor: "121000",
        netMinor: "121000",
        currency: "MXN",
        groupRef: "pagolat-day-2026-05-23",
      }),
    ],
  },
};
