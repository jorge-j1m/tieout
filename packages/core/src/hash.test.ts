import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalJson, contentHash, syntheticSourceId } from "./hash.js";

describe("canonicalJson", () => {
  it("is invariant to object key order, recursively", () => {
    const a = { x: 1, y: { b: [1, 2], a: "s" }, z: null };
    const b = { z: null, y: { a: "s", b: [1, 2] }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("is sensitive to array order and values", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(contentHash({ amount: "10.50" })).not.toBe(contentHash({ amount: "10.51" }));
  });

  it("drops undefined object values, like JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("refuses values JSON cannot represent", () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ n: 10n })).toThrow(TypeError);
  });

  it("parses back to a deep-equal value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });
});

describe("syntheticSourceId", () => {
  it("is deterministic and distinguishes legitimate duplicate lines by occurrence index", () => {
    const line = "2026-05-03,ACME,1.234,56,payment";
    expect(syntheticSourceId("stmt-2026-05.csv", line, 0)).toBe(
      syntheticSourceId("stmt-2026-05.csv", line, 0),
    );
    expect(syntheticSourceId("stmt-2026-05.csv", line, 0)).not.toBe(
      syntheticSourceId("stmt-2026-05.csv", line, 1),
    );
    expect(syntheticSourceId("stmt-2026-05.csv", line, 0)).not.toBe(
      syntheticSourceId("stmt-2026-06.csv", line, 0),
    );
  });

  it("rejects negative or fractional occurrence indexes", () => {
    expect(() => syntheticSourceId("f", "l", -1)).toThrow(TypeError);
    expect(() => syntheticSourceId("f", "l", 0.5)).toThrow(TypeError);
  });
});
