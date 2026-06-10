import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateMercadiaDataset } from "./generate.js";
import { pagolatDataDir, seedDataDir, seedFiles } from "./index.js";

const dataset = generateMercadiaDataset();

mkdirSync(seedDataDir, { recursive: true });
mkdirSync(pagolatDataDir, { recursive: true });
const write = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

write(seedFiles.ledgerEntries, dataset.ledgerEntries);
write(seedFiles.stripeBalanceTransactions, {
  object: "list",
  data: dataset.stripeBalanceTransactions,
  has_more: false,
  url: "/v1/balance_transactions",
});
write(seedFiles.fxRates, dataset.fxRates);
write(seedFiles.manifest, dataset.manifest);
for (const file of dataset.pagolatFiles) {
  writeFileSync(path.join(pagolatDataDir, file.fileName), file.content);
}

console.log(`Mercadia seed dataset written to ${seedDataDir}`);
console.log(`  ledger entries:              ${dataset.ledgerEntries.length}`);
console.log(`  stripe balance transactions: ${dataset.stripeBalanceTransactions.length}`);
console.log(`  pagolat day-files:           ${dataset.pagolatFiles.length}`);
console.log(`  fx rates:                    ${dataset.fxRates.length}`);
console.log(`  expected matches:            ${dataset.manifest.expected.matches.total}`);
console.log(`  planted breaks:              ${dataset.manifest.plantedBreaks.length}`);
for (const b of dataset.manifest.plantedBreaks) {
  console.log(`    - [${b.breakType}] ${b.sourceId} — ${b.reason}`);
}
