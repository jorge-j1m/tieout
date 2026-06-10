import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedManifest } from "./types.js";

export * from "./types.js";
export * from "./generate.js";

/** Where `pnpm seed` materializes the dataset. Committed, so tests never need network. */
export const seedDataDir = fileURLToPath(new URL("../data/", import.meta.url));

export const seedFiles = {
  ledgerEntries: path.join(seedDataDir, "ledger.entries.json"),
  stripeBalanceTransactions: path.join(seedDataDir, "stripe.balance_transactions.json"),
  manifest: path.join(seedDataDir, "manifest.json"),
} as const;

/** The committed acceptance contract: planted breaks + the expected totals every test and doc quotes. */
export function loadSeedManifest(): SeedManifest {
  return JSON.parse(readFileSync(seedFiles.manifest, "utf8")) as SeedManifest;
}
