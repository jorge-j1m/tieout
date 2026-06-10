import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDbClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type DbClient = ReturnType<typeof createDbClient>;
/** Any Drizzle Postgres database over our schema — postgres-js in production, PGlite in zero-infra tests (D28). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
