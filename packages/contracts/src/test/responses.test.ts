import { describe, expect, it } from "vitest";
import {
  breakSchema,
  meSchema,
  runSchema,
  transactionSchema,
  type TransactionRow,
} from "../responses.js";

/** A serialized transaction row exactly as the API's bigint-aware JSON emits it. */
const txnRow: TransactionRow = {
  id: "11111111-0000-4000-8000-000000000000",
  rawId: "22222222-0000-4000-8000-000000000000",
  version: 1,
  isCurrent: true,
  supersededAt: null,
  isTombstone: false,
  source: "stripe",
  sourceAccount: "acct_mercadia",
  sourceId: "txn_re_0014",
  sourceType: "refund",
  type: "refund",
  amountMinor: "-6681",
  netMinor: "-6681",
  currency: "USD",
  occurredAt: "2026-05-14T18:22:00.000Z",
  valueDate: null,
  observedAt: "2026-06-05T00:00:00.000Z",
  account: "acct_mercadia",
  reference: "ch_mercadia_0014",
  groupRef: null,
  status: "settled",
  normalizerVersion: "stripe-v1",
  metadata: {},
  createdAt: "2026-06-05T00:00:00.000Z",
};

describe("response schemas", () => {
  it("accepts a serialized run row with stats as the engine records them", () => {
    const parsed = runSchema.parse({
      id: "7e9b0611-0000-4000-8000-000000000000",
      asOf: "2026-06-05T00:00:00.000Z",
      rulesetVersion: "ruleset-v2",
      status: "completed",
      stats: {
        evaluatedTransactions: 133,
        ledgerTransactions: 64,
        externalTransactions: 69,
        matches: 58,
        matchedTransactions: 119,
        breaks: { missing_in_ledger: 2, fx_drift: 1 },
        totalBreaks: 9,
        pendingBySource: { stripe: 2 },
        pending: [],
        config: {
          windowMs: 172800000,
          toleranceMinor: "0",
          fxToleranceBps: 10,
          fxRates: [
            { base: "MXN", quote: "USD", rate: "0.0588", rateSource: "seed-desk", rateDate: "2026-05-20" },
          ],
          lagMsBySource: null,
          duplicateWindowMs: 3600000,
        },
      },
      startedAt: "2026-06-05T00:00:00.000Z",
      finishedAt: "2026-06-05T00:00:52.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    expect(parsed.stats.totalBreaks).toBe(9);
    expect(parsed.stats.matchedTransactions).toBe(119);
  });

  it("keeps money a string on transactions", () => {
    const parsed = transactionSchema.parse(txnRow);
    expect(typeof parsed.amountMinor).toBe("string");
    expect(parsed.amountMinor).toBe("-6681");
  });

  it("rejects money that arrived as a number", () => {
    expect(() => transactionSchema.parse({ ...txnRow, amountMinor: -6681 })).toThrow();
  });

  it("always carries the consumed txns on a break's details", () => {
    const parsed = breakSchema.parse({
      id: "33333333-0000-4000-8000-000000000000",
      runId: "7e9b0611-0000-4000-8000-000000000000",
      type: "missing_in_ledger",
      details: {
        reference: "ch_mercadia_0014",
        txns: [
          {
            id: "11111111-0000-4000-8000-000000000000",
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
          },
        ],
      },
      fingerprint: "9f3ab2c1a04e",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    expect(parsed.details.txns[0]?.sourceId).toBe("txn_re_0014");
    // per-type extras survive via the catchall
    expect(parsed.details.reference).toBe("ch_mercadia_0014");
  });

  it("resolves the two personas", () => {
    expect(meSchema.parse({ operator: null }).operator).toBeNull();
    expect(meSchema.parse({ operator: "ana" }).operator).toBe("ana");
  });
});
