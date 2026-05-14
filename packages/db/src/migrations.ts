import { fileURLToPath } from "node:url";

/** Absolute path to the generated SQL migrations, for programmatic `migrate()` calls. */
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
