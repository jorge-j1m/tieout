import { convertMinor, minorToDecimalString, parseRate } from "@tieout/core";
import type { BreakType, FxRateInput } from "@tieout/contracts";
import type {
  MercadiaDataset,
  PlantedBreak,
  SeedExpectations,
  SeedLedgerEntry,
  SeedPagolatFile,
  SeedStripeBalanceTransaction,
} from "./types.js";

/**
 * The Mercadia dataset (D19): one month of USD card volume with planted breaks
 * and an adversarial cluster. Everything is derived arithmetically — no clock,
 * no RNG — so the dataset is identical on every machine, forever.
 *
 * Planted breaks (the manifest is the acceptance contract):
 *   1. A Stripe Radar fee nobody booked            → missing_in_ledger
 *   2. A Stripe refund missing from the ledger     → missing_in_ledger
 *   3. A ledger charge that never settled          → missing_in_stripe
 *   4. A charge booked twice in the ledger         → duplicate_candidate
 *   5. A booking just outside the ±48h window      → missing_in_stripe + missing_in_ledger
 *   6. A reference-less double-post                → missing_in_stripe (ruleset-v1's labeling, pinned)
 *
 * Bulk order amounts are unique by construction (4900 + i·137 minor units), so
 * the easy volume stays unambiguous. The adversarial cluster then collides
 * amounts on purpose — same-amount same-day groups, an exact equidistant tie,
 * window-edge timestamps, a double-post — because choosing among ambiguous
 * candidates is the product's hard part, and the demo must exercise it rather
 * than design it out.
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

/** Adversarial cluster group A: same-amount referenced charges (pass 2 territory). */
const CLUSTER_A_COUNT = 4;
/** Group B: [settlement hour, booking hour, booking minute] per same-amount pair. */
const CLUSTER_B: readonly [number, number, number][] = [
  [9, 9, 30],
  [12, 12, 30],
  [18, 17, 30],
];

// ── PagoLat settlement story (stage 2) ──────────────────────────────────────
// Mercadia's MX storefront settles through PagoLat in MXN; the ledger books one
// USD entry per day-file at the desk rate. All nets are multiples of 2500 minor
// units so MXN→USD conversion at 0.0588 is EXACT — expectations never depend on
// rounding direction.
const PL_ACCOUNT = "mx-merchant-014";
const MXN_USD_RATE = "0.0588";
/** What the ledger mistakenly booked the 05-23 settlement at — the planted fx_drift. */
const PL_WRONG_INTERNAL_RATE = "0.0612";
/** [gross, commission] per sale line, minor MXN. Net = gross − commission, always ÷2500. */
const PL_DAYS: Readonly<
  Record<string, { sales: readonly [number, number][]; surpriseFeeMinor?: number }>
> = {
  // Clean: grouped match, 3 lines.
  "2026-05-21": { sales: [[100_000, 2_500], [150_000, 5_000], [50_000, 2_500]] },
  // A platform fee the booking ignored: unexpected_fee consuming the group.
  "2026-05-22": { sales: [[250_000, 7_500], [100_000, 2_500]], surpriseFeeMinor: -25_000 },
  // Booked at the wrong internal rate: fx_drift.
  "2026-05-23": { sales: [[150_000, 5_000], [100_000, 2_500]] },
  // Restated below: the original carries an erroneous third line PagoLat later removed.
  "2026-05-25": { sales: [[100_000, 2_500], [50_000, 2_500]] },
};
const PL_REMOVED_LINE: readonly [number, number] = [150_000, 5_000];

/** Stripe payouts and the ledger deposits booking them — transfer legs (D29b). */
const PAYOUTS: readonly { id: string; amountMinor: number; day: number }[] = [
  { id: "po_mercadia_0001", amountMinor: 250_000, day: 27 },
  { id: "po_mercadia_0002", amountMinor: 180_000, day: 28 },
];

const mxn = (minor: number): string => minorToDecimalString(BigInt(minor), "MXN").replace(".", ",");

const RATE = parseRate(MXN_USD_RATE);
const toUsdMinor = (mxnMinor: bigint): number => Number(convertMinor(mxnMinor, "MXN", "USD", RATE));

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

  // ── Adversarial cluster ───────────────────────────────────────────────────
  // Amounts collide within each group on purpose (and with nothing else in the
  // dataset — none is ≡ 105 mod 137, the bulk orders' residue class). Each group
  // exercises one tie rule from §6 of how-it-works.
  const clusterStripeCharge = (
    suffix: string,
    orderNo: number,
    amountMinor: number,
    createdMs: number,
  ) => {
    const fee = Math.floor((amountMinor * 29) / 1000) + 30;
    stripeBalanceTransactions.push({
      id: `txn_cl_${suffix}`,
      object: "balance_transaction",
      amount: amountMinor,
      currency: "usd",
      created: createdMs / 1000,
      available_on: availableOnSec(createdMs),
      description: `Charge for order #${orderNo}`,
      fee,
      fee_details: [{ amount: fee, currency: "usd", type: "stripe_fee" }],
      net: amountMinor - fee,
      reporting_category: "charge",
      source: `ch_mercadia_cl_${suffix}`,
      status: "available",
      type: "charge",
    });
  };
  const clusterLedgerEntry = (
    suffix: string,
    amountMinor: number,
    bookedMs: number,
    reference: string | null,
    description: string,
  ) =>
    ledgerEntries.push(
      ledgerEntry({
        entryId: `LED-2026-CL${suffix}`,
        amountMinor,
        bookedMs,
        type: "payment",
        reference,
        description,
      }),
    );

  // Group A — a same-amount, same-day flash-sale cluster WITH references:
  // pass 2 pairs every one of them no matter how ambiguous the amounts look.
  for (let k = 0; k < CLUSTER_A_COUNT; k++) {
    const ms = Date.UTC(2026, 4, 20, 10 + Math.floor(k / 3), (k * 20) % 60, 0);
    clusterStripeCharge(`a${k + 1}`, 2001 + k, 9999, ms);
    clusterLedgerEntry(
      `A${k + 1}`,
      9999,
      ms + 9 * 60_000,
      `ch_mercadia_cl_a${k + 1}`,
      `Customer payment — order #${2001 + k} (flash sale, fixed price)`,
    );
  }

  // Group B — same amount, same day, NO references: pass 3 must disambiguate
  // three candidates purely by nearest-in-time. Settlements at 09:00/12:00/18:00,
  // bookings at 09:30/12:30/17:30 — each booking is nearest to exactly one.
  for (let k = 0; k < CLUSTER_B.length; k++) {
    const [settleHour, bookHour, bookMinute] = CLUSTER_B[k]!;
    clusterStripeCharge(`b${k + 1}`, 2005 + k, 7250, Date.UTC(2026, 4, 21, settleHour, 0, 0));
    clusterLedgerEntry(
      `B${k + 1}`,
      7250,
      Date.UTC(2026, 4, 21, bookHour, bookMinute, 0),
      null,
      `Customer payment — order #${2005 + k} (manual booking)`,
    );
  }

  // Group C — an exact equidistant tie: the 10:00 booking sits precisely 2h from
  // both settlements; the documented rule (earlier candidate wins) decides.
  clusterStripeCharge("c1", 2008, 4321, Date.UTC(2026, 4, 22, 8, 0, 0));
  clusterStripeCharge("c2", 2009, 4321, Date.UTC(2026, 4, 22, 12, 0, 0));
  clusterLedgerEntry(
    "C1",
    4321,
    Date.UTC(2026, 4, 22, 10, 0, 0),
    null,
    "Customer payment — order #2008 (manual booking, equidistant between two settlements)",
  );
  clusterLedgerEntry(
    "C2",
    4321,
    Date.UTC(2026, 4, 22, 12, 30, 0),
    null,
    "Customer payment — order #2009 (manual booking)",
  );

  // Group D — the window edge, both sides of it: 47h58m matches, 48h30m breaks
  // (planted breaks 5a/5b).
  clusterStripeCharge("d1", 2010, 6166, Date.UTC(2026, 4, 23, 8, 0, 0));
  clusterLedgerEntry(
    "D1",
    6166,
    Date.UTC(2026, 4, 25, 7, 58, 0),
    null,
    "Customer payment — order #2010 (manual booking, 47h58m later — just inside the window)",
  );
  clusterStripeCharge("d2", 2011, 6167, Date.UTC(2026, 4, 23, 9, 0, 0));
  clusterLedgerEntry(
    "D2",
    6167,
    Date.UTC(2026, 4, 25, 9, 30, 0),
    null,
    "Customer payment — order #2011 (manual booking, 48h30m later — just outside the window)",
  );

  // Group E — a true reference-less double-post (planted break 6): pass 1 has no
  // reference to sweep on, so one copy pairs and the other reads missing_in_stripe.
  clusterStripeCharge("e1", 2012, 8421, Date.UTC(2026, 4, 24, 11, 0, 0));
  clusterLedgerEntry(
    "E1",
    8421,
    Date.UTC(2026, 4, 24, 11, 30, 0),
    null,
    "Customer payment — order #2012 (manual booking)",
  );
  clusterLedgerEntry(
    "E2",
    8421,
    Date.UTC(2026, 4, 24, 11, 31, 0),
    null,
    "Customer payment — order #2012 (manual booking, keyed twice in error)",
  );

  // ── PagoLat settlement story ──────────────────────────────────────────────
  const pagolatFiles: SeedPagolatFile[] = [];
  const settlementKey = (date: string) => `PL-${PL_ACCOUNT}-${date}`;

  const saleLine = (date: string, i: number, gross: number, commission: number) =>
    `LINE;${date} 1${i}:00:00;sale;plord_${date.replaceAll("-", "")}_${i + 1};${mxn(gross)};${mxn(commission)};${mxn(gross - commission)};Venta tienda MX`;

  const buildFile = (
    date: string,
    lines: { text: string; netMinor: number }[],
    lie?: { totalNet: number; closing: number },
  ): string => {
    const opening = 500_000; // 5.000,00 MXN — cosmetic; the totals must tie to it
    const totalNet = lie?.totalNet ?? lines.reduce((n, l) => n + l.netMinor, 0);
    const closing = lie?.closing ?? opening + totalNet;
    return [
      `PAGOLAT;SETTLEMENT;v1;${PL_ACCOUNT};${date};-06:00`,
      `HEADER;opening_balance;${mxn(opening)}`,
      ...lines.map((l) => l.text),
      `FOOTER;line_count;${lines.length};total_net;${mxn(totalNet)};closing_balance;${mxn(closing)}`,
      "",
    ].join("\n");
  };

  const bookSettlement = (date: string, usdMinor: number) =>
    ledgerEntries.push(
      ledgerEntry({
        entryId: `LED-2026-PL${date.slice(8)}`,
        amountMinor: usdMinor,
        bookedMs: Date.UTC(2026, 4, Number(date.slice(8)) + 1, 9, 0, 0),
        type: "payment",
        reference: settlementKey(date),
        description: `PagoLat settlement ${date} (desk rate ${MXN_USD_RATE})`,
      }),
    );

  for (const [date, day] of Object.entries(PL_DAYS)) {
    const lines = day.sales.map(([gross, commission], i) => ({
      text: saleLine(date, i, gross, commission),
      netMinor: gross - commission,
    }));
    if (day.surpriseFeeMinor !== undefined) {
      lines.push({
        text: `LINE;${date} 18:00:00;fee;;${mxn(day.surpriseFeeMinor)};${mxn(0)};${mxn(day.surpriseFeeMinor)};Cuota plataforma trimestral`,
        netMinor: day.surpriseFeeMinor,
      });
    }
    const salesNet = day.sales.reduce((n, [gross, commission]) => n + (gross - commission), 0);

    if (date === "2026-05-25") {
      // The original advice carried an erroneous extra line PagoLat later removed;
      // both versions ship, landed in order: original first, restatement second.
      const [removedGross, removedCommission] = PL_REMOVED_LINE;
      const originalLines = [
        ...lines,
        {
          text: `LINE;${date} 16:00:00;sale;plord_${date.replaceAll("-", "")}_err;${mxn(removedGross)};${mxn(removedCommission)};${mxn(removedGross - removedCommission)};Venta duplicada por error de PagoLat`,
          netMinor: removedGross - removedCommission,
        },
      ];
      pagolatFiles.push({ fileName: `pagolat-${date}.csv`, content: buildFile(date, originalLines) });
      pagolatFiles.push({ fileName: `pagolat-${date}.restated.csv`, content: buildFile(date, lines) });
      // Mercadia books from the corrected advice.
      bookSettlement(date, toUsdMinor(BigInt(salesNet)));
      continue;
    }

    pagolatFiles.push({ fileName: `pagolat-${date}.csv`, content: buildFile(date, lines) });
    if (date === "2026-05-22") {
      // The booking ignores the surprise platform fee — unexpected_fee, precisely.
      bookSettlement(date, toUsdMinor(BigInt(salesNet)));
    } else if (date === "2026-05-23") {
      // Booked at the wrong internal rate — fx_drift, the rate is the suspect.
      bookSettlement(
        date,
        Number(convertMinor(BigInt(salesNet), "MXN", "USD", parseRate(PL_WRONG_INTERNAL_RATE))),
      );
    } else {
      bookSettlement(date, toUsdMinor(BigInt(salesNet)));
    }
  }

  // A day-file whose footer lies about its own totals: quarantined whole at the
  // door (D13). Mercadia has not booked it — the advice failed validation.
  pagolatFiles.push({
    fileName: "pagolat-2026-05-24.csv",
    content: buildFile(
      "2026-05-24",
      [
        { text: saleLine("2026-05-24", 0, 100_000, 2_500), netMinor: 97_500 },
        { text: saleLine("2026-05-24", 1, 50_000, 2_500), netMinor: 47_500 },
      ],
      { totalNet: 200_000, closing: 700_000 },
    ),
  });

  // ── Stripe payouts and their ledger deposits — transfer legs (D29b) ────────
  for (const payout of PAYOUTS) {
    const payoutMs = Date.UTC(2026, 4, payout.day, 16, 0, 0);
    stripeBalanceTransactions.push({
      id: `txn_${payout.id}`,
      object: "balance_transaction",
      amount: -payout.amountMinor,
      currency: "usd",
      created: payoutMs / 1000,
      available_on: payoutMs / 1000,
      description: "STRIPE PAYOUT",
      fee: 0,
      fee_details: [],
      net: -payout.amountMinor,
      reporting_category: "payout",
      source: payout.id,
      status: "available",
      type: "payout",
    });
    ledgerEntries.push(
      ledgerEntry({
        entryId: `LED-2026-PO${payout.id.slice(-2)}`,
        amountMinor: payout.amountMinor,
        bookedMs: payoutMs + 4 * 3_600_000,
        type: "payout",
        reference: payout.id,
        description: `Stripe payout received — ${payout.id}`,
      }),
    );
  }

  const plantedBreaks: PlantedBreak[] = [
    {
      id: "planted-unbooked-stripe-fee",
      breakType: "unexpected_fee",
      source: "stripe",
      sourceId: "txn_fee_radar_0001",
      reason: "Stripe Radar fee never booked in the ledger — ruleset-v2 types unbooked fees precisely",
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
      breakType: "missing_in_source",
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
    {
      id: "planted-window-edge-stripe",
      breakType: "missing_in_ledger",
      source: "stripe",
      sourceId: "txn_cl_d2",
      reason: "Settled in Stripe; its manual booking landed 48h30m later — just outside the ±48h fallback window",
    },
    {
      id: "planted-window-edge-ledger",
      breakType: "missing_in_source",
      source: "ledger",
      sourceId: "LED-2026-CLD2",
      reason: "Booked 48h30m after the charge — just outside the ±48h fallback window (the other half of planted-window-edge-stripe)",
    },
    {
      id: "planted-referenceless-double-post",
      breakType: "duplicate_candidate",
      source: "ledger",
      sourceId: "LED-2026-CLE2",
      reason: "True double-post without a reference: one copy pairs through the fallback; the duplicate heuristic names this survivor a duplicate of its matched twin",
    },
    {
      id: "planted-unexpected-platform-fee",
      breakType: "unexpected_fee",
      source: "ledger",
      sourceId: "LED-2026-PL22",
      reason: "PagoLat charged a quarterly platform fee inside the 05-22 settlement; the booking ignored it — the group mismatch is explained exactly by the fee line",
    },
    {
      id: "planted-fx-drift",
      breakType: "fx_drift",
      source: "ledger",
      sourceId: "LED-2026-PL23",
      reason: `The 05-23 settlement was booked at ${PL_WRONG_INTERNAL_RATE} but the run's recorded rate is ${MXN_USD_RATE} — the legs disagree beyond tolerance and the rate is the suspect`,
    },
  ];

  // Expected totals, derived from the construction constants above — deliberately
  // not from running the matcher, so tests against them stay a real cross-check.
  const bookedRefunds =
    Array.from({ length: ORDER_COUNT }, (_, i) => i).filter(isRefunded).length - 1;
  const breaksByType: Partial<Record<BreakType, number>> = {};
  for (const b of plantedBreaks) {
    breaksByType[b.breakType] = (breaksByType[b.breakType] ?? 0) + 1;
  }
  // Referenced charges pair in pass 3 — including cluster group A, the refunds
  // booked on both sides, and the payout/deposit transfer legs.
  const exactReference =
    ORDER_COUNT - MANUAL_BOOKING_ORDERS.size + bookedRefunds + CLUSTER_A_COUNT + PAYOUTS.length;
  // Reference-less records pair through pass 4: the bulk manual bookings, group B,
  // the tie pair (C), the inside-the-window booking (D1), one of the double-post (E1).
  const amountDateWindow = MANUAL_BOOKING_ORDERS.size + CLUSTER_B.length + 2 + 1 + 1;
  // Grouped settlements that tie out: 05-21 (clean) and 05-25 (after restatement).
  const groupedDays = ["2026-05-21", "2026-05-25"];
  const groupedReference = groupedDays.length;
  const groupedMembers = groupedDays.reduce(
    (n, date) => n + 1 + PL_DAYS[date]!.sales.length,
    0,
  );

  // PagoLat raws: every line of the four real day-files, the restated file's
  // tombstone, plus the original 05-25 erroneous line. The lying 05-24 file
  // lands nothing.
  const pagolatLines = Object.values(PL_DAYS).reduce(
    (n, day) => n + day.sales.length + (day.surpriseFeeMinor !== undefined ? 1 : 0),
    0,
  );
  const pagolatRecords = pagolatLines + 1 /* removed 05-25 line */ + 1 /* its tombstone */;
  const tombstonedTransactions = 1;
  const transactions =
    ledgerEntries.length + stripeBalanceTransactions.length + pagolatRecords;
  const currentTransactions = transactions - 1; // the removed line's v1 is superseded

  // Breaks consume: one txn for each missing/duplicate/fee leftover, both legs of
  // nothing here (no amount_mismatch planted), the whole 05-22 group (anchor + 2
  // sales + fee), and the whole 05-23 group (anchor + 2 sales).
  const breakConsumed =
    1 + // radar fee (unexpected_fee leftover)
    1 + // unbooked refund (missing_in_ledger)
    1 + // never-settled charge (missing_in_source)
    1 + // booked duplicate (duplicate_candidate)
    1 + // window-edge stripe (missing_in_ledger)
    1 + // window-edge ledger (missing_in_source)
    1 + // reference-less double-post survivor (duplicate_candidate)
    (1 + PL_DAYS["2026-05-22"]!.sales.length + 1) + // 05-22 group: anchor + sales + fee
    (1 + PL_DAYS["2026-05-23"]!.sales.length); // 05-23 group: anchor + sales

  const matchedTransactions =
    (exactReference + amountDateWindow) * 2 + groupedMembers;

  const expected: SeedExpectations = {
    ledgerRecords: ledgerEntries.length,
    stripeRecords: stripeBalanceTransactions.length,
    pagolatRecords,
    transactions,
    currentTransactions,
    tombstonedTransactions,
    quarantinedBatches: 1,
    matches: {
      exact_reference: exactReference,
      amount_date_window: amountDateWindow,
      grouped_reference: groupedReference,
      total: exactReference + amountDateWindow + groupedReference,
    },
    matchedTransactions,
    breaksByType,
    totalBreaks: plantedBreaks.length,
    breakConsumedTransactions: breakConsumed,
  };

  const fxRates: FxRateInput[] = [
    {
      base: "MXN",
      quote: "USD",
      rate: MXN_USD_RATE,
      rateSource: "seed-desk",
      rateDate: "2026-05-20",
    },
  ];

  return {
    ledgerEntries,
    stripeBalanceTransactions,
    pagolatFiles,
    fxRates,
    manifest: { plantedBreaks, expected },
  };
}
