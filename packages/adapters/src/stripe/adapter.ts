import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  CanonicalTxnType,
  NormalizeResult,
  QuarantineError,
  RawForNormalize,
  SourceAdapter,
  TxnStatus,
} from "@tieout/contracts";
import { normalizedTxnSchema } from "@tieout/contracts";
import { contentHash, isKnownCurrency } from "@tieout/core";
import { quarantine, quarantineFromZod } from "../quarantine.js";

export const STRIPE_SOURCE = "stripe";
export const STRIPE_NORMALIZER_VERSION = "stripe-v1";

/**
 * Stripe balance transaction. Loose on unknown keys (Stripe adds fields freely),
 * strict on the ones we depend on. Amounts arrive as integer minor units already.
 */
const balanceTxnSchema = z.looseObject({
  id: z.string().min(1),
  object: z.literal("balance_transaction"),
  amount: z.number().int(),
  currency: z.string(),
  created: z.number().int(),
  available_on: z.number().int(),
  description: z.string().nullable(),
  fee: z.number().int(),
  net: z.number().int(),
  reporting_category: z.string(),
  source: z.string().min(1).nullable(),
  status: z.string(),
  type: z.string(),
});

/** Data-driven type/status maps (D15) — unmapped values quarantine, never default. */
const STRIPE_TYPE_MAP: Readonly<Record<string, CanonicalTxnType>> = {
  charge: "payment",
  payment: "payment",
  refund: "refund",
  payment_refund: "refund",
  stripe_fee: "fee",
  payout: "payout",
  transfer: "transfer",
  adjustment: "adjustment",
};

const STRIPE_STATUS_MAP: Readonly<Record<string, TxnStatus>> = {
  available: "settled",
  pending: "pending",
};

export function normalizeStripeBalanceTxn(raw: RawForNormalize): NormalizeResult {
  const parsed = balanceTxnSchema.safeParse(raw.payload);
  if (!parsed.success) return quarantineFromZod(parsed.error);
  const txn = parsed.data;

  const errors: QuarantineError[] = [];
  const type = STRIPE_TYPE_MAP[txn.type];
  if (type === undefined) {
    errors.push({ path: "type", message: `unmapped stripe type: ${txn.type}` });
  }
  const status = STRIPE_STATUS_MAP[txn.status];
  if (status === undefined) {
    errors.push({ path: "status", message: `unmapped stripe status: ${txn.status}` });
  }
  const currency = txn.currency.toUpperCase();
  if (!isKnownCurrency(currency)) {
    errors.push({ path: "currency", message: `unknown currency: ${txn.currency}` });
  }
  if (errors.length > 0) return quarantine(errors);

  return {
    ok: true,
    txn: normalizedTxnSchema.parse({
      source: raw.source,
      sourceAccount: raw.sourceAccount,
      sourceId: raw.sourceId,
      sourceType: txn.type,
      type,
      // Integer minor units from the source, straight to bigint — never through a float.
      amountMinor: BigInt(txn.amount),
      // Stripe nets its fee inside the balance transaction (amount − fee = net).
      netMinor: BigInt(txn.net),
      currency,
      occurredAt: new Date(txn.created * 1000),
      valueDate: new Date(txn.available_on * 1000).toISOString().slice(0, 10),
      account: raw.sourceAccount,
      reference: txn.source,
      groupRef: null,
      status,
      metadata: {
        fee: txn.fee,
        net: txn.net,
        reportingCategory: txn.reporting_category,
        description: txn.description,
      },
    }),
  };
}

export interface StripeAdapterConfig {
  /**
   * Committed balance-transactions list fixture ({ object: "list", data: [...] }).
   * Stage 1 lands from fixtures so nothing ever needs network; the live API client
   * replaces only this read when it arrives.
   */
  fixtureFile: string;
  /** Stripe account id (acct_…) — the sourceAccount of every record. */
  account: string;
  connection?: string;
}

export function createStripeAdapter(config: StripeAdapterConfig): SourceAdapter {
  return {
    source: STRIPE_SOURCE,
    normalizerVersion: STRIPE_NORMALIZER_VERSION,

    async land(_ctx) {
      const list = JSON.parse(await readFile(config.fixtureFile, "utf8")) as {
        object?: unknown;
        data?: unknown;
      };
      if (list.object !== "list" || !Array.isArray(list.data)) {
        throw new Error(`${config.fixtureFile}: expected a Stripe list of balance transactions`);
      }
      const listHash = contentHash(list.data);
      return [
        {
          source: STRIPE_SOURCE,
          connection: config.connection ?? "fixture",
          kind: "api",
          externalRef: `balance_transactions:${path.basename(config.fixtureFile)}`,
          idempotencyKey: `stripe:${config.account}:${listHash}`,
          controlTotals: { transactionCount: list.data.length },
          records: list.data.map((bt: unknown, index) => {
            const candidate = (bt as { id?: unknown }) ?? {};
            return {
              sourceAccount: config.account,
              sourceId:
                typeof candidate.id === "string" && candidate.id !== ""
                  ? candidate.id
                  : `missing_id_${index}`,
              payload: bt,
            };
          }),
        },
      ];
    },

    normalize: normalizeStripeBalanceTxn,
  };
}
