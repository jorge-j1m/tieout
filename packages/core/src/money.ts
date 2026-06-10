/**
 * Money is bigint minor units, always (D5). Parsing goes from source string straight
 * to bigint — a float never touches an amount, and anything ambiguous throws so the
 * caller can quarantine instead of guessing.
 */

export const CURRENCY_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  MXN: 2,
  BRL: 2,
  COP: 2,
  ARS: 2,
  JPY: 0,
  BHD: 3,
  USDC: 6,
} as const satisfies Record<string, number>;

export type KnownCurrency = keyof typeof CURRENCY_EXPONENTS;

export function isKnownCurrency(currency: string): currency is KnownCurrency {
  return Object.hasOwn(CURRENCY_EXPONENTS, currency);
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

export function exponentFor(currency: string): number {
  if (!isKnownCurrency(currency)) {
    throw new MoneyParseError(`unknown currency: ${currency}`);
  }
  return CURRENCY_EXPONENTS[currency];
}

/**
 * Decimal conventions differ by source: `dot` is `1,234.56`, `comma` is `1.234,56`
 * (PagoLat-style locale decimals). The format is always declared explicitly by the
 * adapter — it is never sniffed from the value.
 */
export type DecimalFormat = "dot" | "comma";

const DOT_FORMAT = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
const COMMA_FORMAT = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

/**
 * Parse a decimal amount string into bigint minor units. Throws `MoneyParseError`
 * on malformed input, unknown currency, or more fraction digits than the currency
 * carries — never rounds, never coerces.
 */
export function parseDecimalToMinor(
  input: string,
  currency: string,
  format: DecimalFormat = "dot",
): bigint {
  const exponent = exponentFor(currency);
  const match = (format === "dot" ? DOT_FORMAT : COMMA_FORMAT).exec(input.trim());
  if (!match) {
    throw new MoneyParseError(`malformed ${format}-format amount: ${JSON.stringify(input)}`);
  }
  const [, sign, wholeRaw, fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new MoneyParseError(
      `amount ${JSON.stringify(input)} has ${fraction.length} fraction digits; ${currency} carries ${exponent}`,
    );
  }
  const whole = wholeRaw!.replace(/[.,]/g, "");
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0");
  return sign === "-" ? -minor : minor;
}

/**
 * An FX rate parsed for bigint arithmetic: `rate = mantissa / 10^scale` (D7).
 * Rates are data, never floats; zero and negative rates are malformed.
 */
export interface ParsedRate {
  mantissa: bigint;
  scale: number;
}

const RATE_FORMAT = /^(\d+)(?:\.(\d+))?$/;

export function parseRate(rate: string): ParsedRate {
  const match = RATE_FORMAT.exec(rate.trim());
  if (!match) {
    throw new MoneyParseError(`malformed fx rate: ${JSON.stringify(rate)}`);
  }
  const [, whole, fraction = ""] = match;
  const mantissa = BigInt(whole! + fraction);
  if (mantissa === 0n) {
    throw new MoneyParseError(`fx rate must be positive: ${JSON.stringify(rate)}`);
  }
  return { mantissa, scale: fraction.length };
}

/** Divide with round-half-even (banker's rounding) — the only rounding money ever gets. */
function divideHalfEven(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < 0n !== divisor < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = divisor < 0n ? -divisor : divisor;
  let quotient = n / d;
  const remainder = n % d;
  const twice = remainder * 2n;
  if (twice > d || (twice === d && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

/**
 * Convert minor units across currencies with an explicit rate: 1 major unit of
 * `from` = rate major units of `to`. Exact bigint arithmetic; when the result has
 * more precision than `to` carries, it rounds half-even — and that this happened
 * is visible to callers via the recorded rate, never hidden.
 */
export function convertMinor(
  amountMinor: bigint,
  from: string,
  to: string,
  rate: ParsedRate,
): bigint {
  const power = exponentFor(to) - exponentFor(from) - rate.scale;
  const product = amountMinor * rate.mantissa;
  return power >= 0 ? product * 10n ** BigInt(power) : divideHalfEven(product, 10n ** BigInt(-power));
}

/**
 * Is `actual` within `toleranceBps` basis points of `expected`? Pure bigint —
 * |actual − expected| · 10000 ≤ toleranceBps · |expected|. With expected = 0 only
 * an exact match passes.
 */
export function isWithinBps(actual: bigint, expected: bigint, toleranceBps: number): boolean {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0) {
    throw new MoneyParseError(`toleranceBps must be a non-negative integer: ${toleranceBps}`);
  }
  const delta = actual >= expected ? actual - expected : expected - actual;
  const magnitude = expected < 0n ? -expected : expected;
  return delta * 10_000n <= BigInt(toleranceBps) * magnitude;
}

/** Render minor units as a plain dot-decimal string with the currency's full precision. */
export function minorToDecimalString(amountMinor: bigint, currency: string): string {
  const exponent = exponentFor(currency);
  const sign = amountMinor < 0n ? "-" : "";
  const abs = amountMinor < 0n ? -amountMinor : amountMinor;
  if (exponent === 0) {
    return `${sign}${abs}`;
  }
  const digits = abs.toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${sign}${whole}.${fraction}`;
}
