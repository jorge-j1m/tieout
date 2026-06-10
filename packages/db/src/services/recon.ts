import { and, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { BreakProposal, MatchProposal } from "@tieout/contracts";
import type { Db } from "../client.js";
import { breaks, matches, matchMembers, reconRuns, transactions } from "../schema.js";

/**
 * The as-of watermark a recon run evaluates: everything the system of record
 * contained by then. Derived from data (the latest version creation), not from
 * the clock, so re-running yields identical results.
 */
export async function currentWatermark(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({
      // Raw aggregates bypass drizzle's column decoding; reuse createdAt's decoder.
      max: sql`max(${transactions.createdAt})`.mapWith(transactions.createdAt),
    })
    .from(transactions);
  return row?.max ?? null;
}

/**
 * The transaction versions in effect at `asOf` — a run's reproducible input set.
 * A version is visible from its `createdAt` until its `supersededAt` (half-open
 * system-time interval, D27), so re-executing an old watermark after restatements
 * selects exactly the versions the original run saw. `isCurrent` is deliberately
 * not consulted: it points at "now" and moves on supersession.
 */
export async function loadTransactionsAsOf(db: Db, asOf: Date) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        lte(transactions.createdAt, asOf),
        or(isNull(transactions.supersededAt), gt(transactions.supersededAt, asOf)),
      ),
    );
}

export interface PersistReconArgs {
  asOf: Date;
  rulesetVersion: string;
  matches: MatchProposal[];
  breaks: BreakProposal[];
  stats: Record<string, unknown>;
  now: Date;
}

/** Persist a completed run atomically: run, matches, members (id+version, D17), breaks. */
export async function persistReconRun(db: Db, args: PersistReconArgs): Promise<{ runId: string }> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(reconRuns)
      .values({
        asOf: args.asOf,
        rulesetVersion: args.rulesetVersion,
        status: "completed",
        stats: args.stats,
        startedAt: args.now,
        finishedAt: args.now,
      })
      .returning({ id: reconRuns.id });
    const runId = run!.id;

    if (args.matches.length > 0) {
      const matchRows = await tx
        .insert(matches)
        .values(
          args.matches.map((m) => ({ runId, rulesetVersion: args.rulesetVersion, kind: m.kind })),
        )
        .returning({ id: matches.id });
      await tx.insert(matchMembers).values(
        args.matches.flatMap((m, i) =>
          m.members.map((ref) => ({
            matchId: matchRows[i]!.id,
            runId,
            transactionId: ref.id,
            transactionVersion: ref.version,
          })),
        ),
      );
    }

    if (args.breaks.length > 0) {
      await tx
        .insert(breaks)
        .values(args.breaks.map((b) => ({ runId, type: b.type, details: b.details })));
    }

    return { runId };
  });
}
