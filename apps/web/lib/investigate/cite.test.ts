import { describe, expect, it } from "vitest";
import { parseCiteHref } from "./cite";

describe("parseCiteHref", () => {
  it("parses a well-formed cite link", () => {
    expect(parseCiteHref("cite:transaction:11111111-1111-4111-8111-111111111111")).toEqual({
      kind: "transaction",
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("accepts every citation kind", () => {
    for (const kind of ["transaction", "raw", "run", "break", "exception"] as const) {
      expect(parseCiteHref(`cite:${kind}:abc`)).toEqual({ kind, id: "abc" });
    }
  });

  it("rejects a non-cite href, an unknown kind, and a missing id", () => {
    expect(parseCiteHref("https://example.com")).toBeNull();
    expect(parseCiteHref(undefined)).toBeNull();
    expect(parseCiteHref("cite:ledger:abc")).toBeNull(); // not a citation kind
    expect(parseCiteHref("cite:run:")).toBeNull(); // empty id
    expect(parseCiteHref("cite:run")).toBeNull(); // no id segment
  });
});
