import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
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

  // ── Transactions and raw drill-down (the §8 explain chain) ────────────────

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
    return json(rows);
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
    return json({ ...exception, currentBreak, events, triageSuggestions: triage });
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
