import type { SourceAdapter } from "@tieout/contracts";
import {
  createLedgerAdapter,
  createPagolatAdapter,
  createStripeAdapter,
  LEDGER_SOURCE,
  PAGOLAT_SOURCE,
  STRIPE_SOURCE,
} from "@tieout/adapters";
import { seedFiles, seedPagolatFilePaths } from "@tieout/seed";

/** The demo Stripe account. A real connection would come from configuration. */
export const STRIPE_SEED_ACCOUNT = "acct_mercadia";

/** The demo sources are wired to the committed seed dataset — no network anywhere (D25). */
export function createSeedAdapters(): Record<string, SourceAdapter> {
  return {
    [LEDGER_SOURCE]: createLedgerAdapter({ dataFile: seedFiles.ledgerEntries }),
    [STRIPE_SOURCE]: createStripeAdapter({
      fixtureFile: seedFiles.stripeBalanceTransactions,
      account: STRIPE_SEED_ACCOUNT,
    }),
    [PAGOLAT_SOURCE]: createPagolatAdapter({ files: seedPagolatFilePaths() }),
  };
}

export function getSeedAdapter(source: string): SourceAdapter {
  const adapter = createSeedAdapters()[source];
  if (!adapter) throw new Error(`no adapter registered for source: ${source}`);
  return adapter;
}
