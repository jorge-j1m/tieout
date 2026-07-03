# @tieout/web

The dashboard (stage-3 spec §2): a read-only window onto the permanent record,
plus the exceptions workflow for operators. Next.js App Router; every page is a
server component that reads `apps/api` — there is no second dataset and no UI
write path to financial data (D34).

```bash
docker compose up -d && pnpm db:migrate && pnpm seed   # a record to look at
pnpm --filter @tieout/api dev                          # the API on :3001
pnpm --filter @tieout/web dev                          # the dashboard on :3000
```

Configuration comes from the root `.env` (`API_BASE_URL`, and
`SESSION_COOKIE_SECURE=true` behind https). Operator login relays the API's
bearer tokens (`API_OPERATOR_TOKENS`) through an httpOnly session cookie (D36);
the API remains the only guard on mutations.

- `app/` — routes; `layout.tsx` carries the chrome and the footer promise.
- `components/` — primitives (`Money`, `StateChip`, `DoubleRule`…), the evidence
  spine, the case rail, tables, chrome.
- `lib/` — typed API client (Zod-parsed responses from `@tieout/contracts`),
  `money.ts` (bigint-exact formatting), `explain/` (the pure evidence-chain
  presenter), `session.ts`.

Design tokens live once in `app/globals.css` (`@theme`, D35): paper, ink, hairline,
oxblood/green/amber. Never inline a hex value in JSX. Light only — that's the brand.
