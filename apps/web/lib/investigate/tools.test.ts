import { describe, expect, it } from "vitest";
import type {
  RawWithBatch,
  Run,
  RunDiff,
  SourceSummary,
  TransactionWithVersions,
} from "@tieout/contracts";
import {
  createInvestigationTools,
  type InvestigationReads,
  type ToolContext,
} from "./tools";

const TXN_ID = "11111111-1111-4111-8111-111111111111";
const RAW_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

const reads: InvestigationReads = {
  getTransaction: async (id) =>
    id === TXN_ID
      ? ({
          id: TXN_ID,
          source: "stripe",
          sourceId: "ch_1",
          amountMinor: "500",
          currency: "USD",
          type: "payment",
          status: "settled",
          reference: null,
          occurredAt: "2026-05-01T00:00:00.000Z",
          isCurrent: true,
          rawId: RAW_ID,
          versions: [{}],
        } as unknown as TransactionWithVersions)
      : null,
  getRaw: async (id) =>
    id === RAW_ID
      ? ({
          id: RAW_ID,
          source: "stripe",
          sourceId: "ch_1",
          version: 1,
          payload: { amount: "5.00" },
          observedAt: "2026-05-01T00:00:00.000Z",
          batch: { externalRef: "stripe-2026-05.csv" },
        } as unknown as RawWithBatch)
      : null,
  getRun: async (id) =>
    id === RUN_ID
      ? ({
          id: RUN_ID,
          asOf: "2026-05-02T00:00:00.000Z",
          rulesetVersion: "ruleset-v2",
          status: "completed",
          stats: {},
        } as unknown as Run)
      : null,
  getRunDiff: async (id) =>
    id === RUN_ID
      ? ({
          runId: RUN_ID,
          appeared: [{ exceptionId: "e1", fingerprint: "fp_a", type: "missing_in_ledger" }],
          reopened: [],
          selfResolved: [],
        } as unknown as RunDiff)
      : null,
  getSources: async () => [
    {
      source: "stripe",
      records: 10,
      batches: 2,
      lastLanded: "2026-05-02T00:00:00.000Z",
      quarantinedUnits: 0,
    } as unknown as SourceSummary,
  ],
};

function freshTools() {
  const ctx: ToolContext = { verified: new Map(), toolTrail: [] };
  return { tools: createInvestigationTools(reads, ctx), ctx };
}

// The tool `execute` second argument (ToolCallOptions) is irrelevant here; supply a stub.
const OPTS = { toolCallId: "t", messages: [] } as unknown as Parameters<
  NonNullable<ReturnType<typeof createInvestigationTools>["get_transaction"]["execute"]>
>[1];

describe("investigation tools", () => {
  it("get_transaction adds the returned record to the verified set and the trail", async () => {
    const { tools, ctx } = freshTools();
    const out = await tools.get_transaction.execute!({ id: TXN_ID }, OPTS);
    expect(out).toMatchObject({ id: TXN_ID, source: "stripe", versionCount: 1 });
    expect(ctx.verified.get(TXN_ID)).toEqual({
      kind: "transaction",
      id: TXN_ID,
      label: "stripe ch_1",
    });
    expect(ctx.toolTrail).toEqual([{ tool: "get_transaction", ref: TXN_ID }]);
  });

  it("get_raw verifies the raw record and names its batch", async () => {
    const { tools, ctx } = freshTools();
    const out = (await tools.get_raw.execute!({ id: RAW_ID }, OPTS)) as { batchRef: string };
    expect(out.batchRef).toBe("stripe-2026-05.csv");
    expect(ctx.verified.get(RAW_ID)).toMatchObject({ kind: "raw", id: RAW_ID });
  });

  it("a lookup miss returns a string and verifies nothing, but still records the attempt", async () => {
    const { tools, ctx } = freshTools();
    const out = await tools.get_transaction.execute!({ id: RUN_ID }, OPTS);
    expect(typeof out).toBe("string");
    expect(ctx.verified.size).toBe(0);
    expect(ctx.toolTrail).toEqual([{ tool: "get_transaction", ref: RUN_ID }]);
  });

  it("get_run_diff summarizes fingerprints and cites the run", async () => {
    const { tools, ctx } = freshTools();
    const out = (await tools.get_run_diff.execute!({ id: RUN_ID }, OPTS)) as { appeared: string[] };
    expect(out.appeared).toEqual(["fp_a"]);
    expect(ctx.verified.get(RUN_ID)).toMatchObject({ kind: "run" });
  });

  it("get_sources lists sources without minting a citation", async () => {
    const { tools, ctx } = freshTools();
    const out = (await tools.get_sources.execute!({}, OPTS)) as { source: string }[];
    expect(out.map((s) => s.source)).toEqual(["stripe"]);
    expect(ctx.verified.size).toBe(0); // sources aren't citable records
    expect(ctx.toolTrail).toEqual([{ tool: "get_sources", ref: null }]);
  });

  it("an id never fetched is never in the verified set", async () => {
    const { tools, ctx } = freshTools();
    await tools.get_transaction.execute!({ id: TXN_ID }, OPTS);
    expect(ctx.verified.has(RAW_ID)).toBe(false);
  });
});
