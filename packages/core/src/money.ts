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
