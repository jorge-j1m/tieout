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

    const result: ExceptionSyncResult = { opened: 0, recurred: 0, reopened: 0, selfResolved: 0 };

    for (const [fingerprint, brk] of [...byFingerprint.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const current = known.get(fingerprint);
      if (current === undefined) {
        const [created] = await tx
          .insert(exceptions)
          .values({
            fingerprint,
            type: brk.type,
            status: "open",
            firstSeenRunId: runId,
            lastSeenRunId: runId,
            currentBreakId: brk.id,
            updatedAt: now,
          })
          .returning({ id: exceptions.id });
        await tx.insert(exceptionEvents).values({
          exceptionId: created!.id,
          kind: "opened",
          actor: "system",
          runId,
        });
        result.opened += 1;
        continue;
      }
      if (current.lastSeenRunId === runId) continue; // already synced for this run
      if (current.status === "resolved") {
        await tx
          .update(exceptions)
          .set({ status: "open", lastSeenRunId: runId, currentBreakId: brk.id, updatedAt: now })
          .where(eq(exceptions.id, current.id));
        await tx.insert(exceptionEvents).values({
          exceptionId: current.id,
          kind: "reopened",
          actor: "system",
          runId,
        });
        result.reopened += 1;
      } else {
        await tx
          .update(exceptions)
          .set({ lastSeenRunId: runId, currentBreakId: brk.id, updatedAt: now })
          .where(eq(exceptions.id, current.id));
        result.recurred += 1;
      }
    }

    // Open work whose break vanished from this run: the real systems were fixed.
    const stillOpen = await tx
      .select({ id: exceptions.id, fingerprint: exceptions.fingerprint })
      .from(exceptions)
      .where(and(ne(exceptions.status, "resolved"), ne(exceptions.lastSeenRunId, runId)));
    for (const gone of stillOpen.sort((a, b) =>
      a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
    )) {
      if (byFingerprint.has(gone.fingerprint)) continue;
      await tx
        .update(exceptions)
        .set({ status: "resolved", updatedAt: now })
        .where(eq(exceptions.id, gone.id));
      await tx.insert(exceptionEvents).values({
        exceptionId: gone.id,
        kind: "self_resolved",
        actor: "system",
        runId,
      });
      result.selfResolved += 1;
    }

    return result;
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
  await transition(db, exceptionId, ["open"], "acknowledged", "acknowledged", actor, now, note);
}

/** A human closes the case — with a reason; an unexplained resolution is no resolution. */
export async function resolveException(
  db: Db,
  exceptionId: string,
  actor: string,
  note: string,
  now: Date,
): Promise<void> {
  await transition(
    db,
    exceptionId,
    ["open", "acknowledged"],
    "resolved",
    "resolved",
    actor,
    now,
    note,
  );
}

async function transition(
  db: Db,
  exceptionId: string,
  from: ("open" | "acknowledged" | "resolved")[],
  to: "acknowledged" | "resolved",
  eventKind: "acknowledged" | "resolved",
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
      kind: eventKind,
      actor,
      note: note ?? null,
    });
  });
}
