import type { SourceAdapter } from "@tieout/contracts";
import { createLedgerAdapter, createStripeAdapter, LEDGER_SOURCE, STRIPE_SOURCE } from "@tieout/adapters";
import { seedFiles } from "@tieout/seed";

/** The Stage 1 demo Stripe account. A real connection would come from configuration. */
export const STRIPE_SEED_ACCOUNT = "acct_mercadia";

/** Stage 1 sources are wired to the committed seed dataset — no network anywhere. */
export function createSeedAdapters(): Record<string, SourceAdapter> {
  return {
    [LEDGER_SOURCE]: createLedgerAdapter({ dataFile: seedFiles.ledgerEntries }),
    [STRIPE_SOURCE]: createStripeAdapter({
      fixtureFile: seedFiles.stripeBalanceTransactions,
      account: STRIPE_SEED_ACCOUNT,
    }),
  };
}

export function getSeedAdapter(source: string): SourceAdapter {
  const adapter = createSeedAdapters()[source];
  if (!adapter) throw new Error(`no adapter registered for source: ${source}`);
  return adapter;
}
