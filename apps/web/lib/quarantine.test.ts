import { describe, expect, it } from "vitest";
import { declaredFooter, quarantineReasons, quarantineTitle } from "./quarantine";

describe("quarantineReasons", () => {
  it("reads structured {path, message} errors and ignores the malformed", () => {
    const errors = [
      { path: "footer.total_net", message: "lines sum to 145000 minor units but the file declares 200000" },
      { message: "no path is fine" },
      "a bare string is not a reason",
      null,
    ];
    expect(quarantineReasons(errors)).toEqual([
      { path: "footer.total_net", message: "lines sum to 145000 minor units but the file declares 200000" },
      { path: "", message: "no path is fine" },
    ]);
  });

  it("returns nothing for a non-array", () => {
    expect(quarantineReasons(undefined)).toEqual([]);
    expect(quarantineReasons({ message: "not a list" })).toEqual([]);
  });
});

describe("declaredFooter", () => {
  it("extracts a batch footer verbatim, decimals untouched", () => {
    const payload = { totalNet: "2000,00", lineCount: 2, closingBalance: "7000,00", openingBalance: "5000,00" };
    expect(declaredFooter(payload)).toEqual({
      lineCount: 2,
      totalNet: "2000,00",
      openingBalance: "5000,00",
      closingBalance: "7000,00",
    });
  });

  it("is null for a line-level payload with no footer fields", () => {
    expect(declaredFooter({ line: "…;…;…", offset: "0" })).toBeNull();
    expect(declaredFooter("a raw string")).toBeNull();
  });
});

describe("quarantineTitle", () => {
  it("prefers the file name, then the line id, then the source", () => {
    expect(quarantineTitle({ batchRef: "pagolat-2026-05-24.csv", sourceId: null, source: "pagolat" })).toBe(
      "pagolat-2026-05-24.csv",
    );
    expect(quarantineTitle({ batchRef: null, sourceId: "line-7", source: "pagolat" })).toBe("line-7");
    expect(quarantineTitle({ batchRef: null, sourceId: null, source: "pagolat" })).toBe("pagolat");
  });
});
