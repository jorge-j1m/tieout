import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDbClient } from "../client.js";
import { requireDatabaseUrl } from "../env.js";
import { migrationsFolder } from "../migrations.js";

// The deploy stack's migrate gate (topology §Stage 3): a one-shot container that
// applies pending migrations and exits; the api starts only after it succeeds.
// Programmatic (no drizzle-kit) so the production image ships runtime deps only.
const { db, sql } = createDbClient(requireDatabaseUrl());
try {
  await migrate(db, { migrationsFolder });
  console.log("migrations applied");
} finally {
  await sql.end();
}
