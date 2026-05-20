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
