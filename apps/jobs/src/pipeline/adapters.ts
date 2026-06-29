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
const STRIPE_SEED_ACCOUNT = "acct_mercadia";

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

/**
 * The live Stripe adapter when the env opts in (STRIPE_LIVE_LANDING=1 with a
 * test-mode key), the fixture otherwise. The flag is explicit: nobody reaches
 * the network because a key happened to be set.
 */
export function createStripeAdapterFromEnv(): { adapter: SourceAdapter; live: boolean } {
  const key = process.env.STRIPE_SECRET_KEY;
  const live = process.env.STRIPE_LIVE_LANDING === "1" && key !== undefined && key !== "";
  if (live) {
    return {
      adapter: createStripeAdapter({ account: STRIPE_SEED_ACCOUNT, live: { apiKey: key! } }),
      live: true,
    };
  }
  return { adapter: getSeedAdapter(STRIPE_SOURCE), live: false };
}

export function getSeedAdapter(source: string): SourceAdapter {
  const adapter = createSeedAdapters()[source];
  if (!adapter) throw new Error(`no adapter registered for source: ${source}`);
  return adapter;
}
