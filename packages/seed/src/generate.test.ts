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
    const { plantedBreaks } = generateMercadiaDataset().manifest;
    expect(plantedBreaks.map((b) => b.breakType).sort()).toEqual([
      "duplicate_candidate",
      "missing_in_ledger",
      "missing_in_ledger",
      "missing_in_stripe",
    ]);
    const planted = new Set(plantedBreaks.map((b) => b.sourceId));
    expect(planted.size).toBe(plantedBreaks.length);
  });

  it("expected totals are internally consistent with the dataset", () => {
    const { ledgerEntries, stripeBalanceTransactions, manifest } = generateMercadiaDataset();
    const { expected } = manifest;
    expect(expected.ledgerRecords).toBe(ledgerEntries.length);
    expect(expected.stripeRecords).toBe(stripeBalanceTransactions.length);
    expect(expected.transactions).toBe(ledgerEntries.length + stripeBalanceTransactions.length);
    expect(expected.matches.total).toBe(
      expected.matches.exact_reference + expected.matches.amount_date_window,
    );
    expect(expected.totalBreaks).toBe(manifest.plantedBreaks.length);
    // Partition: every record is half of a match or consumed by a break
    // (amount_mismatch breaks consume two records, all other types one).
    const consumedByBreaks =
      expected.totalBreaks + (expected.breaksByType.amount_mismatch ?? 0);
    expect(expected.matches.total * 2 + consumedByBreaks).toBe(expected.transactions);
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
