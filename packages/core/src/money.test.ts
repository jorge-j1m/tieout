import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CURRENCY_EXPONENTS,
  MoneyParseError,
  convertMinor,
  isWithinBps,
  minorToDecimalString,
  parseDecimalToMinor,
  parseRate,
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

describe("convertMinor — fx at match time (D7)", () => {
  it("converts with an explicit rate, exact when precision allows", () => {
    // 1,000.00 MXN at 0.0588 = 58.80 USD, exactly.
    expect(convertMinor(100_000n, "MXN", "USD", parseRate("0.0588"))).toBe(5880n);
    // Crossing exponents: 100.00 USD at 147.5 = 14,750 JPY (USD exp 2 → JPY exp 0).
    expect(convertMinor(10_000n, "USD", "JPY", parseRate("147.5"))).toBe(14_750n);
    // Into more precision: 1.00 USD = 1.000000 USDC at par.
    expect(convertMinor(100n, "USD", "USDC", parseRate("1"))).toBe(1_000_000n);
  });

  it("rounds half-even when the target currency cannot carry the precision", () => {
    // 0.05 at rate 0.5 → 0.025 → 2 (ties go to even).
    expect(convertMinor(5n, "USD", "USD", parseRate("0.5"))).toBe(2n);
    // 0.15 at rate 0.5 → 0.075 → 8.
    expect(convertMinor(15n, "USD", "USD", parseRate("0.5"))).toBe(8n);
    // Off the tie it rounds normally: 0.07 at 0.51 → 3.57 → 4.
    expect(convertMinor(7n, "USD", "USD", parseRate("0.51"))).toBe(4n);
  });

  it("rejects malformed and non-positive rates", () => {
    for (const bad of ["", "0", "0.000", "-1.5", "1,5", "1e-3", "abc"]) {
      expect(() => parseRate(bad), bad).toThrow(MoneyParseError);
    }
  });

  it("is sign-symmetric and monotone (property)", () => {
    const arbRate = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 9n }), fc.integer({ min: 0, max: 8 }))
      .map(([m, s]) => ({ mantissa: m, scale: s }));
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), arbRate, (n, rate) => {
        expect(convertMinor(-n, "MXN", "USD", rate)).toBe(-convertMinor(n, "MXN", "USD", rate));
      }),
    );
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        arbRate,
        (a, b, rate) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(convertMinor(lo, "MXN", "USD", rate) <= convertMinor(hi, "MXN", "USD", rate)).toBe(
            true,
          );
        },
      ),
    );
  });

  it("trailing rate zeros never change the result (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (n) => {
        expect(convertMinor(n, "MXN", "USD", parseRate("0.058800"))).toBe(
          convertMinor(n, "MXN", "USD", parseRate("0.0588")),
        );
      }),
    );
  });
});

describe("isWithinBps", () => {
  it("accepts at the boundary, rejects one minor unit past it", () => {
    // 10 bps of 100,000 = 100.
    expect(isWithinBps(100_100n, 100_000n, 10)).toBe(true);
    expect(isWithinBps(100_101n, 100_000n, 10)).toBe(false);
    expect(isWithinBps(99_900n, 100_000n, 10)).toBe(true);
    expect(isWithinBps(99_899n, 100_000n, 10)).toBe(false);
  });

  it("expected zero admits only an exact match", () => {
    expect(isWithinBps(0n, 0n, 10_000)).toBe(true);
    expect(isWithinBps(1n, 0n, 10_000)).toBe(false);
  });

  it("is symmetric in drift direction and monotone in tolerance (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 6n }),
        fc.integer({ min: 0, max: 10_000 }),
        (expected, delta, bps) => {
          expect(isWithinBps(expected + delta, expected, bps)).toBe(
            isWithinBps(expected - delta, expected, bps),
          );
          if (isWithinBps(expected + delta, expected, bps)) {
            expect(isWithinBps(expected + delta, expected, bps + 1)).toBe(true);
          }
        },
      ),
    );
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
