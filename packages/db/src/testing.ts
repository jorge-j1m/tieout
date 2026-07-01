import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDbClient, type Db } from "./client.js";
import { migrationsFolder } from "./migrations.js";
import * as schema from "./schema.js";
import "./env.js";

/**
 * Test databases with zero required infrastructure (D28). Two modes, never a skip:
 *
 * - `DATABASE_URL`/`TEST_DATABASE_URL` configured → an isolated `<name>_test`
 *   database (auto-created) on the real engine. The developer's working data is
 *   never touched; local green means what CI green means.
 * - Neither set (fresh clone, no docker) → an ephemeral in-memory PGlite: actual
 *   Postgres compiled to WASM, so constraints, enums, jsonb, bigint and timestamptz
 *   behave like production. The whole gate runs on a bare clone.
 *
 * PGlite guardrail: never use Drizzle's relational query API (`db.query…with`)
 * with bigint columns — drizzle-orm#3106 silently rounds int8 beyond 2^53 inside
 * relations on PGlite. This repo queries via `db.select()` only, and CI always
 * certifies against real Postgres 17.
 */

export interface TestDb {
  db: Db;
  /** "postgres" = real server, isolated `<name>_test` database; "pglite" = in-memory. */
  mode: "postgres" | "pglite";
  close: () => Promise<void>;
}

/** TEST_DATABASE_URL wins; otherwise DATABASE_URL with `_test` appended to the database name. */
function resolveTestDatabaseUrl(): string | undefined {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.toString();
}

/** Create the test database if missing. CREATE DATABASE has no IF NOT EXISTS; 42P04 = already there. */
async function ensureTestDatabase(testDatabaseUrl: string): Promise<void> {
  const target = new URL(testDatabaseUrl);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  // Admin connection: the main database (which exists), or `postgres` as a fallback
  // when only TEST_DATABASE_URL is configured.
  const admin = new URL(process.env.DATABASE_URL ?? testDatabaseUrl);
  if (admin.pathname === target.pathname) admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    await sql.unsafe(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  } catch (error) {
    if ((error as { code?: string }).code !== "42P04") throw error;
  } finally {
    await sql.end();
  }
}

/** Connect to a migrated test database — real Postgres when configured, in-memory PGlite otherwise. */
export async function connectTestDb(): Promise<TestDb> {
  const url = resolveTestDatabaseUrl();
  if (url !== undefined) {
    await ensureTestDatabase(url);
    const { db, sql } = createDbClient(url);
    await migratePg(db, { migrationsFolder });
    return { db, mode: "postgres", close: () => sql.end() };
  }
  const pglite = new PGlite();
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, mode: "pglite", close: () => pglite.close() };
}

/** Reset every table between tests — the test database holds nothing worth keeping. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE triage_suggestions, exception_events, exceptions, outbox, fx_rates,
      match_members, matches, breaks, recon_runs,
      quarantined_records, transactions, raw_records, ingestion_batches, source_cursors
    CASCADE
  `);
}
