import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Root .env; real env vars (CI) win because dotenv never overrides.
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tieout:tieout@127.0.0.1:5432/tieout",
  },
  strict: true,
  verbose: true,
});
