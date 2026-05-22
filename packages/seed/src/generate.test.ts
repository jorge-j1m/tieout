import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDecimalToMinor } from "@tieout/core";
import { generateMercadiaDataset } from "./generate.js";
import { seedFiles } from "./index.js";

describe("Mercadia dataset", () => {
  it("is deterministic: two generations are identical", () => {
    expect(generateMercadiaDataset()).toEqual(generateMercadiaDataset());
  });

  it("has unique ids and unique charge amounts (fallback matching stays unambiguous)", () => {
    const { ledgerEntries, stripeBalanceTransactions } = generateMercadiaDataset();
    const entryIds = ledgerEntries.map((e) => e.entryId);
    expect(new Set(entryIds).size).toBe(entryIds.length);
    const txnIds = stripeBalanceTransactions.map((t) => t.id);
    expect(new Set(txnIds).size).toBe(txnIds.length);
    const chargeAmounts = stripeBalanceTransactions
      .filter((t) => t.type === "charge")
      .map((t) => t.amount);
    expect(new Set(chargeAmounts).size).toBe(chargeAmounts.length);
  });

  it("ledger amounts parse losslessly to bigint minor units", () => {
    for (const e of generateMercadiaDataset().ledgerEntries) {
      expect(() => parseDecimalToMinor(e.amount, e.currency)).not.toThrow();
    }
  });

  it("plants exactly the four documented breaks", () => {
    const { manifest } = generateMercadiaDataset();
    expect(manifest.map((b) => b.breakType).sort()).toEqual([
      "duplicate_candidate",
      "missing_in_ledger",
      "missing_in_ledger",
      "missing_in_stripe",
    ]);
    const planted = new Set(manifest.map((b) => b.sourceId));
    expect(planted.size).toBe(4);
  });

  it("committed data files match the generator (re-run `pnpm seed` after changing it)", () => {
    const dataset = generateMercadiaDataset();
    expect(JSON.parse(readFileSync(seedFiles.ledgerEntries, "utf8"))).toEqual(
      dataset.ledgerEntries,
    );
    expect(JSON.parse(readFileSync(seedFiles.stripeBalanceTransactions, "utf8")).data).toEqual(
      dataset.stripeBalanceTransactions,
    );
    expect(JSON.parse(readFileSync(seedFiles.manifest, "utf8"))).toEqual(dataset.manifest);
  });
});
