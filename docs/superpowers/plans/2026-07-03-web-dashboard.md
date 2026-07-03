# Tieout Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web` — the read-only, provenance-first reconciliation dashboard described in `docs/specs/stage-3-web.md` — backed entirely by the real `apps/api` over the permanent record.

**Architecture:** Next.js App Router with React Server Components fetching a small, typed API client; a shared Zod response-schema boundary in `packages/contracts`; a pure `lib/explain` presenter that derives the evidence-chain narrative from structured break facts; operator writes via Server Actions that relay a session bearer token to the API (the API stays the sole write guard). A few additive read-only endpoints are added to `apps/api`.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript 5.9 (strict, `@tieout/typescript-config/base.json`), Tailwind CSS v4 (CSS-first `@theme`), `next/font` (IBM Plex Sans + Mono, self-hosted), Zod 4, Hono (existing API), Vitest + `@testing-library/react` + jsdom, Playwright (one e2e smoke), pnpm + Turborepo.

## Global Constraints

Copied verbatim from CLAUDE.md invariants and the spec. Every task's requirements implicitly include this section.

- **Money is `bigint` minor units, serialized as strings.** No float touches money — not in code, tests, or "temporarily". Currency exponents differ: USD 2, MXN 2, JPY 0, USDC 6. The UI parses money strings and renders them exact, right-aligned, tabular; never rounds or implies approximation.
- **No UI write path to financial data.** The only mutations are exceptions `acknowledge`/`resolve`. `resolve` requires a non-empty reason.
- **Demo persona is read-only, enforced server-side.** Mutation rejection is proven by API tests, not hidden buttons.
- **UTC everywhere, labeled.** Show *occurred* (source event time) vs *observed* (when tieout first saw it) where relevant.
- **Append-only honesty.** Superseded versions are shown "with respect" (`v1 · superseded …`), never as errors or strikethroughs.
- **`packages/core` does no I/O and no presentation.** The evidence-chain presenter lives in `apps/web/lib`, not core.
- **Secrets never in the repo.** `.env.example` only. `API_BASE_URL`, `API_OPERATOR_TOKENS`, `SESSION_COOKIE_SECURE` via env.
- **Accessibility AA on paper ground; color is never the sole signal** (every chip carries a text label); visible focus states.
- **Light theme only** — no dark mode. This is the brand.
- **Definition of done:** `turbo run typecheck lint test` passes; behavior changes carry tests; quickstart stays ≤5 minutes; zero-infra unit tests stay green (e2e is a separate `test:e2e`).
- **Commits:** small, conventional (`feat:`/`fix:`/`docs:`/`chore:`/`test:`), no Claude references anywhere (no `Co-Authored-By`, no "Generated with").
- **Visual source of truth:** the "Tieout UI brief" design project (`aa93be58-d113-4d58-ae9b-cbdc28aeb0f6`). Each `*.dc.html` file is the authoritative layout+style for its screen; read it with DesignSync `get_file` at implementation time and translate its inline styles to token utilities (see Translation Rules below). Where a mock number disagrees with the seeded record, the record wins.

### Translation Rules (inline style → Tailwind v4 token)

The `.dc.html` files use inline styles with literal hex/px. Translate mechanically:

| Design literal | Token / utility |
|---|---|
| `#FBFAF7` bg | `bg-paper` |
| `#16130E` text | `text-ink` |
| `#6B6558` text | `text-muted` |
| `#E6E2D8` border/rule | `border-hair` (1px) |
| `#F4F1EA` hover bg | `hover:bg-wash` |
| `#8C2B1F` | `text-break` / `bg-break` (oxblood) |
| `#1E5C41` | `text-matched` / `bg-matched` (green) |
| `#8A5A00` | `text-pending` / `bg-pending` (amber) |
| `'IBM Plex Mono'` | `font-mono` + `tabular-nums` for figures |
| `'IBM Plex Sans'` | `font-sans` (default) |
| small-caps label block | `<SectionLabel>` component |
| `max-width:1280px;margin:0 auto` | `<Shell>` layout wrapper |
| the wordmark 2px+1px bars | `<DoubleRule>` component |

Never inline hex or px in JSX; if a value has no token, add it to `@theme` first.

---

## File Structure

### `packages/contracts` (additions)
- Create `src/responses.ts` — Zod schemas + inferred types for every API response row. One file; the shared api↔web boundary.
- Modify `src/index.ts` — export `./responses.js`.
- Test `src/test/responses.test.ts`.

### `apps/api` (additions — all read-only)
- Modify `src/app.ts` — add `GET /me`, `GET /breaks/:id`, `GET /runs/:id/matches`, `GET /runs/:id/sources`; extend `GET /runs/:id` (config) and `/exceptions*` (`seenInRuns`).
- Modify `src/test/api.test.ts` — a test per new endpoint + persona resolution.

### `apps/web` (new app)
```
apps/web/
  package.json, tsconfig.json, next.config.ts, postcss.config.mjs,
  eslint.config.mjs, vitest.config.ts, vitest.setup.ts,
  playwright.config.ts, .env.example, README.md
  app/
    layout.tsx                 root: fonts, <Chrome>, <Footer>, run-context
    globals.css                @import tailwindcss + @theme tokens + motifs
    page.tsx                   Overview
    loading.tsx / error.tsx    shared states
    runs/page.tsx  runs/[id]/page.tsx
    breaks/page.tsx  breaks/[id]/page.tsx
    exceptions/page.tsx  exceptions/[id]/page.tsx
    quarantine/page.tsx
    login/page.tsx
    actions.ts                 server actions: login, logout, acknowledge, resolve
  components/
    chrome/  TopBar CommandSearch PersonaChip RunContextLine Footer FirstVisitBanner
    primitives/  Money Mono StateChip SectionLabel DoubleRule CopyButton UtcTime Shell
    data/  CounterBlock TypedList TrendStrip SourcesStrip BreaksTable ExceptionsTable
    explain/  EvidenceSpine EvidenceHop PayloadViewer VersionChain
    case/  EventTimeline TriageMargin CaseRail ActionButtons ResolveDialog
    run/  RunDiffSections MatchesTable
    quarantine/  ControlTotalsPanel CircuitBreakerRows
    states/  Skeletons EmptyTiedOut ErrorPanel
  lib/
    api/  client.ts (fetchJson) + endpoints.ts (one fn per route)
    money.ts        formatMoney + currency exponents
    time.ts         formatUtc, occurred/observed helpers
    explain/  present.ts (pure) + present.test.ts + labels.ts (GLOSS/TYPE_LABEL)
    session.ts      cookie read/write + persona resolution
    env.ts          typed env access
  test/
    e2e/visitor-walk.spec.ts   Playwright smoke
```

---

## PHASE 0 — Boundary & scaffold

### Task 0.1: Contracts response schemas

**Files:**
- Create: `packages/contracts/src/responses.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./responses.js";`)
- Test: `packages/contracts/src/test/responses.test.ts`

**Interfaces — Produces:**
- `moneyStringSchema: z.ZodString` (matches `/^-?\d+$/`)
- `runSchema`, `reconStatsSchema`, `breakSchema`, `breakTxnDetailSchema`, `transactionSchema`, `transactionWithVersionsSchema`, `rawWithBatchSchema`, `matchWithMembersSchema`, `exceptionSchema`, `exceptionEventSchema`, `triageSuggestionSchema`, `exceptionDetailSchema`, `quarantineSchema`, `sourceSummarySchema`, `runConfigSchema`, `meSchema`, `runDiffSchema`
- Inferred types exported with matching names (`Run`, `Break`, `Transaction`, …).

- [ ] **Step 1: Write the failing test** (`responses.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { runSchema, breakSchema, transactionSchema, meSchema } from "../responses.js";

describe("response schemas", () => {
  it("accepts a serialized run row (money & stats as the API emits them)", () => {
    const row = {
      id: "7e9b0611-0000-4000-8000-000000000000",
      asOf: "2026-06-05T00:00:00.000Z",
      rulesetVersion: "ruleset-v2",
      status: "succeeded",
      stats: { runId: "r", asOf: "a", rulesetVersion: "ruleset-v2", matches: 58,
        matchedTransactions: 119, breaks: { missing_in_ledger: 2 }, totalBreaks: 9,
        pendingBySource: { stripe: 2 } },
      startedAt: "2026-06-05T00:00:00.000Z",
      finishedAt: "2026-06-05T00:00:52.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
    };
    expect(runSchema.parse(row).stats.totalBreaks).toBe(9);
  });

  it("keeps money as a string on transactions (never a number)", () => {
    const parsed = transactionSchema.parse({
      id: "11111111-0000-4000-8000-000000000000",
      rawId: "22222222-0000-4000-8000-000000000000",
      version: 1, isCurrent: true, supersededAt: null, isTombstone: false,
      source: "stripe", sourceAccount: "acct_mercadia", sourceId: "txn_re_0014",
      sourceType: "refund", type: "refund", amountMinor: "-6681", netMinor: "-6681",
      currency: "USD", occurredAt: "2026-05-14T18:22:00.000Z", valueDate: null,
      observedAt: "2026-06-05T00:00:00.000Z", account: "acct_mercadia",
      reference: "ch_mercadia_0014", groupRef: null, status: "settled",
      normalizerVersion: "stripe-v1", metadata: {}, createdAt: "2026-06-05T00:00:00.000Z",
    });
    expect(typeof parsed.amountMinor).toBe("string");
  });

  it("rejects a money field that arrived as a number", () => {
    expect(() => transactionSchema.parse({ amountMinor: -6681 } as never)).toThrow();
  });

  it("resolves the two personas", () => {
    expect(meSchema.parse({ operator: null }).operator).toBeNull();
    expect(meSchema.parse({ operator: "ana" }).operator).toBe("ana");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @tieout/contracts test` → FAIL (module `../responses.js` not found).

- [ ] **Step 3: Implement `responses.ts`.** Reuse existing enums from `./canonical.js` (`BREAK_TYPES`, `EXCEPTION_STATUSES`, `MATCH_KINDS`, `CANONICAL_TXN_TYPES`, `TXN_STATUSES`, `RUN_STATUSES`, `QUARANTINE_STAGES`, `EXCEPTION_EVENT_KINDS`, `TRIAGE_CLASSIFICATIONS`, `TRIAGE_CONFIDENCES`). Mirror `packages/db/src/schema.ts` columns and `packages/contracts/src/recon.ts::ReconSummary` / `packages/core` `BreakTxnDetail`. Money and all `bigint`-origin fields are `z.string()`. Timestamps are `z.string()` (ISO). jsonb fields (`metadata`, `details`, `errors`, `payload`, `controlTotals`) are `z.record(z.string(), z.unknown())` or `z.unknown()` where free-form. Full skeleton:

```ts
import { z } from "zod";
import {
  BREAK_TYPES, CANONICAL_TXN_TYPES, EXCEPTION_EVENT_KINDS, EXCEPTION_STATUSES,
  MATCH_KINDS, QUARANTINE_STAGES, RUN_STATUSES, TRIAGE_CLASSIFICATIONS,
  TRIAGE_CONFIDENCES, TXN_STATUSES,
} from "./canonical.js";

/** Money is bigint minor units serialized as a string (D5) — never a number. */
export const moneyStringSchema = z.string().regex(/^-?\d+$/, "money must be integer minor units as a string");
const iso = z.string();               // ISO-8601 UTC timestamp
const json = z.record(z.string(), z.unknown());

export const reconStatsSchema = z.object({
  runId: z.string(), asOf: iso, rulesetVersion: z.string(),
  matches: z.number().int(), matchedTransactions: z.number().int(),
  breaks: z.record(z.enum(BREAK_TYPES), z.number().int()),
  totalBreaks: z.number().int(),
  pendingBySource: z.record(z.string(), z.number().int()),
});

export const runSchema = z.object({
  id: z.string(), asOf: iso, rulesetVersion: z.string(),
  status: z.enum(RUN_STATUSES), stats: reconStatsSchema,
  startedAt: iso, finishedAt: iso.nullable(), createdAt: iso,
});

export const breakTxnDetailSchema = z.object({
  id: z.string(), version: z.number().int(), source: z.string(),
  sourceAccount: z.string(), sourceId: z.string(), type: z.enum(CANONICAL_TXN_TYPES),
  amountMinor: moneyStringSchema, netMinor: moneyStringSchema, currency: z.string(),
  occurredAt: iso, reference: z.string().nullable(), groupRef: z.string().nullable(),
});

export const breakDetailsSchema = z.object({
  txns: z.array(breakTxnDetailSchema),
}).catchall(z.unknown());        // per-type extras: reference, deltaMinor, toleranceMinor, feeNetMinor, groupKey, rate

export const breakSchema = z.object({
  id: z.string(), runId: z.string(), type: z.enum(BREAK_TYPES),
  details: breakDetailsSchema, fingerprint: z.string().nullable(), createdAt: iso,
});

export const transactionSchema = z.object({
  id: z.string(), rawId: z.string(), version: z.number().int(), isCurrent: z.boolean(),
  supersededAt: iso.nullable(), isTombstone: z.boolean(), source: z.string(),
  sourceAccount: z.string(), sourceId: z.string(), sourceType: z.string(),
  type: z.enum(CANONICAL_TXN_TYPES), amountMinor: moneyStringSchema,
  netMinor: moneyStringSchema.nullable(), currency: z.string(), occurredAt: iso,
  valueDate: z.string().nullable(), observedAt: iso, account: z.string(),
  reference: z.string().nullable(), groupRef: z.string().nullable(),
  status: z.enum(TXN_STATUSES), normalizerVersion: z.string(), metadata: json, createdAt: iso,
});
export const transactionWithVersionsSchema = transactionSchema.extend({
  versions: z.array(transactionSchema),
});

export const batchSchema = z.object({
  id: z.string(), seq: z.number(), source: z.string(), connection: z.string(),
  kind: z.string(), externalRef: z.string(), idempotencyKey: z.string(),
  contentHash: z.string(), controlTotals: json.nullable(), status: z.string(),
  unitKey: z.string().nullable(), archiveUrl: z.string().nullable(),
  observedAt: iso, createdAt: iso,
});
export const rawWithBatchSchema = z.object({
  id: z.string(), batchId: z.string(), source: z.string(), sourceAccount: z.string(),
  sourceId: z.string(), version: z.number().int(), contentHash: z.string(),
  payload: z.unknown(), isTombstone: z.boolean(), observedAt: iso, createdAt: iso,
  batch: batchSchema.optional(),
});

export const matchMemberSchema = z.object({
  transactionId: z.string(), transactionVersion: z.number().int(),
});
export const matchWithMembersSchema = z.object({
  id: z.string(), runId: z.string(), rulesetVersion: z.string(),
  kind: z.enum(MATCH_KINDS), details: json.nullable(), createdAt: iso,
  members: z.array(matchMemberSchema),
});

export const exceptionSchema = z.object({
  id: z.string(), fingerprint: z.string(), type: z.enum(BREAK_TYPES),
  status: z.enum(EXCEPTION_STATUSES), firstSeenRunId: z.string(), lastSeenRunId: z.string(),
  currentBreakId: z.string(), createdAt: iso, updatedAt: iso, seenInRuns: z.number().int(),
});
export const exceptionEventSchema = z.object({
  id: z.string(), exceptionId: z.string(), kind: z.enum(EXCEPTION_EVENT_KINDS),
  actor: z.string(), note: z.string().nullable(), runId: z.string().nullable(), createdAt: iso,
});
export const triageSuggestionSchema = z.object({
  id: z.string(), exceptionId: z.string(), breakId: z.string(), inputHash: z.string(),
  model: z.string(), promptVersion: z.string(), classification: z.enum(TRIAGE_CLASSIFICATIONS),
  confidence: z.enum(TRIAGE_CONFIDENCES), explanation: z.string(),
  suggestedAction: z.string(), createdAt: iso,
});
export const exceptionDetailSchema = exceptionSchema.extend({
  currentBreak: breakSchema.nullable(),
  events: z.array(exceptionEventSchema),
  triageSuggestions: z.array(triageSuggestionSchema),
});

export const quarantineSchema = z.object({
  id: z.string(), batchId: z.string(), rawId: z.string().nullable(),
  stage: z.enum(QUARANTINE_STAGES), source: z.string(),
  sourceAccount: z.string().nullable(), sourceId: z.string().nullable(),
  normalizerVersion: z.string().nullable(), errors: z.unknown(), payload: z.unknown(),
  observedAt: iso, createdAt: iso,
});

export const sourceSummarySchema = z.object({
  source: z.string(), records: z.number().int(), batches: z.number().int(),
  lastLanded: iso.nullable(), quarantinedUnits: z.number().int(),
});

export const runConfigSchema = z.object({
  fxRates: z.array(z.object({ base: z.string(), quote: z.string(), rate: z.string(),
    rateSource: z.string(), rateDate: z.string() })),
});

const diffEntrySchema = z.object({ exceptionId: z.string(), fingerprint: z.string(), type: z.enum(BREAK_TYPES) });
export const runDiffSchema = z.object({
  runId: z.string(),
  appeared: z.array(diffEntrySchema),
  reopened: z.array(diffEntrySchema),
  selfResolved: z.array(diffEntrySchema),
});

export const meSchema = z.object({ operator: z.string().nullable() });

export type Run = z.infer<typeof runSchema>;
export type ReconStats = z.infer<typeof reconStatsSchema>;
export type Break = z.infer<typeof breakSchema>;
export type BreakTxnDetail = z.infer<typeof breakTxnDetailSchema>;
export type TransactionRow = z.infer<typeof transactionSchema>;
export type TransactionWithVersions = z.infer<typeof transactionWithVersionsSchema>;
export type RawWithBatch = z.infer<typeof rawWithBatchSchema>;
export type MatchWithMembers = z.infer<typeof matchWithMembersSchema>;
export type ExceptionRow = z.infer<typeof exceptionSchema>;
export type ExceptionEvent = z.infer<typeof exceptionEventSchema>;
export type TriageSuggestion = z.infer<typeof triageSuggestionSchema>;
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>;
export type QuarantineRow = z.infer<typeof quarantineSchema>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type RunDiff = z.infer<typeof runDiffSchema>;
export type Me = z.infer<typeof meSchema>;
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @tieout/contracts test` → PASS. Then `pnpm --filter @tieout/contracts typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): response schemas for the dashboard API boundary"`

---

### Task 0.2: API — `GET /me` + persona resolution

**Files:** Modify `apps/api/src/app.ts`; Test `apps/api/src/test/api.test.ts`.

**Interfaces — Produces:** `GET /me` → `{ operator: string | null }`.

- [ ] **Step 1: Failing test** — add to `api.test.ts`:

```ts
it("GET /me resolves the demo persona as null", async () => {
  const res = await app.request("/me");
  expect(await res.json()).toEqual({ operator: null });
});
it("GET /me names an operator for a valid bearer token", async () => {
  const res = await app.request("/me", { headers: { authorization: `Bearer ${OP_TOKEN}` } });
  expect(await res.json()).toEqual({ operator: "ana" });
});
```
(Use the same operator-token fixture the existing mutation tests use.)

- [ ] **Step 2: Run** — `pnpm --filter @tieout/api test` → FAIL (404).

- [ ] **Step 3: Implement** — in `createApp`, after `/healthz`:
```ts
app.get("/me", (c) => json({ operator: operatorFor(operatorTokens, c.req.header("authorization")) }));
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): GET /me persona resolution for the web session"`

---

### Task 0.3: API — `GET /breaks/:id`

**Files:** Modify `apps/api/src/app.ts`; Test `api.test.ts`.

**Interfaces — Produces:** `GET /breaks/:id` → a `breaks` row (404 on unknown/invalid uuid).

- [ ] **Step 1: Failing test** — seed a run+break in the test db (reuse existing test helpers that insert a run/break), then:
```ts
it("GET /breaks/:id returns one break with its details", async () => {
  const res = await app.request(`/breaks/${breakId}`);
  const body = await res.json();
  expect(body.id).toBe(breakId);
  expect(Array.isArray(body.details.txns)).toBe(true);
});
it("GET /breaks/:id 404s an unknown id", async () => {
  const res = await app.request(`/breaks/00000000-0000-4000-8000-000000000000`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — mirror the `/runs/:id` handler shape:
```ts
app.get("/breaks/:id", async (c) => {
  const id = idParam(c);
  if (id === null) return notFound();
  const [row] = await db.select().from(breaks).where(eq(breaks.id, id));
  return row === undefined ? notFound() : json(row);
});
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): GET /breaks/:id for the explain view"`

---

### Task 0.4: API — `GET /runs/:id/matches`

**Files:** Modify `apps/api/src/app.ts` (import `matches`, `matchMembers`); Test `api.test.ts`.

**Interfaces — Produces:** `GET /runs/:id/matches` → `MatchWithMembers[]` (each match row + its `members: {transactionId, transactionVersion}[]`), ordered by `kind` then `createdAt`. 404 if the run is unknown.

- [ ] **Step 1: Failing test** — seed a match + two members under `runId`; assert the response groups members under the match and includes `kind`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — load matches for the run, then their members in one `inArray` query, group in memory (no N+1):
```ts
app.get("/runs/:id/matches", async (c) => {
  const id = idParam(c);
  if (id === null) return notFound();
  const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, id));
  if (run === undefined) return notFound();
  const rows = await db.select().from(matches).where(eq(matches.runId, id)).orderBy(asc(matches.kind), asc(matches.createdAt));
  const members = rows.length === 0 ? [] : await db
    .select({ matchId: matchMembers.matchId, transactionId: matchMembers.transactionId, transactionVersion: matchMembers.transactionVersion })
    .from(matchMembers).where(inArray(matchMembers.matchId, rows.map((r) => r.id)));
  const byMatch = new Map<string, { transactionId: string; transactionVersion: number }[]>();
  for (const m of members) (byMatch.get(m.matchId) ?? byMatch.set(m.matchId, []).get(m.matchId)!).push({ transactionId: m.transactionId, transactionVersion: m.transactionVersion });
  return json(rows.map((r) => ({ ...r, members: byMatch.get(r.id) ?? [] })));
});
```
(Add `inArray` to the `drizzle-orm` import.)
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): GET /runs/:id/matches with grouped members"`

---

### Task 0.5: API — `GET /runs/:id/sources` + run config on `GET /runs/:id`

**Files:** Modify `apps/api/src/app.ts` (import `fxRates`, `sql`, `count`); Test `api.test.ts`.

**Interfaces — Produces:**
- `GET /runs/:id/sources` → `SourceSummary[]` — per source: `records` (count of current transactions or raw records for the source), `batches` (distinct ingestion batches), `lastLanded` (max batch `observedAt`), `quarantinedUnits` (distinct quarantined batches). Set-based aggregation, no loops.
- `GET /runs/:id` response gains `config: { fxRates: [...] }` — the `fx_rates` rows whose `rateDate` equals the run's `asOf` date.

- [ ] **Step 1: Failing tests** — assert `/runs/:id/sources` returns a row per source with numeric counts; assert `/runs/:id` body has `config.fxRates`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — sources via grouped aggregates over `ingestion_batches` (+ a `quarantined_records` count subquery keyed by source); config via `fxRates` filtered to the run's as-of day. Keep money/rate as strings.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): per-source summary and run FX config"`

---

### Task 0.6: API — `seenInRuns` on exceptions

**Files:** Modify `apps/api/src/app.ts`; Test `api.test.ts`.

**Interfaces — Produces:** `/exceptions` and `/exceptions/:id` responses include `seenInRuns: number` = count of distinct `runId` across the exception's `opened`/`reopened` events.

- [ ] **Step 1: Failing test** — an exception with events across 2 runs reports `seenInRuns: 2`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — for the list, one grouped `count(distinct run_id)` query keyed by `exceptionId` (no N+1); merge onto rows. For detail, derive from the already-loaded `events`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): seenInRuns on exception responses"`

---

### Task 0.7: Scaffold `apps/web` (Next 15 + Tailwind v4 + fonts + tooling)

**Files:** Create `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `.env.example`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx` (temporary "it renders" page). Modify `turbo.json` globalEnv (`API_BASE_URL`, `SESSION_COOKIE_SECURE`). Overwrite `apps/web/README.md`.

**Interfaces — Produces:** a running `pnpm --filter @tieout/web dev`; `build`, `typecheck`, `lint`, `test` scripts wired into Turbo.

- [ ] **Step 1:** Write `package.json`:
```json
{
  "name": "@tieout/web", "version": "0.0.0", "private": true, "type": "module",
  "scripts": {
    "dev": "next dev -p 3000", "build": "next build", "start": "next start -p 3000",
    "typecheck": "tsc --noEmit", "lint": "next lint --max-warnings 0",
    "test": "vitest run", "test:e2e": "playwright test"
  },
  "dependencies": {
    "@tieout/contracts": "workspace:*", "next": "^15.1.0",
    "react": "^19.0.0", "react-dom": "^19.0.0", "zod": "^4.0.0"
  },
  "devDependencies": {
    "@tieout/eslint-config": "workspace:*", "@tieout/typescript-config": "workspace:*",
    "@tailwindcss/postcss": "^4.0.0", "tailwindcss": "^4.0.0",
    "@testing-library/react": "^16.1.0", "@testing-library/jest-dom": "^6.6.0",
    "@types/node": "^22.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0", "jsdom": "^25.0.0", "vitest": "^3.0.0",
    "@playwright/test": "^1.49.0", "eslint": "^9.39.1", "eslint-config-next": "^15.1.0",
    "typescript": "5.9.2"
  }
}
```
- [ ] **Step 2:** `tsconfig.json` extends base, adds Next needs:
```json
{
  "extends": "@tieout/typescript-config/base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "preserve",
    "plugins": [{ "name": "next" }], "paths": { "@/*": ["./*"] },
    "allowJs": true, "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
- [ ] **Step 3:** `postcss.config.mjs`: `export default { plugins: { "@tailwindcss/postcss": {} } };`
- [ ] **Step 4:** `app/globals.css` — Tailwind v4 CSS-first tokens (verify directive syntax against Tailwind v4 docs via context7 at build time):
```css
@import "tailwindcss";
@theme {
  --color-paper: #FBFAF7;  --color-ink: #16130E;  --color-muted: #6B6558;
  --color-hair: #E6E2D8;   --color-wash: #F4F1EA;
  --color-break: #8C2B1F;  --color-matched: #1E5C41; --color-pending: #8A5A00;
  --font-sans: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
}
html { background: var(--color-paper); color: var(--color-ink); }
/* motif: the double rule (2px over 1px), used by DoubleRule + focus rings */
```
- [ ] **Step 5:** `app/layout.tsx` — load fonts via `next/font/google` (`IBM_Plex_Sans` weights 400/500/600/700, `IBM_Plex_Mono` 400/500/600), expose as `--font-plex-sans` / `--font-plex-mono` CSS variables on `<html>`; import `globals.css`; set `<html lang="en">`. (Chrome/Footer added in Task 0.9.)
- [ ] **Step 6:** `eslint.config.mjs` — extend `@tieout/eslint-config/base` + Next/React/a11y (see Task note); `vitest.config.ts` with `@vitejs/plugin-react`, `environment: "jsdom"`, `setupFiles: ["./vitest.setup.ts"]`; `vitest.setup.ts` imports `@testing-library/jest-dom`.
- [ ] **Step 7:** `.env.example`: `API_BASE_URL=http://localhost:3001`, `SESSION_COOKIE_SECURE=false`. Add both to `turbo.json` `globalEnv`.
- [ ] **Step 8: Verify** — `pnpm install`; `pnpm --filter @tieout/web typecheck` PASS; `pnpm --filter @tieout/web dev` serves the temp page at `/`.
- [ ] **Step 9: Commit** — `git commit -m "feat(web): scaffold Next.js app with Tailwind v4 tokens and Plex fonts"`

---

### Task 0.8: API client + env + money/time utils

**Files:** Create `apps/web/lib/env.ts`, `lib/api/client.ts`, `lib/api/endpoints.ts`, `lib/money.ts`, `lib/time.ts`; Tests `lib/money.test.ts`, `lib/api/client.test.ts`.

**Interfaces — Produces:**
- `formatMoney(minor: string | bigint, currency: string): string` — `"$66.81"`, `"−$66.81"` (U+2212 minus), `"2,900.00 MXN"`; exponent from `CURRENCY_EXPONENT` (`USD:2, MXN:2, JPY:0, USDC:6`, default 2).
- `fetchJson<T>(path: string, schema: z.ZodType<T>, init?): Promise<T>` — server-only, prefixes `env.apiBaseUrl`, `cache: "no-store"` for run-context freshness, throws `ApiError` on non-2xx, parses with the schema.
- `endpoints`: `getRuns`, `getRun`, `getRunDiff`, `getRunBreaks`, `getRunMatches`, `getRunSources`, `getBreak`, `getTransaction`, `getRaw`, `getQuarantine`, `getExceptions`, `getException`, `getMe` — each typed via a Task 0.1 schema.

- [ ] **Step 1: Failing test** (`money.test.ts`) — cover every exponent, negative sign (U+2212), thousands separators, string & bigint input, USDC 6-dp:
```ts
import { formatMoney } from "./money.js";
it("USD 2dp", () => expect(formatMoney("6681", "USD")).toBe("$66.81"));
it("negative uses a real minus sign", () => expect(formatMoney("-6681", "USD")).toBe("−$66.81"));
it("MXN suffix", () => expect(formatMoney("290000", "MXN")).toBe("2,900.00 MXN"));
it("JPY 0dp", () => expect(formatMoney("2900", "JPY")).toBe("¥2,900"));
it("USDC 6dp", () => expect(formatMoney("1500000", "USDC")).toBe("1.500000 USDC"));
it("accepts bigint", () => expect(formatMoney(6681n, "USD")).toBe("$66.81"));
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `money.ts`** — pure bigint arithmetic; split on the exponent; group the integer part with a manual thousands separator (no `toLocaleString` on money to stay deterministic); prefix `$`/`¥` for symbol currencies, else suffix the code. No `Number()` on the minor units.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** Implement `env.ts` (throws if `API_BASE_URL` unset at first server use), `client.ts` (`fetchJson` + `ApiError`), `endpoints.ts`; add `client.test.ts` mocking `fetch` to assert schema validation + `ApiError` on 500. `time.ts`: `formatUtc(iso)` → `"2026-06-05 00:00 UTC"`, `formatUtcDate(iso)`, `age(iso, now)`.
- [ ] **Step 6: Run** → PASS; `typecheck`.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): typed API client, money and UTC formatters"`

---

### Task 0.9: Primitives + Chrome shell + Shell layout

**Files:** Create `components/primitives/*` (`Money`, `Mono`, `StateChip`, `SectionLabel`, `DoubleRule`, `CopyButton`, `UtcTime`, `Shell`), `components/chrome/*` (`TopBar`, `PersonaChip`, `RunContextLine`, `Footer`, `CommandSearch`, `FirstVisitBanner`); wire into `app/layout.tsx`. Tests: `StateChip.test.tsx`, `Money.test.tsx`, `DoubleRule.test.tsx`.

**Source of truth:** `Chrome.dc.html` (TopBar, persona menu, ⌘K search, run-context line, footer copy). Translate per Translation Rules.

**Interfaces — Produces:**
- `<Money minor={string} currency={string} className? />` — `font-mono tabular-nums text-right`; negatives use `text-break`.
- `<StateChip state="break"|"matched"|"pending"|"resolved"|"open"|"acknowledged"|"reopened" label />` — colored text + hairline border + **always a text label** (color never sole signal).
- `<SectionLabel>` — `text-[12px] tracking-[0.09em] uppercase text-muted font-semibold`.
- `<DoubleRule width? />` — the 2px+1px motif; also the focus-ring treatment.
- `<Shell>` — `max-w-[1280px] mx-auto px-[clamp(20px,5vw,40px)]`.
- `<CopyButton value />` — client component; copies + shows a check tick 1.2s.
- `<UtcTime iso label?="occurred"|"observed" />`.

- [ ] **Step 1: Failing tests** — `StateChip` renders its label text and the correct token class for each state; `Money` renders `$66.81` for `{minor:"6681",currency:"USD"}` and applies `text-break` when negative; `DoubleRule` renders two rules.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** primitives (server components except `CopyButton`, `CommandSearch`, `FirstVisitBanner`, `PersonaChip` menu which are `"use client"`). `CommandSearch` reproduces the ⌘K palette from `Chrome.dc.html` but its items link to real routes; the search index can start static (the mock's items) and is upgraded later.
- [ ] **Step 4:** Wire `TopBar` + `RunContextLine` + `Footer` into `layout.tsx`. Persona chip reads persona via `getMe()` server-side (Task 3 completes the login/logout wiring; here it renders demo by default).
- [ ] **Step 5: Run** component tests → PASS; `dev` shows the full chrome.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): editorial primitives and top-bar chrome"`

---

## PHASE 1 — Value first: Overview, Breaks worklist, Break-explain hero

### Task 1.1: Explain presenter (pure) + labels

**Files:** Create `lib/explain/labels.ts` (`GLOSS`, `TYPE_LABEL` — copied verbatim from the brief's canonical table), `lib/explain/present.ts`, `lib/explain/present.test.ts`.

**Interfaces — Produces:**
- `GLOSS: Record<BreakType,string>`, `TYPE_LABEL: Record<BreakType,string>` (verbatim canonical copy).
- `buildEvidenceChain(input: { break: Break; transaction: TransactionWithVersions | null; raw: RawWithBatch | null }): EvidenceHopModel[]` — ordered hops: `conclusion`, `matching`, `transaction`, `raw`, `batch`.
- `matchingNarrative(b: Break): { label: string; detail: string; pass: boolean }[]` — derived deterministically from `b.type` + `b.details` (`reference`, `deltaMinor`/`toleranceMinor`, `feeNetMinor`, `groupKey`, rate). E.g. `amount_mismatch` → a "Tolerance check" line stating `delta` vs `tolerance` from the details; `duplicate_candidate` → the kept/consumed resolution line; `fx_drift` → grouped-reference pass + rate-vs-recorded line + tolerance line.
- `headlineFor(b: Break): string` — the plain-English one-liner naming the primary txn id + `formatMoney(amount)` (derived from `details.txns[0]`).

- [ ] **Step 1: Failing tests** — one per break type, using fixtures shaped from `tieout-data.js` mapped to the real `Break`/details shape:
```ts
it("missing_in_ledger narrative names the unmatched reference and ends in a break", () => {
  const rows = matchingNarrative(fixtures.missingInLedger);
  expect(rows.at(-1)!.detail.toLowerCase()).toContain("break");
  expect(rows.some(r => r.detail.includes("ch_mercadia_0014"))).toBe(true);
});
it("amount_mismatch states delta vs tolerance from details", () => {
  const rows = matchingNarrative(fixtures.amountMismatch); // details: {deltaMinor:"750", toleranceMinor:"200"}
  expect(rows.some(r => r.detail.includes("$7.50") && r.detail.includes("$2.00"))).toBe(true);
});
it("buildEvidenceChain yields conclusion→matching→transaction→raw→batch in order", () => {
  const kinds = buildEvidenceChain(fixtures.full).map(h => h.kind);
  expect(kinds).toEqual(["conclusion","matching","transaction","raw","batch"]);
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `present.ts` (pure; imports `formatMoney`, `GLOSS`, `TYPE_LABEL`). No I/O.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): pure evidence-chain presenter derived from break facts"`

---

### Task 1.2: Seed verification checkpoint

**Files:** none (verification task) — may add `lib/explain/present.test.ts` fixtures aligned to the seed.

- [ ] **Step 1:** With docker up + `pnpm seed` + a recon run, `curl` the local API: `/runs`, `/runs/:latest/breaks`, `/breaks/:id`, `/transactions/:id`, `/raw/:id`. Confirm the seed produces the hero exemplars (the $66.81 `txn_re_0014` missing_in_ledger; the fx_drift with a recorded vs booked rate; a duplicate_candidate; an amount_mismatch). Record the real ids.
- [ ] **Step 2:** Where the seed's framing differs from the mock (headlines, exact secondary amounts), note it; the record wins. If a hero exemplar is genuinely absent from the seed, open a follow-up note in the spec's "Later" — do NOT fabricate it in the UI.
- [ ] **Step 3: Commit** (only if fixtures changed) — `git commit -m "test(web): align explain fixtures to the seeded record"`

---

### Task 1.3: Break-explain hero page (the demo climax)

**Files:** Create `app/breaks/[id]/page.tsx`, `components/explain/EvidenceSpine.tsx`, `EvidenceHop.tsx`, `PayloadViewer.tsx`, `VersionChain.tsx`, `components/case/CaseRail.tsx`, `TriageMargin.tsx`, `EventTimeline.tsx`, `ActionButtons.tsx`. Test: `EvidenceSpine.test.tsx`, `TriageMargin.test.tsx`.

**Source of truth:** `Break-Explain.dc.html` (all four variants), `Exception-Case.dc.html` (rail timeline).

**Interfaces — Consumes:** `getBreak`, `getTransaction`, `getRaw`, `getException` (for the rail), `buildEvidenceChain`, `matchingNarrative`, `headlineFor`.

- [ ] **Step 1:** RSC `page.tsx`: fetch break → its primary `details.txns[0].id` → `getTransaction` → `getRaw(txn.rawId)`; fetch the linked exception (by fingerprint) for the rail. Assemble hops via the presenter. Render `EvidenceSpine` (main column) + `CaseRail` (right rail) at desktop; stacked at mobile.
- [ ] **Step 2:** `EvidenceHop` — numbered, flat, hairline-connected, expandable in place (`<details>` for zero-JS progressive disclosure; the signature "draw-in" animation is a CSS keyframe honoring `prefers-reduced-motion`). `PayloadViewer` — monospace panel, "exactly as received" caption, content hash via `CopyButton`. `VersionChain` — renders `transaction.versions` with the respectful superseded copy.
- [ ] **Step 3:** `TriageMargin` — the margin-annotation card ("Suggested by Claude · never blocks, never edits"): classification chip, explanation, one next step, model+prompt footer, from the exception's newest `triageSuggestions[0]`. `ActionButtons` — Acknowledge/Resolve, disabled for demo with the enforced-server-side tooltip (wired to Server Actions in Phase 3).
- [ ] **Step 4:** Component tests: `EvidenceSpine` renders 5 hops for a full fixture; `TriageMargin` shows the disclaimer label and next step.
- [ ] **Step 5:** Verify against the local API for each of the four break types; check mobile at 390px.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): break-explain hero — evidence spine, case rail, triage margin"`

---

### Task 1.4: Overview page

**Files:** Create `app/page.tsx` (replace temp), `components/data/CounterBlock.tsx`, `TypedList.tsx`, `TrendStrip.tsx`, `SourcesStrip.tsx`, `components/chrome/FirstVisitBanner.tsx`. Test: `CounterBlock.test.tsx`, `TrendStrip.test.tsx`.

**Source of truth:** `Overview.dc.html`.

**Interfaces — Consumes:** `getRuns` (latest + trend window), `getRun` (latest stats), `getRunBreaks` (by-type rollup), `getRunSources`, `getRunDiff` (trend appeared/self-resolved).

- [ ] **Step 1:** RSC composes counters (MATCHED=`stats.matches` w/ `matchedTransactions`; BREAKS=`stats.totalBreaks` + delta vs prev; PENDING=Σ`pendingBySource`; QUARANTINED=sources rollup), breaks-by-type `TypedList` (rows link to `/breaks?type=…`), `TrendStrip`, `SourcesStrip`, latest-run block. `FirstVisitBanner` (client, dismissable, demo-only) points at the real hero break id.
- [ ] **Step 2:** `CounterBlock` (big mono number, small-caps label, delta color from state), `TrendStrip` (appeared oxblood over self-resolved green bars, `prefers-reduced-motion` safe), `SourcesStrip`.
- [ ] **Step 3:** Tests: `CounterBlock` renders delta in `text-break` when breaks rose; `TrendStrip` renders one bar-pair per run.
- [ ] **Step 4:** Verify against local API.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): overview — counters, breaks-by-type, trend, sources"`

---

### Task 1.5: Breaks worklist

**Files:** Create `app/breaks/page.tsx`, `components/data/BreaksTable.tsx`, `components/states/EmptyTiedOut.tsx`. Test: `BreaksTable.test.tsx`, `EmptyTiedOut.test.tsx`.

**Source of truth:** `Breaks-Worklist.dc.html`.

**Interfaces — Consumes:** `getRuns` (run switcher), `getRunBreaks(runId, {type})`, `getExceptions` (to join exception status per fingerprint). Filters via URL search params: `run`, `type`, `status`, `currency`.

- [ ] **Step 1:** RSC reads search params; default to latest run; render `BreaksTable` (type chip, headline via `headlineFor`, `Money`, source(s), age, exception status chip, → to `/breaks/[id]`). Empty result → `EmptyTiedOut` ("Everything tied out." over a `DoubleRule`).
- [ ] **Step 2:** Filter controls update search params (server-rendered, shareable).
- [ ] **Step 3:** Tests: table renders a row per break with a linked headline; empty state renders the brand copy + double rule.
- [ ] **Step 4:** Verify + mobile stacked cards.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): breaks worklist with type/status/run filters"`

---

## PHASE 2 — Runs

### Task 2.1: Runs list
**Files:** `app/runs/page.tsx`, reuse tables. **Source:** `Runs.dc.html`. Consumes `getRuns`.
- [ ] Steps: RSC renders mono run ids (link to detail), as-of, ruleset, mini-stats (matched/breaks/pending), duration; TDD a `RunsTable` row test; verify; commit `feat(web): runs list`.

### Task 2.2: Run detail + tabs (Matches / Breaks / Diff)
**Files:** `app/runs/[id]/page.tsx`, `components/run/MatchesTable.tsx`, `RunDiffSections.tsx`. **Source:** `Run-Detail.dc.html`. Consumes `getRun` (+config), `getRunMatches`, `getRunBreaks`, `getRunDiff`, `getRunSources`.
- [ ] Steps: RSC renders full stats, recorded config (tolerances + FX rates table, one rate per pair), per-source landing table; tab via `?tab=matches|breaks|diff` search param. `MatchesTable` shows kind chips; grouped matches expand to member lines with nets summing to the booking (member txns fetched by id, batched — no N+1). `RunDiffSections` renders APPEARED/SELF-RESOLVED/REOPENED with counts and the self-resolved caption. TDD `RunDiffSections` (classifies entries into three labeled sections); assert against the seeded restatement scenario per stage-3 acceptance. Verify; commit `feat(web): run detail with matches, breaks, and run-vs-run diff`.

---

## PHASE 3 — Exceptions & operator auth

### Task 3.1: Session helper + login/logout server actions + `/login`
**Files:** `lib/session.ts`, `app/actions.ts` (login/logout), `app/login/page.tsx`, `components/chrome/PersonaChip.tsx` (wire real persona). **Source:** `Login.dc.html`, `Chrome.dc.html` persona menu.

**Interfaces — Produces:**
- `getSessionToken(): Promise<string | undefined>` (reads httpOnly cookie via `next/headers`).
- `getPersona(): Promise<Me>` (calls `getMe()` with the session token).
- `login(formData)` server action — validates name+token via `getMe()`; on operator, sets cookie `tieout_op` (`httpOnly`, `secure` from `SESSION_COOKIE_SECURE`, `sameSite:"lax"`, `path:"/"`), redirects to `/`; on failure, returns a field error. `logout()` clears it.

- [ ] Steps: TDD `session` cookie read; implement actions; `/login` centered editorial card (name + token, one line of copy, "← continue as demo viewer" escape hatch); persona chip menu switches persona (operator → link to login; logout). Verify a bad token is rejected and a good one lands as `ana`. Commit `feat(web): operator session via httpOnly token cookie and login`.

### Task 3.2: Exceptions worklist + case view + mutations
**Files:** `app/exceptions/page.tsx`, `app/exceptions/[id]/page.tsx`, `components/data/ExceptionsTable.tsx`, `components/case/ResolveDialog.tsx`; extend `app/actions.ts` (`acknowledge`, `resolve`). **Source:** `Exceptions-Worklist.dc.html`, `Exception-Case.dc.html`.

**Interfaces — Consumes:** `getExceptions({status})`, `getException(id)`; Server Actions POST to `/exceptions/:id/acknowledge|resolve` with the session bearer token, then `revalidatePath`.

- [ ] Steps: worklist tabs Open/Acknowledged/Resolved/Reopened with counts; rows (type chip, summary, `Money`, **seen in N runs**, age, last actor). Case view: append-only `EventTimeline` as centerpiece (actor, UTC, run links), the current break's evidence chain embedded beneath (reuse `EvidenceSpine`), `ActionButtons` live for operators. `ResolveDialog` — one required reason field; the standing "resolving never edits financial data" copy. TDD: acknowledge action forwards `Authorization` and calls `revalidatePath`; demo persona sees disabled controls. Verify the operator walk end-to-end against local API. Commit `feat(web): exceptions worklist, case view, operator acknowledge/resolve`.

---

## PHASE 4 — Quarantine

### Task 4.1: Quarantine page
**Files:** `app/quarantine/page.tsx`, `components/quarantine/ControlTotalsPanel.tsx`, `CircuitBreakerRows.tsx`. **Source:** `Quarantine.dc.html`. Consumes `getQuarantine`.
- [ ] Steps: two-column declared-vs-computed panel (line count, sum) from the batch `controlTotals`/`errors`; structured reason list; raw payload via `PayloadViewer`; circuit-breaker "not processed: batch halted" rows; standing "Quarantine is a worklist, not a trash can." copy. TDD `ControlTotalsPanel` (highlights the mismatch). Verify; commit `feat(web): quarantine — control-total contradiction and halted batches`.

---

## PHASE 5 — Polish, e2e, docs

### Task 5.1: States, mobile, ⌘K, banner polish
**Files:** `app/loading.tsx`, `app/error.tsx`, per-route `loading.tsx`, `components/states/*`; refine `CommandSearch` to link real ids. 
- [ ] Steps: hairline-rule skeletons (not gray blobs); honest `error.tsx` (domain voice, retry); confirm the visitor's walk reads at 390px (tables → stacked evidence cards, spine stays vertical); `prefers-reduced-motion` respected on the spine draw-in and trend. Verify each route's three states. Commit `feat(web): loading, empty, and error states in the domain voice`.

### Task 5.2: e2e smoke — the visitor's walk
**Files:** `playwright.config.ts`, `test/e2e/visitor-walk.spec.ts`.
- [ ] Steps: Playwright test — visit `/` (demo), assert 9 breaks + banner, click into the $66.81 break, assert the gloss headline, expand the raw hop, assert the raw payload + content hash are visible. Config points at a running web+api (documented for CI). Commit `test(web): e2e smoke of the demo visitor's walk`.

### Task 5.3: Docs pass
**Files:** `apps/web/README.md`, `docs/topology.md`, `docs/onboarding.md`, `docs/how-it-works.md` (§7), `docs/decisions.md` (D34–D36), `docs/specs/stage-3.md` (tick acceptance boxes), `docs/specs/stage-3-web.md` (mark done).
- [ ] Steps: real quickstart in the web README (env, dev, how it talks to the API); topology gains `web` in the running stack; onboarding gains an "add a page" recipe + the codemap; how-it-works §7 names the dashboard as the record's second consumer; decisions D34 (API-backed), D35 (Tailwind v4 tokens), D36 (session model). Commit `docs: dashboard onboarding, topology, and decisions D34–D36`.

---

## Self-Review

**Spec coverage:** Overview (1.4), Breaks worklist (1.5), Break-explain hero + 4 variants (1.3/1.1), Runs list/detail/diff (2.1/2.2), Exceptions worklist + case (3.2), Quarantine (4.1), Login (3.1), two personas (0.2/3.1/3.2), API reads §A (0.2–0.6), contracts §B (0.1), web §C (0.7–5.x), testing (throughout + 5.2), docs (5.3). All spec sections map to a task.

**Placeholder scan:** logic-bearing steps (schemas, endpoints, money, presenter, session) carry complete code; visual components reference their authoritative `.dc.html` + explicit Translation Rules + typed prop contracts + test assertions — the DRY-correct form for a design-translation build (the design files are the source, not duplicated here).

**Type consistency:** response schema/type names in Task 0.1 are the exact names consumed by `endpoints` (0.8), the presenter (1.1), and every page; `Me`, `Break`, `TransactionWithVersions`, `RawWithBatch`, `RunDiff`, `SourceSummary` are used consistently.

**Note:** Tasks 2.1/2.2/3.x/4.1/5.x compress the TDD micro-steps into a step summary to keep the plan legible; when executing, expand each to the failing-test → run → implement → run → commit cycle used explicitly in Phase 0–1.
