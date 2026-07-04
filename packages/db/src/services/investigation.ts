import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type {
  Citation,
  InvestigationEventKind,
  InvestigationMessageRole,
  ToolTrailEntry,
} from "@tieout/contracts";
import type { Db } from "../client.js";
import {
  investigationMessageEvents,
  investigationMessages,
  investigationThreads,
} from "../schema.js";

/**
 * Investigate with Claude (D38): the one shared conversation per case, stored
 * append-only — the same invariant the financial spine obeys (D8/D30). A message
 * row is written once and never UPDATEd or DELETEd:
 *
 *   - a new turn        → insert a message + a `created` event
 *   - an edit / retry   → insert the replacement (`supersedesId` → the old turn)
 *                         + a `created` event on the new row + an `edited`/`retried`
 *                         event on the old one (which is otherwise untouched)
 *   - a delete          → append a `deleted` event; the row stays (tombstone)
 *
 * The live thread is *derived* from these rows (`loadInvestigationThread`), so a
 * future audit panel can replay everything — retracted and hallucinated turns
 * included. Spend is proxied by counting assistant rows (each is one paid call),
 * deleted or superseded ones included: the money was spent regardless.
 */

/** A turn as the live view shows it — the immutable row, minus audit-only fields (usage, seq). */
export interface InvestigationMessageView {
  id: string;
  role: InvestigationMessageRole;
  authorName: string;
  text: string;
  parts: unknown[];
  citations: Citation[];
  toolTrail: ToolTrailEntry[];
  model: string | null;
  promptVersion: string | null;
  supersedesId: string | null;
  createdAt: Date;
}

/** The one shared thread for a case with its current (non-superseded, non-deleted) turns. */
export interface InvestigationThreadView {
  exceptionId: string;
  /** Null before anyone has asked — the thread is created lazily on the first turn. */
  threadId: string | null;
  messages: InvestigationMessageView[];
}

export interface AppendInvestigationInput {
  exceptionId: string;
  role: InvestigationMessageRole;
  /** The operator's name for a question, the assistant persona (Clara) for an answer. */
  authorName: string;
  /** The operator who acted — recorded on the audit event (may differ from authorName). */
  actor: string;
  text: string;
  parts?: unknown[];
  citations?: Citation[];
  toolTrail?: ToolTrailEntry[];
  model?: string | null;
  promptVersion?: string | null;
  usage?: Record<string, unknown> | null;
  /** The turn this one replaces (edit/retry); omit for an original turn. */
  supersedesId?: string | null;
  /** `created` (default) or the replacement kind (`edited`/`retried`) stamped on the superseded turn. */
  eventKind?: InvestigationEventKind;
  now: Date;
}

function mapMessage(row: typeof investigationMessages.$inferSelect): InvestigationMessageView {
  return {
    id: row.id,
    role: row.role,
    authorName: row.authorName,
    text: row.text,
    parts: (row.parts ?? []) as unknown[],
    citations: (row.citations ?? []) as Citation[],
    toolTrail: (row.toolTrail ?? []) as ToolTrailEntry[],
    model: row.model,
    promptVersion: row.promptVersion,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt,
  };
}

/**
 * Append a turn to a case's investigation, creating the thread on the first one.
 * The thread row is locked for the duration so concurrent operators on the same
 * case take strictly increasing `seq` values — the ordering never ties.
 */
export async function appendInvestigationMessage(
  db: Db,
  input: AppendInvestigationInput,
): Promise<InvestigationMessageView> {
  const { exceptionId, now } = input;
  return db.transaction(async (tx) => {
    await tx
      .insert(investigationThreads)
      .values({ exceptionId })
      .onConflictDoNothing({ target: investigationThreads.exceptionId });
    // Serialize writers per case: whoever holds the thread row computes `seq` alone.
    const [thread] = await tx
      .select({ id: investigationThreads.id })
      .from(investigationThreads)
      .where(eq(investigationThreads.exceptionId, exceptionId))
      .for("update");
    if (thread === undefined) {
      throw new Error(`investigation thread for exception ${exceptionId} vanished`);
    }
    const [seqRow] = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${investigationMessages.seq}), 0)` })
      .from(investigationMessages)
      .where(eq(investigationMessages.threadId, thread.id));
    const seq = Number(seqRow?.maxSeq ?? 0) + 1;

    const [message] = await tx
      .insert(investigationMessages)
      .values({
        threadId: thread.id,
        seq,
        role: input.role,
        authorName: input.authorName,
        text: input.text,
        parts: input.parts ?? [],
        citations: input.citations ?? [],
        toolTrail: input.toolTrail ?? [],
        model: input.model ?? null,
        promptVersion: input.promptVersion ?? null,
        usage: input.usage ?? null,
        supersedesId: input.supersedesId ?? null,
        createdAt: now,
      })
      .returning();
    if (message === undefined) throw new Error("investigation message insert returned no row");

    // The new row is always born (`created`); an edit/retry also stamps the
    // superseded turn with what happened to it — that row is never itself changed.
    const events: (typeof investigationMessageEvents.$inferInsert)[] = [
      { messageId: message.id, kind: "created", actor: input.actor, createdAt: now },
    ];
    if (input.supersedesId) {
      const replacement: InvestigationEventKind =
        input.eventKind === "retried" ? "retried" : "edited";
      events.push({
        messageId: input.supersedesId,
        kind: replacement,
        actor: input.actor,
        createdAt: now,
      });
    }
    await tx.insert(investigationMessageEvents).values(events);

    return mapMessage(message);
  });
}

/** Tombstone a turn (D38): append a `deleted` event and leave the row for the audit trail. */
export async function tombstoneInvestigationMessage(
  db: Db,
  messageId: string,
  actor: string,
  now: Date,
  note?: string,
): Promise<void> {
  const [message] = await db
    .select({ id: investigationMessages.id })
    .from(investigationMessages)
    .where(eq(investigationMessages.id, messageId));
  if (message === undefined) throw new Error(`investigation message ${messageId} not found`);
  await db.insert(investigationMessageEvents).values({
    messageId,
    kind: "deleted",
    actor,
    note: note ?? null,
    createdAt: now,
  });
}

/**
 * The live thread for a case: every turn ordered by `seq`, minus the ones that a
 * later version replaced (`supersedesId`) or a `deleted` event retracted. The
 * derivation is the read side of the append-only store — nothing here mutates.
 */
export async function loadInvestigationThread(
  db: Db,
  exceptionId: string,
): Promise<InvestigationThreadView> {
  const [thread] = await db
    .select({ id: investigationThreads.id })
    .from(investigationThreads)
    .where(eq(investigationThreads.exceptionId, exceptionId));
  if (thread === undefined) return { exceptionId, threadId: null, messages: [] };

  const rows = await db
    .select()
    .from(investigationMessages)
    .where(eq(investigationMessages.threadId, thread.id))
    .orderBy(asc(investigationMessages.seq));
  if (rows.length === 0) return { exceptionId, threadId: thread.id, messages: [] };

  const ids = rows.map((r) => r.id);
  const deletedRows = await db
    .select({ messageId: investigationMessageEvents.messageId })
    .from(investigationMessageEvents)
    .where(
      and(
        eq(investigationMessageEvents.kind, "deleted"),
        inArray(investigationMessageEvents.messageId, ids),
      ),
    );
  const deleted = new Set(deletedRows.map((r) => r.messageId));
  const superseded = new Set(
    rows.map((r) => r.supersedesId).filter((v): v is string => v !== null),
  );
  const current = rows.filter((r) => !deleted.has(r.id) && !superseded.has(r.id));
  return { exceptionId, threadId: thread.id, messages: current.map(mapMessage) };
}

/**
 * Assistant turns written since `since` — the live-spend proxy for the budget
 * gate. Counts every assistant row, superseded and deleted included: each was a
 * real paid call, so retracting the turn never refunds the spend.
 */
export async function countAssistantTurns24h(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(investigationMessages)
    .where(and(eq(investigationMessages.role, "assistant"), gt(investigationMessages.createdAt, since)));
  return Number(row?.count ?? 0);
}
