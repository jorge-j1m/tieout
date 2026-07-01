import { asc, eq, inArray, ne } from "drizzle-orm";
import type { BreakType } from "@tieout/contracts";
import type { Db } from "../client.js";
import { breaks, exceptions, triageSuggestions } from "../schema.js";

/**
 * Reads and writes for LLM triage (D33). Suggestions are append-only
 * annotations: nothing here mutates an exception's lifecycle, and there is no
 * update or delete path — a stale suggestion is superseded by a newer row.
 */

export interface TriageCandidate {
  exceptionId: string;
  fingerprint: string;
  type: BreakType;
  breakId: string;
  details: unknown;
}

export type NewTriageSuggestion = typeof triageSuggestions.$inferInsert;

/** Unresolved exceptions with their current break content — the triage worklist. */
export async function listTriageCandidates(db: Db): Promise<TriageCandidate[]> {
  return db
    .select({
      exceptionId: exceptions.id,
      fingerprint: exceptions.fingerprint,
      type: exceptions.type,
      breakId: breaks.id,
      details: breaks.details,
    })
    .from(exceptions)
    .innerJoin(breaks, eq(exceptions.currentBreakId, breaks.id))
    .where(ne(exceptions.status, "resolved"))
    .orderBy(asc(exceptions.fingerprint));
}

/** Which of these cache keys already carry a suggestion — the "never pay twice" check. */
export async function existingTriageHashes(db: Db, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await db
    .select({ inputHash: triageSuggestions.inputHash })
    .from(triageSuggestions)
    .where(inArray(triageSuggestions.inputHash, hashes));
  return new Set(rows.map((r) => r.inputHash));
}

/** Append suggestions; a concurrent pass writing the same input hash is a no-op, not an error. */
export async function recordTriageSuggestions(
  db: Db,
  rows: NewTriageSuggestion[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(triageSuggestions)
    .values(rows)
    .onConflictDoNothing({ target: triageSuggestions.inputHash })
    .returning({ id: triageSuggestions.id });
  return inserted.length;
}
