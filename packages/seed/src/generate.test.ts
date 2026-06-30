import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDecimalToMinor } from "@tieout/core";
import { generateMercadiaDataset } from "./generate.js";
import { pagolatDataDir, seedFiles } from "./index.js";

describe("Mercadia dataset", () => {
  it("is deterministic: two generations are identical", () => {
    expect(generateMercadiaDataset()).toEqual(generateMercadiaDataset());
  });

  it("has unique ids; bulk charge amounts unique, cluster amounts colliding on purpose", () => {
    const { ledgerEntries, stripeBalanceTransactions } = generateMercadiaDataset();
    const entryIds = ledgerEntries.map((e) => e.entryId);
    expect(new Set(entryIds).size).toBe(entryIds.length);
    const txnIds = stripeBalanceTransactions.map((t) => t.id);
    expect(new Set(txnIds).size).toBe(txnIds.length);

    const charges = stripeBalanceTransactions.filter((t) => t.type === "charge");
    const bulk = charges.filter((t) => !t.id.startsWith("txn_cl_"));
    expect(new Set(bulk.map((t) => t.amount)).size).toBe(bulk.length);
    // The adversarial cluster must keep colliding — that's its whole point.
    const cluster = charges.filter((t) => t.id.startsWith("txn_cl_"));
    const amountCounts = new Map<number, number>();
    for (const c of cluster) amountCounts.set(c.amount, (amountCounts.get(c.amount) ?? 0) + 1);
    expect(Math.max(...amountCounts.values())).toBeGreaterThanOrEqual(2);
    // And cluster amounts never collide with the bulk set.
    const bulkAmounts = new Set(bulk.map((t) => t.amount));
    expect(cluster.some((c) => bulkAmounts.has(c.amount))).toBe(false);
  });

  it("ledger amounts parse losslessly to bigint minor units", () => {
    for (const e of generateMercadiaDataset().ledgerEntries) {
      expect(() => parseDecimalToMinor(e.amount, e.currency)).not.toThrow();
    }
  });

  it("plants exactly the documented breaks", () => {
    const { plantedBreaks } = generateMercadiaDataset().manifest;
    expect(plantedBreaks.map((b) => b.breakType).sort()).toEqual([
      "duplicate_candidate",
      "duplicate_candidate",
      "fx_drift",
      "missing_in_ledger",
      "missing_in_ledger",
      "missing_in_source",
      "missing_in_source",
      "unexpected_fee",
      "unexpected_fee",
    ]);
    const planted = new Set(plantedBreaks.map((b) => b.sourceId));
    expect(planted.size).toBe(plantedBreaks.length);
  });

  it("expected totals are internally consistent with the dataset", () => {
    const { ledgerEntries, stripeBalanceTransactions, manifest } = generateMercadiaDataset();
    const { expected } = manifest;
    expect(expected.ledgerRecords).toBe(ledgerEntries.length);
    expect(expected.stripeRecords).toBe(stripeBalanceTransactions.length);
    expect(expected.transactions).toBe(
      ledgerEntries.length + stripeBalanceTransactions.length + expected.pagolatRecords,
    );
    expect(expected.currentTransactions).toBe(expected.transactions - 1);
    expect(expected.matches.total).toBe(
      expected.matches.exact_reference +
        expected.matches.amount_date_window +
        expected.matches.grouped_reference,
    );
    expect(expected.totalBreaks).toBe(manifest.plantedBreaks.length);
    // Partition: every matchable transaction (current, not tombstoned) is consumed
    // by exactly one match or one break.
    const matchable = expected.currentTransactions - expected.tombstonedTransactions;
    expect(expected.matchedTransactions + expected.breakConsumedTransactions).toBe(matchable);
  });

  it("pagolat day-files are well-formed and the restated file follows its original", () => {
    const { pagolatFiles } = generateMercadiaDataset();
    // Landing order is lexicographic on disk (seedPagolatFilePaths sorts), so the
    // restatement must sort after its original — in generation order AND sorted order.
    const names = pagolatFiles.map((f) => f.fileName);
    expect(names.indexOf("pagolat-2026-05-25.csv")).toBeLessThan(
      names.indexOf("pagolat-2026-05-25.restated.csv"),
    );
    const sorted = [...names].sort();
    expect(sorted.indexOf("pagolat-2026-05-25.csv")).toBeLessThan(
      sorted.indexOf("pagolat-2026-05-25.restated.csv"),
    );
    for (const file of pagolatFiles) {
      expect(file.content).toMatch(/^PAGOLAT;SETTLEMENT;v1;/);
      expect(file.content).toContain("FOOTER;line_count;");
    }
  });

  it("committed data files match the generator (re-run `pnpm seed` after changing it)", () => {
    const dataset = generateMercadiaDataset();
    expect(JSON.parse(readFileSync(seedFiles.ledgerEntries, "utf8"))).toEqual(
      dataset.ledgerEntries,
    );
    expect(JSON.parse(readFileSync(seedFiles.stripeBalanceTransactions, "utf8")).data).toEqual(
      dataset.stripeBalanceTransactions,
    );
    expect(JSON.parse(readFileSync(seedFiles.fxRates, "utf8"))).toEqual(dataset.fxRates);
    expect(JSON.parse(readFileSync(seedFiles.manifest, "utf8"))).toEqual(dataset.manifest);
    for (const file of dataset.pagolatFiles) {
      expect(readFileSync(path.join(pagolatDataDir, file.fileName), "utf8")).toBe(file.content);
    }
  });
});
