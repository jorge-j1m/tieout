import { minorToDecimalString } from "@tieout/core";
import type {
  MercadiaDataset,
  PlantedBreak,
  SeedLedgerEntry,
  SeedStripeBalanceTransaction,
} from "./types.js";

/**
 * The Mercadia dataset (D19): one month of USD card volume with exactly four
 * planted breaks. Everything is derived arithmetically from the order index —
 * no clock, no RNG — so the dataset is identical on every machine, forever.
 *
 * Planted breaks (the manifest is the acceptance contract):
 *   1. A Stripe Radar fee nobody booked            → missing_in_ledger
 *   2. A Stripe refund missing from the ledger     → missing_in_ledger
 *   3. A ledger charge that never settled          → missing_in_stripe
 *   4. A charge booked twice in the ledger         → duplicate_candidate
 *
 * Order amounts are unique by construction (4900 + i·137 minor units), so the
 * fallback amount+date matcher can never pair the wrong records.
 */

const ORDER_COUNT = 40;
const DAY_MS = 86_400_000;
const LEDGER_ACCOUNT = "mercadia:operating";

/** Orders refunded two days later. 13 is the planted unbooked refund. */
const isRefunded = (i: number) => i % 9 === 4;
const UNBOOKED_REFUND_ORDER = 13;
/** Orders booked manually, without a PSP reference — exercised by the fallback matcher. */
const MANUAL_BOOKING_ORDERS = new Set([7, 19, 31]);
const DUPLICATE_ORDER = 27;

const pad = (n: number) => String(n).padStart(4, "0");

const orderAmountMinor = (i: number) => 4900 + i * 137;

const chargeTimeMs = (i: number) =>
  Date.UTC(2026, 4, 1 + (i % 26), 8 + ((i * 7) % 10), (i * 13) % 60, 0);

/** Stripe-style availability: midnight UTC two days after the event. */
function availableOnSec(eventMs: number): number {
  const d = new Date(eventMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2) / 1000;
}

function ledgerEntry(args: {
  entryId: string;
  amountMinor: number;
  bookedMs: number;
  type: SeedLedgerEntry["type"];
  reference: string | null;
  description: string;
}): SeedLedgerEntry {
  const bookedAt = new Date(args.bookedMs).toISOString();
  return {
    entryId: args.entryId,
    account: LEDGER_ACCOUNT,
    amount: minorToDecimalString(BigInt(args.amountMinor), "USD"),
    currency: "USD",
    bookedAt,
    valueDate: bookedAt.slice(0, 10),
    type: args.type,
    status: "posted",
    reference: args.reference,
    description: args.description,
  };
}

export function generateMercadiaDataset(): MercadiaDataset {
  const ledgerEntries: SeedLedgerEntry[] = [];
  const stripeBalanceTransactions: SeedStripeBalanceTransaction[] = [];

  for (let i = 0; i < ORDER_COUNT; i++) {
    const orderNo = pad(i + 1);
    const amountMinor = orderAmountMinor(i);
    const chargeId = `ch_mercadia_${orderNo}`;
    const chargeMs = chargeTimeMs(i);
    const fee = Math.floor((amountMinor * 29) / 1000) + 30;

    stripeBalanceTransactions.push({
      id: `txn_ch_${orderNo}`,
      object: "balance_transaction",
      amount: amountMinor,
      currency: "usd",
      created: chargeMs / 1000,
      available_on: availableOnSec(chargeMs),
      description: `Charge for order #${1000 + i}`,
      fee,
      fee_details: [{ amount: fee, currency: "usd", type: "stripe_fee" }],
      net: amountMinor - fee,
      reporting_category: "charge",
      source: chargeId,
      status: "available",
      type: "charge",
    });

    const bookedMs = chargeMs + (((i * 11) % 50) + 5) * 60_000;
    ledgerEntries.push(
      ledgerEntry({
        entryId: `LED-2026-${orderNo}`,
        amountMinor,
        bookedMs,
        type: "payment",
        reference: MANUAL_BOOKING_ORDERS.has(i) ? null : chargeId,
        description: `Customer payment — order #${1000 + i}`,
      }),
    );

    if (i === DUPLICATE_ORDER) {
      ledgerEntries.push(
        ledgerEntry({
          entryId: `LED-2026-${orderNo}-DUP`,
          amountMinor,
          bookedMs: bookedMs + 3_600_000,
          type: "payment",
          reference: chargeId,
          description: `Customer payment — order #${1000 + i} (posted twice in error)`,
        }),
      );
    }

    if (isRefunded(i)) {
      const refundId = `re_mercadia_${orderNo}`;
      const refundMs = chargeMs + 2 * DAY_MS + i * 7 * 60_000;
      stripeBalanceTransactions.push({
        id: `txn_re_${orderNo}`,
        object: "balance_transaction",
        amount: -amountMinor,
        currency: "usd",
        created: refundMs / 1000,
        available_on: availableOnSec(refundMs),
        description: `Refund for order #${1000 + i}`,
        fee: 0,
        fee_details: [],
        net: -amountMinor,
        reporting_category: "refund",
        source: refundId,
        status: "available",
        type: "refund",
      });
      if (i !== UNBOOKED_REFUND_ORDER) {
        ledgerEntries.push(
          ledgerEntry({
            entryId: `LED-2026-R${orderNo}`,
            amountMinor: -amountMinor,
            bookedMs: refundMs + 30 * 60_000,
            type: "refund",
            reference: refundId,
            description: `Refund — order #${1000 + i}`,
          }),
        );
      }
    }
  }

  // Planted break 1: a Radar fee with no ledger booking.
  const feeMs = Date.UTC(2026, 4, 15, 3, 0, 0);
  stripeBalanceTransactions.push({
    id: "txn_fee_radar_0001",
    object: "balance_transaction",
    amount: -850,
    currency: "usd",
    created: feeMs / 1000,
    available_on: availableOnSec(feeMs),
    description: "Radar for Fraud Teams — May",
    fee: 0,
    fee_details: [],
    net: -850,
    reporting_category: "fee",
    source: null,
    status: "available",
    type: "stripe_fee",
  });

  // Planted break 3: booked in the ledger, never settled in Stripe.
  ledgerEntries.push(
    ledgerEntry({
      entryId: "LED-2026-NS01",
      amountMinor: 11111,
      bookedMs: Date.UTC(2026, 4, 18, 10, 0, 0),
      type: "payment",
      reference: "ch_mercadia_neversettled",
      description: "Customer payment — order #1099 (charge later failed)",
    }),
  );

  const manifest: PlantedBreak[] = [
    {
      id: "planted-unbooked-stripe-fee",
      breakType: "missing_in_ledger",
      source: "stripe",
      sourceId: "txn_fee_radar_0001",
      reason: "Stripe Radar fee never booked in the ledger",
    },
    {
      id: "planted-unbooked-refund",
      breakType: "missing_in_ledger",
      source: "stripe",
      sourceId: `txn_re_${pad(UNBOOKED_REFUND_ORDER + 1)}`,
      reason: "Refund issued in Stripe, never booked in the ledger",
    },
    {
      id: "planted-never-settled-charge",
      breakType: "missing_in_stripe",
      source: "ledger",
      sourceId: "LED-2026-NS01",
      reason: "Payment booked in the ledger; the charge never settled in Stripe",
    },
    {
      id: "planted-duplicate-booking",
      breakType: "duplicate_candidate",
      source: "ledger",
      sourceId: `LED-2026-${pad(DUPLICATE_ORDER + 1)}-DUP`,
      reason: "Same charge booked twice in the ledger",
    },
  ];

  return { ledgerEntries, stripeBalanceTransactions, manifest };
}
