import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStripeAdapter } from "./adapter.js";
import { expectGolden, fixturesDir } from "../test/golden.js";

const ACCOUNT = "acct_test_mercadia";
const validFile = path.join(fixturesDir, "stripe/balance-transactions.json");
const driftFile = path.join(fixturesDir, "stripe/drift.json");

describe("stripe adapter", () => {
  it("normalizes balance transactions (golden)", async () => {
    await expectGolden(
      createStripeAdapter({ fixtureFile: validFile, account: ACCOUNT }),
      path.join(fixturesDir, "stripe/balance-transactions.expected.json"),
    );
  });

  it("quarantines drifted balance transactions with structured errors (golden)", async () => {
    await expectGolden(
      createStripeAdapter({ fixtureFile: driftFile, account: ACCOUNT }),
      path.join(fixturesDir, "stripe/drift.expected.json"),
    );
  });

  it("lands from the live API with window-keyed idempotency and full pagination", async () => {
    const window = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-05-03T00:00:00Z") };
    const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: `txn_p1_${i}` }));
    const pageTwo = [{ id: "txn_p2_0" }, { id: "txn_p2_1" }];
    const requests: string[] = [];
    const fetchImpl = ((url: string | URL) => {
      requests.push(String(url));
      const body = String(url).includes("starting_after")
        ? { object: "list", data: pageTwo, has_more: false }
        : { object: "list", data: pageOne, has_more: true };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;

    const adapter = createStripeAdapter({
      account: ACCOUNT,
      live: { apiKey: "sk_test_fake", fetchImpl },
    });
    const [batch] = await adapter.land({ window });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain("created%5Bgte%5D=1777593600");
    expect(requests[1]).toContain("starting_after=txn_p1_99");
    expect(batch!.records).toHaveLength(102);
    expect(batch!.idempotencyKey).toBe(
      "stripe:acct_test_mercadia:2026-05-01T00:00:00.000Z..2026-05-03T00:00:00.000Z",
    );
  });

  it("refuses anything but a test-mode key (D22)", async () => {
    const adapter = createStripeAdapter({
      account: ACCOUNT,
      live: { apiKey: "sk_live_definitely_not", fetchImpl: (() => {
        throw new Error("must never be called");
      }) as typeof fetch },
    });
    await expect(
      adapter.land({ window: { from: new Date(0), to: new Date(1) } }),
    ).rejects.toThrow(/refuses non-test-mode keys/);
  });

  it("normalizes a payout balance transaction as a transfer leg counterpart", () => {
    const adapter = createStripeAdapter({ fixtureFile: validFile, account: ACCOUNT });
    const result = adapter.normalize({
      source: "stripe",
      sourceAccount: ACCOUNT,
      sourceId: "txn_po_0001",
      payload: {
        id: "txn_po_0001",
        object: "balance_transaction",
        amount: -250_000,
        currency: "usd",
        created: 1777800000,
        available_on: 1777800000,
        description: "STRIPE PAYOUT",
        fee: 0,
        fee_details: [],
        net: -250_000,
        reporting_category: "payout",
        source: "po_test_0001",
        status: "available",
        type: "payout",
      },
      observedAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.txn.type).toBe("payout");
      expect(result.txn.amountMinor).toBe(-250_000n);
      expect(result.txn.reference).toBe("po_test_0001");
    }
  });

  it("normalizes amounts as native integer minor units and uppercases currency", async () => {
    const adapter = createStripeAdapter({ fixtureFile: validFile, account: ACCOUNT });
    const window = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
    const [batch] = await adapter.land({ window });
    const charge = batch!.records.find((r) => r.sourceId === "txn_t_ch_0001")!;
    const result = adapter.normalize({
      source: batch!.source,
      sourceAccount: charge.sourceAccount,
      sourceId: charge.sourceId,
      payload: charge.payload,
      observedAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.txn.amountMinor).toBe(6737n);
      expect(result.txn.currency).toBe("USD");
      expect(result.txn.reference).toBe("ch_test_0001");
      expect(result.txn.occurredAt.toISOString()).toBe("2026-05-03T09:00:00.000Z");
      expect(result.txn.sourceType).toBe("charge");
      expect(result.txn.type).toBe("payment");
    }
  });
});
