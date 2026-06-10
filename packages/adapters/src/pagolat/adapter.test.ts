import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPagolatAdapter,
  normalizePagolatLine,
  pagolatSettlementKey,
} from "./adapter.js";
import { expectGolden, fixturesDir } from "../test/golden.js";

const cleanFile = path.join(fixturesDir, "pagolat/settlement-clean.csv");
const driftFile = path.join(fixturesDir, "pagolat/settlement-drift.csv");
const badTotalsFile = path.join(fixturesDir, "pagolat/settlement-bad-totals.csv");

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };

describe("pagolat adapter", () => {
  it("normalizes a clean settlement file (golden)", async () => {
    await expectGolden(
      createPagolatAdapter({ files: [cleanFile] }),
      path.join(fixturesDir, "pagolat/settlement-clean.expected.json"),
    );
  });

  it("quarantines every drifted line with structured errors (golden)", async () => {
    await expectGolden(
      createPagolatAdapter({ files: [driftFile] }),
      path.join(fixturesDir, "pagolat/settlement-drift.expected.json"),
    );
  });

  it("lands a complete, grouped unit with declared control totals", async () => {
    const adapter = createPagolatAdapter({ files: [cleanFile] });
    const [batch] = await adapter.land({ window: WINDOW });
    expect(batch).toMatchObject({
      source: "pagolat",
      kind: "file",
      completeUnit: { key: "pagolat:mx-merchant-014:2026-05-21" },
      controlTotals: { lineCount: 6, totalNet: "1.683,19" },
    });
    expect(batch!.integrityFailure).toBeUndefined();
    expect(batch!.records).toHaveLength(6);
  });

  it("a file failing its control totals is marked for whole-batch quarantine (D13)", async () => {
    const adapter = createPagolatAdapter({ files: [badTotalsFile] });
    const [batch] = await adapter.land({ window: WINDOW });
    expect(batch!.integrityFailure).toEqual([
      {
        path: "footer.total_net",
        message: expect.stringContaining("lines sum to 43695"),
      },
    ]);
  });

  it("identical duplicate lines stay two records with distinct deterministic ids", async () => {
    const adapter = createPagolatAdapter({ files: [cleanFile] });
    const [first] = await adapter.land({ window: WINDOW });
    const [second] = await adapter.land({ window: WINDOW });
    const kioskIds = first!.records
      .filter((r) => (r.payload as { line: string }).line.includes("kiosko"))
      .map((r) => r.sourceId);
    expect(kioskIds).toHaveLength(2);
    expect(new Set(kioskIds).size).toBe(2);
    // …and the ids are stable across landings — identity, not randomness (D10).
    expect(second!.records.map((r) => r.sourceId)).toEqual(first!.records.map((r) => r.sourceId));
  });

  it("a surviving line keeps its identity when the file is restated — ids hang off the unit, not the bytes", async () => {
    const adapter = createPagolatAdapter({ files: [cleanFile, badTotalsFile] });
    const [clean, other] = await adapter.land({ window: WINDOW });
    // Different file content → different idempotency keys, but identity derivation
    // uses the stable unit key: same line in a restated 05-21 file would re-identify.
    expect(clean!.idempotencyKey).not.toBe(other!.idempotencyKey);
    expect(clean!.records[0]!.sourceId).toMatch(/^syn_/);
    const again = await adapter.land({ window: WINDOW });
    expect(again[0]!.records[0]!.sourceId).toBe(clean!.records[0]!.sourceId);
  });

  it("converts local time to UTC exactly once, at the door (Rule 9)", () => {
    const result = normalizePagolatLine({
      source: "pagolat",
      sourceAccount: "mx-merchant-014",
      sourceId: "syn_x",
      payload: {
        line: "LINE;2026-05-21 09:15:00;sale;plord_801;1.250,00;36,25;1.213,75;Venta",
        offset: "-06:00",
        settlementKey: pagolatSettlementKey("mx-merchant-014", "2026-05-21"),
      },
      observedAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.txn.occurredAt.toISOString()).toBe("2026-05-21T15:15:00.000Z");
      expect(result.txn.amountMinor).toBe(125000n);
      expect(result.txn.netMinor).toBe(121375n);
      expect(result.txn.groupRef).toBe("PL-mx-merchant-014-2026-05-21");
      expect(result.txn.currency).toBe("MXN");
    }
  });

  it("archives the raw file when an archiver is available (D9)", async () => {
    const stored: string[] = [];
    const adapter = createPagolatAdapter({ files: [cleanFile] });
    const [batch] = await adapter.land({
      window: WINDOW,
      archive: (key, body) => {
        stored.push(key);
        expect(body).toContain("PAGOLAT;SETTLEMENT;v1");
        return Promise.resolve(`s3://tieout-raw/${key}`);
      },
    });
    expect(stored).toHaveLength(1);
    expect(batch!.archiveUrl).toBe(`s3://tieout-raw/${stored[0]}`);
  });
});
