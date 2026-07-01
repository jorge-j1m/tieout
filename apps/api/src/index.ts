import "./env.js";
import { serve } from "@hono/node-server";
import { createDbClient, requireDatabaseUrl } from "@tieout/db";
import { createApp } from "./app.js";
import { parseOperatorTokens } from "./auth.js";

const { db } = createDbClient(requireDatabaseUrl());
const app = createApp({
  db,
  operatorTokens: parseOperatorTokens(process.env.API_OPERATOR_TOKENS),
});
const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`tieout api listening on :${port}`);
