/**
 * Money rendering (D5): bigint minor units in, exact strings out. No float ever
 * touches an amount — parsing, grouping, and splitting are all integer/string
 * operations, so what the record says is what the page shows, to the last digit.
 */

/** Minor-unit exponents per currency; anything unlisted renders with 2. */
const CURRENCY_EXPONENT: Record<string, number> = {
  USD: 2,
  MXN: 2,
  JPY: 0,
  USDC: 6,
};

/** Currencies rendered with a leading symbol; the rest carry a trailing code. */
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  JPY: "¥",
};

/** A true minus sign — a hyphen is a typo in a financial statement. */
const MINUS = "−";

/** Group an unsigned integer string with thousands separators, no Number round-trip. */
function groupThousands(digits: string): string {
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return grouped;
}

/**
 * Format minor units exactly: `"6681"` → `"$66.81"`, `"290000"` MXN →
 * `"2,900.00 MXN"`, `2900n` JPY → `"¥2,900"`. Throws on non-integer input —
 * malformed money is a bug upstream, never something to coerce (quarantine, don't guess).
 */
export function formatMoney(minor: string | bigint, currency: string): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor); // throws on "66.81"
  const exponent = CURRENCY_EXPONENT[currency] ?? 2;

  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(exponent + 1, "0");

  const whole = groupThousands(abs.slice(0, abs.length - exponent) || "0");
  const fraction = exponent > 0 ? `.${abs.slice(abs.length - exponent)}` : "";

  const symbol = CURRENCY_SYMBOL[currency];
  const unsigned =
    symbol !== undefined ? `${symbol}${whole}${fraction}` : `${whole}${fraction} ${currency}`;
  return negative ? `${MINUS}${unsigned}` : unsigned;
}
