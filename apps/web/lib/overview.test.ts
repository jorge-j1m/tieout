import { describe, expect, it } from "vitest";
import type { Break, Run } from "@tieout/contracts";
import { duplicateCandidate, fxDrift, missingInLedger, unexpectedFee } from "./explain/fixtures";
import { buildTrend, pendingCount, rollupBreaksByType, runDurationSeconds } from "./overview";

describe("rollupBreaksByType", () => {
  it("counts and sums magnitudes per type, in canonical order", () => {
    const breaks: Break[] = [missingInLedger, unexpectedFee, fxDrift, duplicateCandidate];
    const rows = rollupBreaksByType(breaks);
    // canonical order puts missing_in_ledger before the others present here
    expect(rows.map((r) => r.type)).toEqual([
      "missing_in_ledger",
      "duplicate_candidate",
      "unexpected_fee",
      "fx_drift",
    ]);
    const fee = rows.find((r) => r.type === "unexpected_fee")!;
    expect(fee.count).toBe(1);
    expect(fee.totalMinor).toBe("850"); // magnitude of −850
  });

  it("sums two breaks of the same type", () => {
    const rows = rollupBreaksByType([missingInLedger, { ...missingInLedger, id: "x" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(2);
    expect(rows[0]!.totalMinor).toBe("13362"); // 6681 + 6681, in bigint
  });
});

const run = (id: string, breaks: number, over: Partial<Run["stats"]> = {}): Run => ({
  id,
  asOf: `2026-06-${id.padStart(2, "0")}T00:00:00.000Z`,
  rulesetVersion: "ruleset-v2",
  status: "completed",
  startedAt: "2026-06-05T00:00:00.000Z",
  finishedAt: "2026-06-05T00:00:52.000Z",
  createdAt: "2026-06-05T00:00:00.000Z",
  stats: {
    evaluatedTransactions: 0,
    ledgerTransactions: 0,
    externalTransactions: 0,
    matches: 0,
    matchedTransactions: 0,
    breaks: {},
    totalBreaks: breaks,
    pendingBySource: {},
    pending: [],
    config: { windowMs: 0, toleranceMinor: "0", fxToleranceBps: null, fxRates: [], lagMsBySource: null, duplicateWindowMs: null },
    ...over,
  },
});

describe("buildTrend", () => {
  it("reverses newest-first into chronological and flags direction", () => {
    const trend = buildTrend([run("3", 9), run("2", 4), run("1", 6)]);
    expect(trend.map((p) => p.runId)).toEqual(["1", "2", "3"]);
    expect(trend.map((p) => p.rose)).toEqual([null, false, true]);
  });
});

describe("run helpers", () => {
  it("sums pending across sources", () => {
    expect(pendingCount(run("1", 0, { pendingBySource: { stripe: 2, pagolat: 1 } }))).toBe(3);
  });

  it("computes duration in seconds", () => {
    expect(runDurationSeconds(run("1", 0))).toBe(52);
  });
});
