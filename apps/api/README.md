# @tieout/api

The Hono domain API (Stage 3): reads over the permanent record — runs (with
run-vs-run diff), breaks, transactions with their version chains, raw
drill-down, the exceptions worklist, quarantine — and exceptions-only mutations
(acknowledge, resolve). There is no API path that edits financial rows.

Two personas (D32): the unauthenticated **demo viewer** (read-only; mutations
rejected server-side, proven by tests) and named **operators** via bearer
tokens from `API_OPERATOR_TOKENS`.

```bash
pnpm --filter @tieout/api dev    # serves on API_PORT (default 3001)
```
