import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../client.js";
import { breaks, exceptionEvents, exceptions } from "../schema.js";

/**
 * The exceptions workflow, headless (D18): a stable, human-ownable case over a
 * logical break that recurs run after run. Identity is the break fingerprint;
 * the exception row is a mutable workflow pointer (sanctioned, like `isCurrent`)
 * and every transition lands in append-only `exception_events`. Resolution never
 * touches financial data — it records a human's judgment; the next run's facts
 * can reopen it.
 */

export interface ExceptionSyncResult {
  opened: number;
  recurred: number;
  reopened: number;
  selfResolved: number;
}

/**
 * Fold a completed run's breaks into the exceptions worklist:
 *
 *   - unseen fingerprint        → open a new exception (event: opened)
 *   - recurring, still open     → bump lastSeen/currentBreak (no event — not news)
 *   - recurring, was resolved   → reopen (event: reopened) — the world disagrees
 *   - open/acknowledged, absent → the books were fixed: self-resolve (event)
 *
 * Idempotent per run: re-syncing the same run finds every transition already
 * applied and does nothing.
 */
export async function syncExceptionsForRun(
  db: Db,
  runId: string,
  now: Date,
): Promise<ExceptionSyncResult> {
  return db.transaction(async (tx) => {
    const runBreaks = await tx
      .select({ id: breaks.id, type: breaks.type, fingerprint: breaks.fingerprint })
      .from(breaks)
      .where(and(eq(breaks.runId, runId), isNotNull(breaks.fingerprint)));
    const byFingerprint = new Map(runBreaks.map((b) => [b.fingerprint!, b]));

    const existing = byFingerprint.size
      ? await tx
          .select()
          .from(exceptions)
          .where(inArray(exceptions.fingerprint, [...byFingerprint.keys()]))
      : [];
    const known = new Map(existing.map((e) => [e.fingerprint, e]));

    const sorted = [...byFingerprint.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const toOpen = sorted.filter(([fingerprint]) => !known.has(fingerprint));
    const seen = sorted
      .map(([fingerprint]) => known.get(fingerprint))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .filter((e) => e.lastSeenRunId !== runId); // already-synced rows are this run's retries
    const toReopen = seen.filter((e) => e.status === "resolved");
    const toRecur = seen.filter((e) => e.status !== "resolved");

    if (toOpen.length > 0) {
      const created = await tx
        .insert(exceptions)
        .values(
          toOpen.map(
            ([fingerprint, brk]): typeof exceptions.$inferInsert => ({
              fingerprint,
              type: brk.type,
              status: "open",
              firstSeenRunId: runId,
              lastSeenRunId: runId,
              currentBreakId: brk.id,
              updatedAt: now,
            }),
          ),
        )
        .returning({ id: exceptions.id });
      await tx.insert(exceptionEvents).values(
        created.map(
          (c): typeof exceptionEvents.$inferInsert => ({
            exceptionId: c.id,
            kind: "opened",
            actor: "system",
            runId,
          }),
        ),
      );
    }

    // Recurring and reopening rows re-point at this run's break for their fingerprint.
    if (toRecur.length > 0) {
      await tx
        .update(exceptions)
        .set({ lastSeenRunId: runId, currentBreakId: breaks.id, updatedAt: now })
        .from(breaks)
        .where(
          and(
            inArray(
              exceptions.id,
              toRecur.map((e) => e.id),
            ),
            eq(breaks.runId, runId),
            eq(breaks.fingerprint, exceptions.fingerprint),
          ),
        );
    }

    if (toReopen.length > 0) {
      await tx
        .update(exceptions)
        .set({ status: "open", lastSeenRunId: runId, currentBreakId: breaks.id, updatedAt: now })
        .from(breaks)
        .where(
          and(
            inArray(
              exceptions.id,
              toReopen.map((e) => e.id),
            ),
            eq(breaks.runId, runId),
            eq(breaks.fingerprint, exceptions.fingerprint),
          ),
        );
      await tx.insert(exceptionEvents).values(
        toReopen.map(
          (e): typeof exceptionEvents.$inferInsert => ({
            exceptionId: e.id,
            kind: "reopened",
            actor: "system",
            runId,
          }),
        ),
      );
    }

    // Open work whose break vanished from this run: the real systems were fixed.
    // Everything synced above already carries this run's id, so it is excluded here.
    const stillOpen = await tx
      .select({ id: exceptions.id, fingerprint: exceptions.fingerprint })
      .from(exceptions)
      .where(and(ne(exceptions.status, "resolved"), ne(exceptions.lastSeenRunId, runId)));
    const gone = stillOpen.sort((a, b) =>
      a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
    );
    if (gone.length > 0) {
      await tx
        .update(exceptions)
        .set({ status: "resolved", updatedAt: now })
        .where(
          inArray(
            exceptions.id,
            gone.map((g) => g.id),
          ),
        );
      await tx.insert(exceptionEvents).values(
        gone.map(
          (g): typeof exceptionEvents.$inferInsert => ({
            exceptionId: g.id,
            kind: "self_resolved",
            actor: "system",
            runId,
          }),
        ),
      );
    }

    return {
      opened: toOpen.length,
      recurred: toRecur.length,
      reopened: toReopen.length,
      selfResolved: gone.length,
    };
  });
}

/** A human takes ownership of an open exception. */
export async function acknowledgeException(
  db: Db,
  exceptionId: string,
  actor: string,
  now: Date,
  note?: string,
): Promise<void> {
  await transition(db, exceptionId, ["open"], "acknowledged", actor, now, note);
}

/** A human closes the case — with a reason; an unexplained resolution is no resolution. */
export async function resolveException(
  db: Db,
  exceptionId: string,
  actor: string,
  note: string,
  now: Date,
): Promise<void> {
  await transition(db, exceptionId, ["open", "acknowledged"], "resolved", actor, now, note);
}

async function transition(
  db: Db,
  exceptionId: string,
  from: ("open" | "acknowledged")[],
  to: "acknowledged" | "resolved",
  actor: string,
  now: Date,
  note?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(exceptions)
      .set({ status: to, updatedAt: now })
      .where(and(eq(exceptions.id, exceptionId), inArray(exceptions.status, from)))
      .returning({ id: exceptions.id });
    if (updated.length === 0) {
      throw new Error(
        `exception ${exceptionId} is not in ${from.join("/")} — cannot move to ${to}`,
      );
    }
    await tx.insert(exceptionEvents).values({
      exceptionId,
      kind: to,
      actor,
      note: note ?? null,
    });
  });
}
