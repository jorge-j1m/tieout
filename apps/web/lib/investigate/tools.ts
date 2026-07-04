import { tool } from "ai";
import { z } from "zod";
import type {
  Citation,
  RawWithBatch,
  Run,
  RunDiff,
  SourceSummary,
  ToolTrailEntry,
  TransactionWithVersions,
} from "@tieout/contracts";

/**
 * Clara's read-only tools (D38). Each `execute` fetches from an existing api read
 * (D34) — injected, so tests drive them with fakes and no network. Two side
 * effects flow into the shared context: every record a tool actually returned is
 * added to the **verified set** (the only ids the UI will let Clara link), and
 * every call is appended to the **tool trail** (the live provenance spine). A
 * lookup miss returns a plain string; the agent loop reads it and continues.
 *
 * No mutation tools exist — the deterministic engine owns every outcome (D33).
 */

export interface InvestigationReads {
  getTransaction: (id: string) => Promise<TransactionWithVersions | null>;
  getRaw: (id: string) => Promise<RawWithBatch | null>;
  getRun: (id: string) => Promise<Run | null>;
  getRunDiff: (id: string) => Promise<RunDiff | null>;
  getSources: () => Promise<SourceSummary[]>;
}

export interface ToolContext {
  /** id → citation for every record a tool returned; the UI links only these. */
  verified: Map<string, Citation>;
  /** Ordered record of the calls Clara made — the receipts / live trace. */
  toolTrail: ToolTrailEntry[];
}

const idArg = z
  .string()
  .describe("the record's uuid, taken from the case facts or an earlier tool result");

/** Raw payloads can be large and are source-controlled; cap what enters the prompt. */
function capPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return payload.length > 2000 ? `${payload.slice(0, 2000)}…` : payload;
  }
  return payload;
}

export function createInvestigationTools(reads: InvestigationReads, ctx: ToolContext) {
  const cite = (c: Citation) => ctx.verified.set(c.id, c);
  const trail = (name: string, ref: string | null) => ctx.toolTrail.push({ tool: name, ref });

  return {
    get_transaction: tool({
      description:
        "Fetch one transaction by id with its full version chain — current amount, status, currency, reference, and how many versions the line has had.",
      inputSchema: z.object({ id: idArg }),
      execute: async ({ id }) => {
        trail("get_transaction", id);
        const txn = await reads.getTransaction(id);
        if (txn === null) return `No transaction with id ${id}.`;
        cite({ kind: "transaction", id: txn.id, label: `${txn.source} ${txn.sourceId}` });
        return {
          id: txn.id,
          source: txn.source,
          sourceId: txn.sourceId,
          amountMinor: txn.amountMinor,
          currency: txn.currency,
          type: txn.type,
          status: txn.status,
          reference: txn.reference,
          occurredAt: txn.occurredAt,
          isCurrent: txn.isCurrent,
          rawId: txn.rawId,
          versionCount: txn.versions.length,
        };
      },
    }),

    get_raw: tool({
      description:
        "Fetch the raw source record a transaction was normalized from — the original payload — and the batch (file) it landed in. Use it to see exactly what the source sent.",
      inputSchema: z.object({ id: idArg }),
      execute: async ({ id }) => {
        trail("get_raw", id);
        const raw = await reads.getRaw(id);
        if (raw === null) return `No raw record with id ${id}.`;
        cite({ kind: "raw", id: raw.id, label: `${raw.source} ${raw.sourceId} raw` });
        return {
          id: raw.id,
          source: raw.source,
          sourceId: raw.sourceId,
          version: raw.version,
          payload: capPayload(raw.payload),
          batchRef: raw.batch?.externalRef ?? null,
          observedAt: raw.observedAt,
        };
      },
    }),

    get_run: tool({
      description:
        "Fetch a reconciliation run — when it evaluated (asOf), its ruleset version, and status.",
      inputSchema: z.object({ id: idArg }),
      execute: async ({ id }) => {
        trail("get_run", id);
        const run = await reads.getRun(id);
        if (run === null) return `No run with id ${id}.`;
        cite({ kind: "run", id: run.id, label: `run ${run.asOf}` });
        return {
          id: run.id,
          asOf: run.asOf,
          rulesetVersion: run.rulesetVersion,
          status: run.status,
          stats: run.stats,
        };
      },
    }),

    get_run_diff: tool({
      description:
        "What a run changed in the worklist: cases that appeared, reopened (recurred after a resolution), or self-resolved. Use it to tell whether this break is new or recurring.",
      inputSchema: z.object({ id: idArg }),
      execute: async ({ id }) => {
        trail("get_run_diff", id);
        const diff = await reads.getRunDiff(id);
        if (diff === null) return `No run with id ${id}.`;
        cite({ kind: "run", id: diff.runId, label: "run diff" });
        return {
          runId: diff.runId,
          appeared: diff.appeared.map((e) => e.fingerprint),
          reopened: diff.reopened.map((e) => e.fingerprint),
          selfResolved: diff.selfResolved.map((e) => e.fingerprint),
        };
      },
    }),

    get_sources: tool({
      description:
        "List the ingestion sources with record/batch counts and last-landed time. Use it to reason about settlement lag — an unmatched line still inside a source's lag window is pending, not a break.",
      inputSchema: z.object({}),
      execute: async () => {
        trail("get_sources", null);
        const sources = await reads.getSources();
        return sources.map((s) => ({
          source: s.source,
          records: s.records,
          batches: s.batches,
          lastLanded: s.lastLanded,
        }));
      },
    }),
  };
}
