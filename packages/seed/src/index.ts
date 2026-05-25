import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlantedBreak } from "./types.js";

export * from "./types.js";
export * from "./generate.js";

/** Where `pnpm seed` materializes the dataset. Committed, so tests never need network. */
export const seedDataDir = fileURLToPath(new URL("../data/", import.meta.url));

export const seedFiles = {
  ledgerEntries: path.join(seedDataDir, "ledger.entries.json"),
  stripeBalanceTransactions: path.join(seedDataDir, "stripe.balance_transactions.json"),
  manifest: path.join(seedDataDir, "manifest.json"),
} as const;

export function loadPlantedManifest(): PlantedBreak[] {
  return JSON.parse(readFileSync(seedFiles.manifest, "utf8")) as PlantedBreak[];
}
