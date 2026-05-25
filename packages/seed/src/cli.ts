import { mkdirSync, writeFileSync } from "node:fs";
import { generateMercadiaDataset } from "./generate.js";
import { seedDataDir, seedFiles } from "./index.js";

const dataset = generateMercadiaDataset();

mkdirSync(seedDataDir, { recursive: true });
const write = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

write(seedFiles.ledgerEntries, dataset.ledgerEntries);
write(seedFiles.stripeBalanceTransactions, {
  object: "list",
  data: dataset.stripeBalanceTransactions,
  has_more: false,
  url: "/v1/balance_transactions",
});
write(seedFiles.manifest, dataset.manifest);

console.log(`Mercadia seed dataset written to ${seedDataDir}`);
console.log(`  ledger entries:              ${dataset.ledgerEntries.length}`);
console.log(`  stripe balance transactions: ${dataset.stripeBalanceTransactions.length}`);
console.log(`  planted breaks:              ${dataset.manifest.length}`);
for (const b of dataset.manifest) {
  console.log(`    - [${b.breakType}] ${b.sourceId} — ${b.reason}`);
}
