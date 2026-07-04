import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { BreakProposal } from "@tieout/contracts";
import {
  exceptions,
  investigationMessageEvents,
  investigationMessages,
  investigationThreads,
} from "../schema.js";
import { syncExceptionsForRun } from "../services/exceptions.js";
import {
  appendInvestigationMessage,
  countAssistantTurns24h,
  loadInvestigationThread,
  tombstoneInvestigationMessage,
} from "../services/investigation.js";
import { persistReconRun } from "../services/recon.js";
import { connectTestDb, truncateAll, type TestDb } from "./helpers.js";

const T0 = new Date("2026-06-01T00:00:00Z");
const T1 = new Date("2026-06-01T01:00:00Z");
const T2 = new Date("2026-06-01T02:00:00Z");
const T3 = new Date("2026-06-01T03:00:00Z");

const brk = (sourceId: string): BreakProposal => ({
  type: "missing_in_ledger",
  details: { txns: [{ source: "stripe", sourceAccount: "acct", sourceId, amountMinor: "100" }] },
});

/** A run with one break, synced into a single exception — the case an investigation hangs off. */
async function seedException(db: TestDb["db"]): Promise<string> {
  const { runId } = await persistReconRun(db, {
    asOf: T0,
    rulesetVersion: "ruleset-v2",
    matches: [],
    breaks: [brk("txn_1")],
    stats: {},
    now: T0,
  });
  await syncExceptionsForRun(db, runId, T0);
  const [exc] = await db.select().from(exceptions);
  return exc!.id;
}

async function eventsFor(db: TestDb["db"], messageId: string): Promise<string[]> {
  const rows = await db
    .select({ kind: investigationMessageEvents.kind })
    .from(investigationMessageEvents)
    .where(eq(investigationMessageEvents.messageId, messageId))
    .orderBy(asc(investigationMessageEvents.createdAt), asc(investigationMessageEvents.id));
  return rows.map((r) => r.kind);
}

describe("investigation thread (append-only)", () => {
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

  it("creates the thread lazily on the first turn, one per case, with increasing seq", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);

    expect(await loadInvestigationThread(db, exceptionId)).toEqual({
      exceptionId,
      threadId: null,
      messages: [],
    });

    const q = await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "where did this charge come from?",
      now: T0,
    });
    const a = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "It traces to raw pagolat record #12.",
      model: "claude-sonnet-5",
      promptVersion: "investigate-v1",
      now: T1,
    });

    const threads = await db.select().from(investigationThreads);
    expect(threads).toHaveLength(1);
    const seqs = (
      await db.select().from(investigationMessages).orderBy(asc(investigationMessages.seq))
    ).map((m) => m.seq);
    expect(seqs).toEqual([1, 2]);
    expect(await eventsFor(db, q.id)).toEqual(["created"]);
    expect(await eventsFor(db, a.id)).toEqual(["created"]);

    const view = await loadInvestigationThread(db, exceptionId);
    expect(view.threadId).toBe(threads[0]!.id);
    expect(view.messages.map((m) => `${m.authorName}: ${m.text}`)).toEqual([
      "ana: where did this charge come from?",
      "Clara: It traces to raw pagolat record #12.",
    ]);
    expect(view.messages[1]!.model).toBe("claude-sonnet-5");
  });

  it("is one shared thread — a second operator appends to the same conversation", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "first",
      now: T0,
    });
    await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "bruno",
      actor: "bruno",
      text: "second",
      now: T1,
    });

    expect(await db.select().from(investigationThreads)).toHaveLength(1);
    const view = await loadInvestigationThread(db, exceptionId);
    expect(view.messages.map((m) => `${m.authorName}:${m.text}`)).toEqual([
      "ana:first",
      "bruno:second",
    ]);
  });

  it("an edit supersedes the old turn — the old row stays and is stamped edited", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    const original = await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "waht is this?",
      now: T0,
    });
    const edited = await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "what is this?",
      supersedesId: original.id,
      eventKind: "edited",
      now: T1,
    });

    const view = await loadInvestigationThread(db, exceptionId);
    expect(view.messages.map((m) => m.id)).toEqual([edited.id]);
    expect(view.messages[0]!.supersedesId).toBe(original.id);
    // Both rows persist; only the live view hides the superseded one.
    expect(await db.select().from(investigationMessages)).toHaveLength(2);
    expect(await eventsFor(db, original.id)).toEqual(["created", "edited"]);
    expect(await eventsFor(db, edited.id)).toEqual(["created"]);
  });

  it("a retry supersedes the old answer and stamps it retried", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    const first = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "first take",
      now: T0,
    });
    const retried = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "second, better take",
      supersedesId: first.id,
      eventKind: "retried",
      now: T1,
    });

    const view = await loadInvestigationThread(db, exceptionId);
    expect(view.messages.map((m) => m.id)).toEqual([retried.id]);
    expect(await eventsFor(db, first.id)).toEqual(["created", "retried"]);
  });

  it("delete tombstones the turn — hidden from the live view, retained in the store", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    const kept = await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "keep me",
      now: T0,
    });
    const bad = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "a made-up record id",
      now: T1,
    });
    await tombstoneInvestigationMessage(db, bad.id, "ana", T2, "hallucinated a record id");

    const view = await loadInvestigationThread(db, exceptionId);
    expect(view.messages.map((m) => m.id)).toEqual([kept.id]);
    // The row and the deleted event (with its note) both persist for the auditor.
    expect(await db.select().from(investigationMessages)).toHaveLength(2);
    const [evt] = await db
      .select()
      .from(investigationMessageEvents)
      .where(
        and(
          eq(investigationMessageEvents.messageId, bad.id),
          eq(investigationMessageEvents.kind, "deleted"),
        ),
      );
    expect(evt!.note).toContain("hallucinated");
  });

  it("tombstoning an unknown message is rejected", async () => {
    const { db } = client;
    await expect(
      tombstoneInvestigationMessage(db, "00000000-0000-0000-0000-000000000000", "ana", T0),
    ).rejects.toThrow(/not found/);
  });

  it("preserves parts, citations and tool trail verbatim", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    const citation = {
      kind: "raw" as const,
      id: "11111111-1111-1111-1111-111111111111",
      label: "raw pagolat #12",
    };
    const tool = { tool: "get_raw", ref: "raw:11111111" };
    const parts = [{ type: "text", text: "hi" }];
    await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "hi",
      parts,
      citations: [citation],
      toolTrail: [tool],
      now: T0,
    });

    const [msg] = (await loadInvestigationThread(db, exceptionId)).messages;
    expect(msg!.citations).toEqual([citation]);
    expect(msg!.toolTrail).toEqual([tool]);
    expect(msg!.parts).toEqual(parts);
  });

  it("counts assistant turns in the window — superseded and deleted spend still counts", async () => {
    const { db } = client;
    const exceptionId = await seedException(db);
    // A user turn is never a paid call.
    await appendInvestigationMessage(db, {
      exceptionId,
      role: "user",
      authorName: "ana",
      actor: "ana",
      text: "q",
      now: T0,
    });
    const a1 = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "a1",
      now: T1,
    });
    await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "a2 (retry of a1)",
      supersedesId: a1.id,
      eventKind: "retried",
      now: T2,
    });
    const a3 = await appendInvestigationMessage(db, {
      exceptionId,
      role: "assistant",
      authorName: "Clara",
      actor: "ana",
      text: "a3",
      now: T3,
    });
    await tombstoneInvestigationMessage(db, a3.id, "ana", T3);

    // All three assistant rows count — retracting a turn never refunds the spend.
    expect(await countAssistantTurns24h(db, new Date("2026-05-01T00:00:00Z"))).toBe(3);
    // Strictly-after semantics: only a3 was written after T2.
    expect(await countAssistantTurns24h(db, T2)).toBe(1);
  });
});
