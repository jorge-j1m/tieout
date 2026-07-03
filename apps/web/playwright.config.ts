import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke of the demo visitor's walk. It runs against the *built* web
 * app (`next start`) pointed at a running, seeded API — the real stack, not a
 * mock. To run it:
 *
 *   docker compose up -d && pnpm db:migrate && pnpm seed
 *   pnpm --filter @tieout/api start &            # API on :3001
 *   pnpm --filter @tieout/web build
 *   API_BASE_URL=http://127.0.0.1:3001 pnpm --filter @tieout/web e2e
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { API_BASE_URL: process.env.API_BASE_URL ?? "http://127.0.0.1:3001" },
  },
});
