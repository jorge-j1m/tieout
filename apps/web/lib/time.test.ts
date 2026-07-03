import { describe, expect, it } from "vitest";
import { age, formatUtc, formatUtcDate } from "./time";

describe("UTC formatting — always explicit, never local", () => {
  it("renders an instant with its UTC label", () => {
    expect(formatUtc("2026-06-05T00:00:00.000Z")).toBe("2026-06-05 00:00 UTC");
  });

  it("renders a date alone", () => {
    expect(formatUtcDate("2026-06-05T18:22:00.000Z")).toBe("2026-06-05");
  });

  it("ages in days past the first 24h, hours inside it, minimum 1h", () => {
    const now = "2026-06-05T09:00:00.000Z";
    expect(age("2026-05-29T09:00:00.000Z", now)).toBe("7d");
    expect(age("2026-06-05T03:00:00.000Z", now)).toBe("6h");
    expect(age("2026-06-05T08:59:00.000Z", now)).toBe("1h");
  });
});
