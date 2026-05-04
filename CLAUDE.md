# CLAUDE.md

Tieout: open-source payments reconciliation engine. Ingests transactions from multiple sources, normalizes them, matches them, surfaces breaks, keeps an immutable audit trail. TypeScript monorepo (pnpm + Turborepo), Postgres + Drizzle, Trigger.dev for orchestration.

## The loop

1. **Read first**: `docs/decisions.md` (architecture), `docs/topology.md` (runtime), and the active spec in `docs/specs/`. They are short on purpose. If docs and code disagree, code is reality — fix the doc in the same change.
2. **Do the work**, scoped to the active spec.
3. **Update the docs** if a decision, table, service, or command changed. Keep them dense and accurate. New architectural decisions become numbered entries in `decisions.md`. No doc rot, no doc bloat.

## Repo map

```
apps/web        Next.js dashboard (Stage 3 — does not exist yet)
apps/api        Hono domain API (Stage 3 — does not exist yet)
apps/jobs       Trigger.dev tasks (thin: orchestrate, retry, fan out)
packages/contracts  Zod schemas + shared types — the boundary everything imports
packages/core   Pure domain: money, matching, classification. ZERO I/O.
packages/db     Drizzle schema + migrations. Constraints are correctness features.
packages/adapters   SourceAdapter implementations + golden-file fixtures
packages/seed   Deterministic Mercadia dataset with planted breaks
docs/           decisions.md · topology.md · specs/
```

## Commands & definition of done

```bash
pnpm install
docker compose up -d            # postgres + minio
pnpm db:generate && pnpm db:migrate
pnpm seed
pnpm dev                        # trigger.dev dev
turbo run typecheck lint test   # must pass before any work is "done"
```

A change is complete when typecheck, lint, and tests pass AND behavior changes carry a test (property test in core, golden file in adapters). The README quickstart must always work on a fresh clone in under five minutes.

## Hard invariants — never violate

- **Money is `bigint` minor units.** No floats touch money, ever — not in code, not in tests, not "temporarily". Parse source strings straight to bigint. Currency exponents differ (USD 2, JPY 0, USDC 6).
- **Financial rows are never UPDATEd or DELETEd.** Changed source data = new version (content-hash detected) + flip `isCurrent`. Disappeared data = tombstone version. If you're writing an UPDATE on `raw_records` or `transactions`, stop — you're about to destroy the audit trail.
- **Raw before normalized.** Every transaction traces to a `raw_records` row (`rawId`) and carries `normalizerVersion`. Fix normalizer bugs by re-normalizing from raw, never by mutating output.
- **Identity is `(source, sourceAccount, sourceId)`.** Id-less lines get the deterministic synthetic id (file identity + line content + occurrence index).
- **`packages/core` does no I/O.** No db, no fetch, no env, no clock reads (time is a parameter). Pure functions in, deterministic results out. This is what makes the property tests trustworthy.
- **Every Trigger.dev task is idempotent** with an explicit idempotency key derived from its unit of work (source + window, batch id, file hash). Assume every task will run twice.
- **No FX conversion at ingestion.** Native currency in, conversion at match time with recorded rate + tolerance.
- **Statuses are not monotonic.** settled → reversed happens (chargebacks, reorgs). Never assume forward-only.
- **UTC everywhere.** Source-local times get converted explicitly at the adapter boundary.
- **Quarantine, don't guess.** Malformed or unmappable input becomes a structured `quarantined_records` row. Never coerce, default, or skip silently.
- **Secrets never in the repo.** `.env.example` only. Stripe test mode (`sk_test_`) only. This repo is public.

## Working style

- Stay inside the active spec. Features from later stages (UI, auth, extra sources, webhooks, k8s) are out of scope until their spec is active — note ideas in the spec's "later" section instead of building them.
- Small, focused diffs with conventional commits (`feat:`, `fix:`, `docs:`...). Commit history is part of this portfolio.
- Tasks thin, core fat: a task fetches/stores/fans-out; all logic it orchestrates lives in `packages/core` or an adapter where it's testable without infrastructure.
- Prefer set-based SQL over row-at-a-time loops. Batch inserts. No N+1 against Postgres or external APIs.
- Fan-out with `batchTrigger()`, never `trigger()` in a loop (API rate limits). Pass ids between tasks, not blobs (payloads >512KB get offloaded; the db is the shared memory).
- When a needed decision isn't in `decisions.md`, make the smallest reasonable call, implement it, and add it as a new numbered entry in the same change — don't invent silently and don't stall.

## Known pitfalls (learned the hard way elsewhere)

- Bank/PSP CSV lines: no unique ids, legitimate duplicate lines, locale decimals (`1.234,56`), headers that get renamed without notice. Adapters must validate with Zod and quarantine on drift.
- Restated settlement files: same file re-issued with corrections, sometimes with lines removed. Handled by content-hash versioning + tombstones — never by overwriting.
- Settlement lag: an unmatched transaction inside its source's lag window is "pending", not a break. False breaks teach users to ignore the product.
- Trigger.dev Cloud free tier: dev runs are free; deployed concurrency ~20 (queues beyond that — fine, just slower). 1-day log retention — which is why all audit data lives in OUR Postgres, never theirs.
- A reconciliation run must be reproducible: it records the transaction versions (or as-of watermark) it evaluated. If you can't re-derive a past run's result, the audit story is broken.

## Current focus

`docs/specs/stage-1-mvp.md`. Read it before writing any code.