import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { BreakProposal } from "@tieout/contracts";
import { exceptionEvents, exceptions } from "../schema.js";
import {
  acknowledgeException,
  resolveException,
  syncExceptionsForRun,
} from "../services/exceptions.js";
import { persistReconRun } from "../services/recon.js";
import { connectTestDb, truncateAll, type TestDb } from "./helpers.js";

const T0 = new Date("2026-06-01T00:00:00Z");
const T1 = new Date("2026-06-02T00:00:00Z");
const T2 = new Date("2026-06-03T00:00:00Z");

/** A break consuming one identity — the fingerprint is derived from it. */
const brk = (sourceId: string): BreakProposal => ({
  type: "missing_in_ledger",
  details: {
    txns: [{ source: "stripe", sourceAccount: "acct", sourceId, amountMinor: "100" }],
  },
});

async function run(db: TestDb["db"], at: Date, breaks: BreakProposal[]): Promise<string> {
  const { runId } = await persistReconRun(db, {
    asOf: at,
    rulesetVersion: "ruleset-v2",
    matches: [],
    breaks,
    stats: {},
    now: at,
  });
  return runId;
}

describe("exceptions workflow", () => {
  let client: TestDb;

  beforeAll(async () => {
    client = await connectTestDb();
  });
  afterAll(async () => {
    await client.close();
  });
  beforeEach(async () => {
    await truncateAll(client.db);
  });

  it("opens an exception per new logical break, with an opened event", async () => {
    const { db } = client;
    const runId = await run(db, T0, [brk("txn_1"), brk("txn_2")]);
    const synced = await syncExceptionsForRun(db, runId, T0);
    expect(synced).toEqual({ opened: 2, recurred: 0, reopened: 0, selfResolved: 0 });

    const rows = await db.select().from(exceptions);
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => e.status === "open" && e.firstSeenRunId === runId)).toBe(true);
    const events = await db.select().from(exceptionEvents);
    expect(events.map((e) => e.kind)).toEqual(["opened", "opened"]);
  });

  it("a recurring break bumps the same exception — one case, not one per run", async () => {
    const { db } = client;
    const run1 = await run(db, T0, [brk("txn_1")]);
    await syncExceptionsForRun(db, run1, T0);
    const run2 = await run(db, T1, [brk("txn_1")]);
    const synced = await syncExceptionsForRun(db, run2, T1);
    expect(synced).toEqual({ opened: 0, recurred: 1, reopened: 0, selfResolved: 0 });

    const [exc] = await db.select().from(exceptions);
    expect(exc).toMatchObject({ firstSeenRunId: run1, lastSeenRunId: run2, status: "open" });
    // Recurrence is not news: still just the opened event.
    expect(await db.select().from(exceptionEvents)).toHaveLength(1);
  });

  it("acknowledge → resolve records the human trail; the break recurring reopens the case", async () => {
    const { db } = client;
    const run1 = await run(db, T0, [brk("txn_1")]);
    await syncExceptionsForRun(db, run1, T0);
    const [exc] = await db.select().from(exceptions);

    await acknowledgeException(db, exc!.id, "ana@mercadia", T0);
    await resolveException(db, exc!.id, "ana@mercadia", "booked the missing fee, JE-441", T1);
    expect((await db.select().from(exceptions))[0]!.status).toBe("resolved");

    // The fix didn't take: the next run still reports the break.
    const run2 = await run(db, T2, [brk("txn_1")]);
    const synced = await syncExceptionsForRun(db, run2, T2);
    expect(synced).toEqual({ opened: 0, recurred: 0, reopened: 1, selfResolved: 0 });

    const kinds = (
      await db.select().from(exceptionEvents).orderBy(asc(exceptionEvents.createdAt), asc(exceptionEvents.id))
    ).map((e) => e.kind);
    expect(kinds).toEqual(["opened", "acknowledged", "resolved", "reopened"]);
    const notes = await db
      .select({ note: exceptionEvents.note })
      .from(exceptionEvents)
      .where(eq(exceptionEvents.kind, "resolved"));
    expect(notes[0]!.note).toContain("JE-441");
  });

  it("an open exception whose break vanished self-resolves — the books were fixed", async () => {
    const { db } = client;
    const run1 = await run(db, T0, [brk("txn_1")]);
    await syncExceptionsForRun(db, run1, T0);
    const run2 = await run(db, T1, []);
    const synced = await syncExceptionsForRun(db, run2, T1);
    expect(synced).toEqual({ opened: 0, recurred: 0, reopened: 0, selfResolved: 1 });

    const [exc] = await db.select().from(exceptions);
    expect(exc!.status).toBe("resolved");
    const kinds = (await db.select().from(exceptionEvents)).map((e) => e.kind).sort();
    expect(kinds).toEqual(["opened", "self_resolved"]);
  });

  it("sync is idempotent per run — retries change nothing", async () => {
    const { db } = client;
    const run1 = await run(db, T0, [brk("txn_1")]);
    await syncExceptionsForRun(db, run1, T0);
    const again = await syncExceptionsForRun(db, run1, T0);
    expect(again).toEqual({ opened: 0, recurred: 0, reopened: 0, selfResolved: 0 });
    expect(await db.select().from(exceptionEvents)).toHaveLength(1);
  });

  it("illegal transitions are rejected, not absorbed", async () => {
    const { db } = client;
    const run1 = await run(db, T0, [brk("txn_1")]);
    await syncExceptionsForRun(db, run1, T0);
    const [exc] = await db.select().from(exceptions);

    await resolveException(db, exc!.id, "ana@mercadia", "fixed", T1);
    await expect(acknowledgeException(db, exc!.id, "ana@mercadia", T1)).rejects.toThrow(
      /cannot move to acknowledged/,
    );
    await expect(resolveException(db, exc!.id, "ana@mercadia", "again", T1)).rejects.toThrow(
      /cannot move to resolved/,
    );
  });
});
