import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney — bigint minor units in, exact figures out", () => {
  it("renders USD with 2 decimals and a symbol", () => {
    expect(formatMoney("6681", "USD")).toBe("$66.81");
  });

  it("uses a real minus sign (U+2212), never a hyphen", () => {
    expect(formatMoney("-6681", "USD")).toBe("−$66.81");
  });

  it("groups thousands", () => {
    expect(formatMoney("123456789", "USD")).toBe("$1,234,567.89");
  });

  it("suffixes non-symbol currencies with their code", () => {
    expect(formatMoney("290000", "MXN")).toBe("2,900.00 MXN");
  });

  it("respects a zero-exponent currency", () => {
    expect(formatMoney("2900", "JPY")).toBe("¥2,900");
  });

  it("respects a six-exponent currency", () => {
    expect(formatMoney("1500000", "USDC")).toBe("1.500000 USDC");
  });

  it("pads fractional parts to the full exponent", () => {
    expect(formatMoney("5", "USD")).toBe("$0.05");
    expect(formatMoney("-5", "USD")).toBe("−$0.05");
  });

  it("accepts bigint input", () => {
    expect(formatMoney(6681n, "USD")).toBe("$66.81");
  });

  it("renders zero without a sign", () => {
    expect(formatMoney("0", "USD")).toBe("$0.00");
  });

  it("falls back to 2 decimals + code suffix for unknown currencies", () => {
    expect(formatMoney("1234", "EUR")).toBe("12.34 EUR");
  });

  it("rejects a non-integer string rather than guessing", () => {
    expect(() => formatMoney("66.81", "USD")).toThrow();
  });
});
