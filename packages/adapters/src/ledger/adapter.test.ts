import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLedgerAdapter } from "./adapter.js";
import { expectGolden, fixturesDir } from "../test/golden.js";

const entriesFile = path.join(fixturesDir, "ledger/entries.json");
const driftFile = path.join(fixturesDir, "ledger/drift.json");

describe("ledger adapter", () => {
  it("normalizes well-formed entries (golden)", async () => {
    await expectGolden(
      createLedgerAdapter({ dataFile: entriesFile }),
      path.join(fixturesDir, "ledger/entries.expected.json"),
    );
  });

  it("quarantines every drifted entry with structured errors (golden)", async () => {
    await expectGolden(
      createLedgerAdapter({ dataFile: driftFile }),
      path.join(fixturesDir, "ledger/drift.expected.json"),
    );
  });

  it("lands the whole file as one unit keyed by content hash", async () => {
    const adapter = createLedgerAdapter({ dataFile: entriesFile });
    const window = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
    const [first] = await adapter.land({ window });
    const [again] = await adapter.land({ window });
    expect(first!.idempotencyKey).toBe(again!.idempotencyKey);
    expect(first!.kind).toBe("file");
    expect(first!.records).toHaveLength(5);
    expect(first!.controlTotals).toEqual({ entryCount: 5 });
  });

  it("never drops a record at landing: a missing entryId gets a deterministic synthetic id", async () => {
    const adapter = createLedgerAdapter({ dataFile: driftFile });
    const window = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
    const [batch] = await adapter.land({ window });
    const synthetic = batch!.records.filter((r) => r.sourceId.startsWith("syn_"));
    expect(synthetic).toHaveLength(1);
    const [batchAgain] = await adapter.land({ window });
    expect(batchAgain!.records.map((r) => r.sourceId)).toEqual(
      batch!.records.map((r) => r.sourceId),
    );
  });
});
