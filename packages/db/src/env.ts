import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Load the repo-root .env. Real environment variables (CI, prod) always win —
// dotenv never overrides an existing value.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in");
  }
  return url;
}

export function optionalDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}
