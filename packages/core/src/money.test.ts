import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CURRENCY_EXPONENTS,
  MoneyParseError,
  minorToDecimalString,
  parseDecimalToMinor,
} from "./money.js";

const KNOWN_CURRENCIES = Object.keys(CURRENCY_EXPONENTS);
const AMOUNT_RANGE = { min: -(10n ** 18n), max: 10n ** 18n };

describe("parseDecimalToMinor", () => {
  it("parses dot-format amounts straight to bigint minor units", () => {
    expect(parseDecimalToMinor("10.50", "USD")).toBe(1050n);
    expect(parseDecimalToMinor("1,234.56", "USD")).toBe(123456n);
    expect(parseDecimalToMinor("-0.01", "USD")).toBe(-1n);
    expect(parseDecimalToMinor("+7", "USD")).toBe(700n);
    expect(parseDecimalToMinor("1234", "JPY")).toBe(1234n);
    expect(parseDecimalToMinor("1,234", "JPY")).toBe(1234n);
    expect(parseDecimalToMinor("0.000001", "USDC")).toBe(1n);
    expect(parseDecimalToMinor("12.345", "BHD")).toBe(12345n);
  });

  it("parses comma-format locale amounts (PagoLat-style)", () => {
    expect(parseDecimalToMinor("1.234,56", "USD", "comma")).toBe(123456n);
    expect(parseDecimalToMinor("-1.234.567,89", "USD", "comma")).toBe(-123456789n);
    expect(parseDecimalToMinor("12,50", "USD", "comma")).toBe(1250n);
  });

  it("rejects malformed input instead of guessing", () => {
    for (const bad of ["", "12.3.4", "1,23.45", "12,34", "abc", "1e5", "NaN", "12 34", "5."]) {
      expect(() => parseDecimalToMinor(bad, "USD"), bad).toThrow(MoneyParseError);
    }
  });

  it("rejects more fraction digits than the currency carries — never rounds", () => {
    expect(() => parseDecimalToMinor("1.234", "USD")).toThrow(MoneyParseError);
    expect(() => parseDecimalToMinor("1.5", "JPY")).toThrow(MoneyParseError);
    expect(() => parseDecimalToMinor("0.0000001", "USDC")).toThrow(MoneyParseError);
  });

  it("rejects unknown currencies", () => {
    expect(() => parseDecimalToMinor("10.00", "XYZ")).toThrow(MoneyParseError);
    expect(() => minorToDecimalString(1000n, "usd")).toThrow(MoneyParseError);
  });
});

describe("money properties", () => {
  it("round-trips parse(format(n)) === n for every known currency", () => {
    fc.assert(
      fc.property(fc.bigInt(AMOUNT_RANGE), fc.constantFrom(...KNOWN_CURRENCIES), (n, currency) => {
        expect(parseDecimalToMinor(minorToDecimalString(n, currency), currency)).toBe(n);
      }),
    );
  });

  it("dot and comma formats agree on the same quantity", () => {
    fc.assert(
      fc.property(fc.bigInt(AMOUNT_RANGE), fc.constantFrom(...KNOWN_CURRENCIES), (n, currency) => {
        const dot = minorToDecimalString(n, currency);
        expect(parseDecimalToMinor(dot.replace(".", ","), currency, "comma")).toBe(n);
      }),
    );
  });

  it("formatting carries the currency's full precision", () => {
    fc.assert(
      fc.property(fc.bigInt(AMOUNT_RANGE), fc.constantFrom(...KNOWN_CURRENCIES), (n, currency) => {
        const exponent = CURRENCY_EXPONENTS[currency as keyof typeof CURRENCY_EXPONENTS];
        const formatted = minorToDecimalString(n, currency);
        const fraction = formatted.split(".")[1] ?? "";
        expect(fraction.length).toBe(exponent);
      }),
    );
  });
});
