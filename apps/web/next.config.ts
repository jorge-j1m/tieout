import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Root .env, same pattern as apps/api — real environment variables always win
// (dotenv never overrides), so deployed containers are configured by the
// environment alone and the root file only serves local development.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  /** Typed <Link> hrefs — a route typo is a compile error, not a 404. */
  typedRoutes: true,
  /** The monorepo root, so file tracing sees the pnpm workspace store. */
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default nextConfig;
