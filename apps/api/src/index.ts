import "./env.js";
import { serve } from "@hono/node-server";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createApp } from "./app.js";
import { parseOperatorTokens } from "./auth.js";

const { db } = createDbClient(requireDatabaseUrl());
const dailyCap = Number(process.env.TIEOUT_INVESTIGATE_DAILY_CAP);
const app = createApp({
  db,
  operatorTokens: parseOperatorTokens(process.env.API_OPERATOR_TOKENS),
  investigate: {
    enabled: process.env.TIEOUT_INVESTIGATE_ENABLED === "true",
    dailyCap: Number.isFinite(dailyCap) && dailyCap > 0 ? Math.floor(dailyCap) : 10,
    assistantName: process.env.TIEOUT_INVESTIGATE_ASSISTANT_NAME?.trim() || "Clara",
  },
});
const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`tieout api listening on :${port}`);
