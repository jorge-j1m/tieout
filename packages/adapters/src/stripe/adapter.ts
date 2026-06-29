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
import { canonicalJson, contentHash, isKnownCurrency, syntheticSourceId } from "@tieout/core";
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

export interface StripeLiveConfig {
  /** TEST MODE ONLY (D22): the adapter refuses anything but an sk_test_ key. */
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface StripeAdapterConfig {
  /**
   * Committed balance-transactions list fixture ({ object: "list", data: [...] }).
   * The default: tests and the demo never touch the network (D25).
   */
  fixtureFile?: string;
  /** When set, `land()` reads the real API for the window instead of the fixture. */
  live?: StripeLiveConfig;
  /** Stripe account id (acct_…) — the sourceAccount of every record. */
  account: string;
}

/** Paginate /v1/balance_transactions for a window — the only part the live client replaces (D25). */
async function fetchBalanceTransactions(
  live: StripeLiveConfig,
  window: { from: Date; to: Date },
): Promise<unknown[]> {
  if (!live.apiKey.startsWith("sk_test_")) {
    throw new Error("stripe live landing refuses non-test-mode keys (D22) — got a key not starting with sk_test_");
  }
  const fetchImpl = live.fetchImpl ?? fetch;
  const data: unknown[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const params = new URLSearchParams({
      limit: "100",
      "created[gte]": String(Math.floor(window.from.getTime() / 1000)),
      "created[lt]": String(Math.ceil(window.to.getTime() / 1000)),
    });
    if (startingAfter !== undefined) params.set("starting_after", startingAfter);
    const res = await fetchImpl(`https://api.stripe.com/v1/balance_transactions?${params}`, {
      headers: { Authorization: `Bearer ${live.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`stripe balance_transactions ${res.status}: ${await res.text()}`);
    }
    const page = (await res.json()) as { data?: unknown[]; has_more?: boolean };
    if (!Array.isArray(page.data)) {
      throw new Error("stripe balance_transactions: malformed list response");
    }
    data.push(...page.data);
    if (page.has_more !== true || page.data.length === 0) return data;
    const last = page.data[page.data.length - 1] as { id?: unknown };
    if (typeof last.id !== "string") {
      throw new Error("stripe balance_transactions: page item without id — cannot paginate");
    }
    startingAfter = last.id;
  }
}

export function createStripeAdapter(config: StripeAdapterConfig): SourceAdapter {
  if (config.fixtureFile === undefined && config.live === undefined) {
    throw new Error("stripe adapter needs a fixtureFile or a live config");
  }
  return {
    source: STRIPE_SOURCE,
    normalizerVersion: STRIPE_NORMALIZER_VERSION,

    async land(ctx) {
      let data: unknown[];
      let externalRef: string;
      let idempotencyKey: string;
      if (config.live !== undefined) {
        data = await fetchBalanceTransactions(config.live, ctx.window);
        // Window-keyed idempotency (D12/D25): re-covering the window converges.
        const windowKey = `${ctx.window.from.toISOString()}..${ctx.window.to.toISOString()}`;
        externalRef = `balance_transactions:${windowKey}`;
        idempotencyKey = `stripe:${config.account}:${windowKey}`;
      } else {
        const list = JSON.parse(await readFile(config.fixtureFile!, "utf8")) as {
          object?: unknown;
          data?: unknown;
        };
        if (list.object !== "list" || !Array.isArray(list.data)) {
          throw new Error(`${config.fixtureFile}: expected a Stripe list of balance transactions`);
        }
        data = list.data;
        externalRef = `balance_transactions:${path.basename(config.fixtureFile!)}`;
        idempotencyKey = `stripe:${config.account}:${contentHash(data)}`;
      }
      return [
        {
          source: STRIPE_SOURCE,
          connection: config.live ? "api" : "fixture",
          kind: "api",
          externalRef,
          idempotencyKey,
          controlTotals: { transactionCount: data.length },
          records: data.map((bt: unknown, index) => {
            const candidate = (bt as { id?: unknown }) ?? {};
            return {
              sourceAccount: config.account,
              sourceId:
                typeof candidate.id === "string" && candidate.id !== ""
                  ? candidate.id
                  : syntheticSourceId(idempotencyKey, canonicalJson(bt), index),
              payload: bt,
            };
          }),
        },
      ];
    },

    normalize: normalizeStripeBalanceTxn,
  };
}
