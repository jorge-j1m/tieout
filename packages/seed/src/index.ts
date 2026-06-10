import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FxRateInput } from "@tieout/contracts";
import type { SeedManifest } from "./types.js";

export * from "./types.js";
export * from "./generate.js";

/** Where `pnpm seed` materializes the dataset. Committed, so tests never need network. */
export const seedDataDir = fileURLToPath(new URL("../data/", import.meta.url));
export const pagolatDataDir = path.join(seedDataDir, "pagolat");

export const seedFiles = {
  ledgerEntries: path.join(seedDataDir, "ledger.entries.json"),
  stripeBalanceTransactions: path.join(seedDataDir, "stripe.balance_transactions.json"),
  fxRates: path.join(seedDataDir, "fx.rates.json"),
  manifest: path.join(seedDataDir, "manifest.json"),
} as const;

/**
 * PagoLat day-file paths in landing order. Lexicographic order is the landing
 * order by construction: a restated file sorts after its original.
 */
export function seedPagolatFilePaths(): string[] {
  return readdirSync(pagolatDataDir)
    .filter((f) => f.endsWith(".csv"))
    .sort()
    .map((f) => path.join(pagolatDataDir, f));
}

/** The run's recorded rates (D7), seeded into fx_rates by the pipeline. */
export function loadSeedFxRates(): FxRateInput[] {
  return JSON.parse(readFileSync(seedFiles.fxRates, "utf8")) as FxRateInput[];
}

/** The committed acceptance contract: planted breaks + the expected totals every test and doc quotes. */
export function loadSeedManifest(): SeedManifest {
  return JSON.parse(readFileSync(seedFiles.manifest, "utf8")) as SeedManifest;
}
