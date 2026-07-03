import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  acknowledgeBodySchema,
  breaksQuerySchema,
  exceptionsQuerySchema,
  listQuerySchema,
  resolveBodySchema,
} from "@tieout/contracts";
import {
  acknowledgeException,
  breaks,
  exceptionEvents,
  exceptions,
  ingestionBatches,
  matches,
  matchMembers,
  quarantinedRecords,
  rawRecords,
  reconRuns,
  resolveException,
  transactions,
  triageSuggestions,
  type Db,
} from "@tieout/db";
import { operatorFor } from "./auth.js";

/**
 * The dashboard's API (stage-3 spec §1): a thin read surface over the permanent
 * record, plus exceptions-only mutations through the Stage 2 service functions.
 * No handler writes financial rows — the db's append-only constraints stay the
 * last line of defense behind that promise.
 */

export interface ApiOptions {
  db: Db;
  /** sha256(token) hex → operator name; see auth.ts. */
  operatorTokens: Map<string, string>;
}

/** Money is bigint minor units (D5) — it serializes as strings, never numbers. */
const json = (data: unknown, status = 200): Response =>
  new Response(
    JSON.stringify(data, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json" } },
  );

const notFound = () => json({ error: "not found" }, 404);
const badRequest = (detail: unknown) => json({ error: "invalid request", detail }, 400);

const uuidSchema = z.uuid();

/**
 * A break's subject line — the first transaction in its details — so the
 * exceptions worklist can show an amount and an id without embedding the whole
 * break. `details` is jsonb, so every field is checked rather than trusted.
 */
function subjectOf(
  details: unknown,
): { amountMinor: string; currency: string; sourceId: string } | null {
  if (details === null || typeof details !== "object") return null;
  const txns = (details as { txns?: unknown }).txns;
  if (!Array.isArray(txns) || txns.length === 0) return null;
  const t = txns[0] as Record<string, unknown>;
  if (
    typeof t.amountMinor === "string" &&
    typeof t.currency === "string" &&
    typeof t.sourceId === "string"
  ) {
    return { amountMinor: t.amountMinor, currency: t.currency, sourceId: t.sourceId };
  }
  return null;
}

type Env = { Variables: { operator: string } };

export function createApp({ db, operatorTokens }: ApiOptions): Hono<Env> {
  const app = new Hono<Env>();

  /** Mutations are operator-only; the demo persona is rejected here, server-side. */
  const requireOperator: MiddlewareHandler<Env> = async (c, next) => {
    const operator = operatorFor(operatorTokens, c.req.header("authorization"));
    if (operator === null) {
      return json({ error: "operator authentication required — the demo persona is read-only" }, 401);
    }
    c.set("operator", operator);
    await next();
  };

  /** Route :id params are uuids; anything else can name nothing. */
  const idParam = (c: { req: { param: (k: "id") => string } }): string | null => {
    const id = c.req.param("id");
    return uuidSchema.safeParse(id).success ? id : null;
  };

  app.get("/healthz", () => json({ ok: true }));

  /** Who the caller is — `null` for the demo persona. Powers the web login + persona chip. */
  app.get("/me", (c) => json({ operator: operatorFor(operatorTokens, c.req.header("authorization")) }));

  // ── Runs ──────────────────────────────────────────────────────────────────

  app.get("/runs", async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) return badRequest(query.error.issues);
    const rows = await db
      .select()
      .from(reconRuns)
      .orderBy(desc(reconRuns.startedAt))
      .limit(query.data.limit);
    return json(rows);
  });

  app.get("/runs/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, id));
    // The run's recorded configuration (tolerances, the FX rates it applied) already
    // rides in `stats.config` — the run persists what it evaluated, so nothing to join.
    return run === undefined ? notFound() : json(run);
  });

  /**
   * What this run changed in the worklist, straight from the persisted audit
   * trail (D30/D31): exceptions whose lifecycle event this run wrote. Appeared =
   * opened, reopened = recurred after a human resolved, self-resolved = absent
   * from this run after being open.
   */
  app.get("/runs/:id/diff", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, id));
    if (run === undefined) return notFound();
    const rows = await db
      .select({
        kind: exceptionEvents.kind,
        exceptionId: exceptions.id,
        fingerprint: exceptions.fingerprint,
        type: exceptions.type,
      })
      .from(exceptionEvents)
      .innerJoin(exceptions, eq(exceptionEvents.exceptionId, exceptions.id))
      .where(eq(exceptionEvents.runId, id))
      .orderBy(asc(exceptions.fingerprint));
    const of = (kind: string) => rows.filter((r) => r.kind === kind);
    return json({
      runId: id,
      appeared: of("opened"),
      reopened: of("reopened"),
      selfResolved: of("self_resolved"),
    });
  });

  app.get("/runs/:id/breaks", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const query = breaksQuerySchema.safeParse(c.req.query());
    if (!query.success) return badRequest(query.error.issues);
    const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, id));
    if (run === undefined) return notFound();
    const where: SQL[] = [eq(breaks.runId, id)];
    if (query.data.type !== undefined) where.push(eq(breaks.type, query.data.type));
    const rows = await db
      .select()
      .from(breaks)
      .where(and(...where))
      .orderBy(asc(breaks.fingerprint))
      .limit(query.data.limit);
    return json(rows);
  });

  /**
   * A run's matches with their members (Run Detail "Matches" tab). Members are
   * loaded set-based and grouped in memory — never a query per match.
   */
  app.get("/runs/:id/matches", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, id));
    if (run === undefined) return notFound();
    const rows = await db
      .select()
      .from(matches)
      .where(eq(matches.runId, id))
      .orderBy(asc(matches.kind), asc(matches.createdAt));
    // Join the matched transaction versions so the Matches tab can name the
    // ledger and source sides without a query per member (set-based, no N+1).
    const memberRows =
      rows.length === 0
        ? []
        : await db
            .select({
              matchId: matchMembers.matchId,
              transactionId: matchMembers.transactionId,
              transactionVersion: matchMembers.transactionVersion,
              source: transactions.source,
              sourceId: transactions.sourceId,
              amountMinor: transactions.amountMinor,
              currency: transactions.currency,
              reference: transactions.reference,
              type: transactions.type,
            })
            .from(matchMembers)
            .innerJoin(transactions, eq(matchMembers.transactionId, transactions.id))
            .where(
              inArray(
                matchMembers.matchId,
                rows.map((r) => r.id),
              ),
            );
    type Member = Omit<(typeof memberRows)[number], "matchId">;
    const byMatch = new Map<string, Member[]>();
    for (const { matchId, ...member } of memberRows) {
      const list = byMatch.get(matchId);
      if (list) list.push(member);
      else byMatch.set(matchId, [member]);
    }
    return json(rows.map((r) => ({ ...r, members: byMatch.get(r.id) ?? [] })));
  });

  // ── Transactions and raw drill-down (the §8 explain chain) ────────────────

  /** One break with its full details — the explain view is entered by break id. */
  app.get("/breaks/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [row] = await db.select().from(breaks).where(eq(breaks.id, id));
    return row === undefined ? notFound() : json(row);
  });

  app.get("/transactions/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (txn === undefined) return notFound();
    const versions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.source, txn.source),
          eq(transactions.sourceAccount, txn.sourceAccount),
          eq(transactions.sourceId, txn.sourceId),
        ),
      )
      .orderBy(asc(transactions.version));
    return json({ ...txn, versions });
  });

  app.get("/raw/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [raw] = await db.select().from(rawRecords).where(eq(rawRecords.id, id));
    if (raw === undefined) return notFound();
    const [batch] = await db
      .select()
      .from(ingestionBatches)
      .where(eq(ingestionBatches.id, raw.batchId));
    return json({ ...raw, batch });
  });

  app.get("/quarantine", async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) return badRequest(query.error.issues);
    const rows = await db
      .select()
      .from(quarantinedRecords)
      .orderBy(desc(quarantinedRecords.createdAt))
      .limit(query.data.limit);
    return json(rows);
  });

  /**
   * Per-source landing summary (Overview sources strip, Run Detail landing table):
   * record and batch counts, last-landed time, quarantined units. Three grouped
   * aggregates merged in memory — set-based, no per-source queries. Sources aren't
   * run-scoped (batches land independently of runs), so this is a global snapshot.
   */
  app.get("/sources", async () => {
    const [batchAgg, rawAgg, quarAgg] = await Promise.all([
      db
        .select({
          source: ingestionBatches.source,
          batches: sql<number>`count(*)::int`,
          // Aggregates lose the timestamptz parser, so format ISO-UTC in SQL rather
          // than hand a driver-specific string to `new Date()` on the web side.
          lastLanded: sql<
            string | null
          >`to_char(max(${ingestionBatches.observedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        })
        .from(ingestionBatches)
        .groupBy(ingestionBatches.source),
      db
        .select({ source: rawRecords.source, records: sql<number>`count(*)::int` })
        .from(rawRecords)
        .groupBy(rawRecords.source),
      db
        .select({
          source: quarantinedRecords.source,
          quarantinedUnits: sql<number>`count(distinct ${quarantinedRecords.batchId})::int`,
        })
        .from(quarantinedRecords)
        .groupBy(quarantinedRecords.source),
    ]);
    const batchBySource = new Map(batchAgg.map((b) => [b.source, b]));
    const recordsBySource = new Map(rawAgg.map((r) => [r.source, r.records]));
    const quarBySource = new Map(quarAgg.map((q) => [q.source, q.quarantinedUnits]));
    const names = [
      ...new Set([...batchBySource.keys(), ...recordsBySource.keys(), ...quarBySource.keys()]),
    ].sort();
    const sources = names.map((source) => ({
      source,
      records: recordsBySource.get(source) ?? 0,
      batches: batchBySource.get(source)?.batches ?? 0,
      lastLanded: batchBySource.get(source)?.lastLanded ?? null,
      quarantinedUnits: quarBySource.get(source) ?? 0,
    }));
    return json(sources);
  });

  // ── Exceptions: the worklist and its only mutations ───────────────────────

  app.get("/exceptions", async (c) => {
    const query = exceptionsQuerySchema.safeParse(c.req.query());
    if (!query.success) return badRequest(query.error.issues);
    const where = query.data.status !== undefined ? eq(exceptions.status, query.data.status) : undefined;
    const rows = await db
      .select()
      .from(exceptions)
      .where(where)
      .orderBy(desc(exceptions.updatedAt), asc(exceptions.fingerprint))
      .limit(query.data.limit);
    if (rows.length === 0) return json([]);
    const ids = rows.map((r) => r.id);

    // One events read powers three worklist facts without a query per row:
    // "seen in N runs" (D18: distinct opened/reopened runs), who touched the case
    // last, and whether it came back after a resolution ("reopened"). Ordered by
    // time so the last row wins for the actor.
    const events = await db
      .select({
        exceptionId: exceptionEvents.exceptionId,
        kind: exceptionEvents.kind,
        actor: exceptionEvents.actor,
        runId: exceptionEvents.runId,
      })
      .from(exceptionEvents)
      .where(inArray(exceptionEvents.exceptionId, ids))
      .orderBy(asc(exceptionEvents.createdAt), asc(exceptionEvents.id));

    // The subject amount + id come from each case's current break (set-based join).
    const breakRows = await db
      .select({ id: breaks.id, details: breaks.details })
      .from(breaks)
      .where(
        inArray(
          breaks.id,
          rows.map((r) => r.currentBreakId),
        ),
      );
    const detailsByBreak = new Map(breakRows.map((b) => [b.id, b.details]));

    type Roll = { runs: Set<string>; lastActor: string; reopened: boolean };
    const rollByException = new Map<string, Roll>();
    for (const e of events) {
      let roll = rollByException.get(e.exceptionId);
      if (roll === undefined) {
        roll = { runs: new Set(), lastActor: e.actor, reopened: false };
        rollByException.set(e.exceptionId, roll);
      }
      if ((e.kind === "opened" || e.kind === "reopened") && e.runId !== null) roll.runs.add(e.runId);
      if (e.kind === "reopened") roll.reopened = true;
      roll.lastActor = e.actor;
    }

    return json(
      rows.map((r) => {
        const roll = rollByException.get(r.id);
        const subject = subjectOf(detailsByBreak.get(r.currentBreakId));
        return {
          ...r,
          seenInRuns: roll ? roll.runs.size : 0,
          lastActor: roll?.lastActor ?? "system",
          // Reopened is a lifecycle fact, not a status: a currently-open case that
          // recurred after someone had resolved it (the world disagreed again).
          reopened: r.status === "open" && (roll?.reopened ?? false),
          amountMinor: subject?.amountMinor ?? null,
          currency: subject?.currency ?? null,
          subjectId: subject?.sourceId ?? null,
        };
      }),
    );
  });

  app.get("/exceptions/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, id));
    if (exception === undefined) return notFound();
    const [currentBreak] = await db
      .select()
      .from(breaks)
      .where(eq(breaks.id, exception.currentBreakId));
    const events = await db
      .select()
      .from(exceptionEvents)
      .where(eq(exceptionEvents.exceptionId, id))
      .orderBy(asc(exceptionEvents.createdAt), asc(exceptionEvents.id));
    // LLM triage annotations (D33): suggestions shown beside the deterministic
    // result, newest first — there is no write path for them through this API.
    const triage = await db
      .select()
      .from(triageSuggestions)
      .where(eq(triageSuggestions.exceptionId, id))
      .orderBy(desc(triageSuggestions.createdAt), asc(triageSuggestions.id));
    const seenInRuns = new Set(
      events
        .filter((e) => e.runId !== null && (e.kind === "opened" || e.kind === "reopened"))
        .map((e) => e.runId),
    ).size;
    return json({ ...exception, seenInRuns, currentBreak, events, triageSuggestions: triage });
  });

  /** Run a guarded workflow transition and return the updated exception. */
  const transition = async (id: string, run: () => Promise<void>): Promise<Response> => {
    const [existing] = await db.select().from(exceptions).where(eq(exceptions.id, id));
    if (existing === undefined) return notFound();
    try {
      await run();
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    const [updated] = await db.select().from(exceptions).where(eq(exceptions.id, id));
    return json(updated);
  };

  app.post("/exceptions/:id/acknowledge", requireOperator, async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const body = acknowledgeBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return badRequest(body.error.issues);
    return transition(id, () =>
      acknowledgeException(db, id, c.get("operator"), new Date(), body.data.note),
    );
  });

  app.post("/exceptions/:id/resolve", requireOperator, async (c) => {
    const id = idParam(c);
    if (id === null) return notFound();
    const body = resolveBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return badRequest(body.error.issues);
    return transition(id, () =>
      resolveException(db, id, c.get("operator"), body.data.reason, new Date()),
    );
  });

  return app;
}
