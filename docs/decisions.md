# Technical decisions

Dense by design. One entry per decision, with why. If a decision changes, edit the entry in place and date the change — don't append a contradiction. New decisions get the next number.

## Stack

**D1 — TypeScript everywhere, strict mode.** One language across jobs, API, web, and tooling. Node runtime (Trigger.dev tasks run Node, not Bun).

**D2 — Monorepo: pnpm workspaces + Turborepo.** Layout: `apps/web` (Next.js), `apps/api` (Hono), `apps/jobs` (Trigger.dev tasks), `packages/contracts` (Zod schemas + shared types), `packages/core` (pure domain), `packages/db` (Drizzle schema + migrations), `packages/adapters` (source adapters), `packages/seed` (Mercadia generator). Why: atomic cross-package changes, one context for agent-assisted dev, cached verify loop.

**D3 — Postgres + Drizzle.** One canonical `transactions` relation + JSONB `metadata` for source-specific extras. Promote a metadata field to a real column (and backfill from raw) the moment matching needs it. No per-source tables.

**D4 — Trigger.dev for orchestration.** Cloud free tier now; self-host via official Helm chart on k3s at Stage 4 (skip Compose self-hosting entirely). Tasks orchestrate; `packages/core` computes. Our Postgres is the audit truth — never depend on Trigger.dev logs/retention for anything the product must remember.

## Money

**D5 — Integer minor units only.** `amountMinor: bigint` + currency exponent map (USD 2, JPY 0, BHD 3, USDC 6). Parse source strings directly to bigint; a float never touches money. Handle locale decimals explicitly (PagoLat: `1.234,56`).

**D6 — One sign convention.** Signed amounts from the company's perspective: inflow positive, outflow negative. Adapters conform; native direction preserved in metadata.

**D7 — No FX at ingestion.** Store native currency. Conversion happens at match time with an explicit, recorded rate and tolerance. Converting earlier destroys information and bakes in an unauditable rate choice.

## Ingestion spine

**D8 — Sources emit observations, not facts. The spine is append-only and versioned.** Tables: `ingestion_batches` → `raw_records` → `transactions`, plus `quarantined_records` and `source_cursors`. Financial rows are never UPDATEd or DELETEd; a changed payload (detected by content hash) inserts version n+1 and flips `isCurrent`. Records that vanish from a restated feed get a tombstone version. Statuses are not monotonic (settled → reversed is real).

**D9 — Raw first, normalize second.** Land payloads exactly as received (`raw_records`, files archived in MinIO), then normalize deterministically. Every transaction carries `rawId` + `normalizerVersion`, so normalizer bugs are fixed by re-normalizing from raw — never by re-fetching, never untraceably.

**D10 — Identity is (source, sourceAccount, sourceId).** `sourceAccount` exists because multi-account is day-one reality. Id-less sources (bank CSV lines) get a deterministic synthetic id: hash(file identity, normalized line content, occurrence index) — occurrence index preserves legitimate duplicates.

**D11 — Two clocks.** `occurredAt`/`valueDate` = event time (UTC always); `observedAt` = when we learned it. Recon runs record the transaction versions they evaluated → reproducible forever.

**D12 — Overlapping fetch windows + per-source watermarks.** Each poll re-covers a lookback window (idempotency makes this cheap) because data arrives late and out of order. Settlement-lag expectations per source keep "not yet" from being reported as "missing".

**D13 — Batch-level integrity before matching.** Statement files must satisfy their own invariants (opening + sum(lines) = closing, control totals). Failures quarantine the whole batch. Completeness ("did we ingest everything?") is a separate check from matching.

**D14 — Quarantine over guessing.** Validation failures become `quarantined_records` rows with structured errors; a batch halts past a failure-rate threshold (circuit breaker). Quarantine is an exceptions surface, not a log file.

**D15 — Native types preserved.** `sourceType` stored verbatim alongside the small canonical `type` enum (`payment, refund, payout, fee, transfer, reversal, adjustment`). Mapping is data-driven, not a hardcoded switch; unmapped types quarantine.

## Matching & downstream

**D16 — Pure core, zero I/O.** Matching, money math, classification live in `packages/core` as pure functions. Property tests (fast-check) enforce invariants: no transaction in two matches; matched sums preserved; identical inputs → identical results. Adapters get golden-file tests (real sample payloads → expected normalized output, committed to the repo).

**D17 — Match results reference transaction id + version** plus the `ruleset_version` that produced them. `match_members` also carries `run_id` so Postgres itself forbids one transaction in two matches within a run. Supersession of a matched transaction emits an outbox event → match re-evaluation (may reopen a break). No dual writes; the outbox is the only event mechanism. (Outbox arrives Stage 2; Stage 1 records versions only.)

**D18 — Breaks are typed** (missing_in_source, amount_mismatch, duplicate, unexpected_fee, fx_drift, ...) and flow into `exceptions` with an append-only `exception_events` history.

## Process & security

**D19 — Seed-first development.** `packages/seed` generates the deterministic Mercadia dataset with planted breaks. It drives tests, demos, and the public demo's scheduled reset. If a feature can't be demonstrated on seed data, it isn't done.

**D20 — Single-tenant now, multi-tenant-ready ids.** No `workspace_id` yet; keep entity ids clean so adding it is a migration, not a rewrite.

**D21 — Consciously deferred.** UI/auth → Stage 3. Webhooks → later, and as hints only (poll is truth). k8s → Stage 4 (k3s + official Helm chart; box needs 16GB+ RAM). Multi-tenancy → post-Stage 4.

**D22 — Security posture.** Secrets via env only (`.env.example` committed, gitleaks in CI). Stripe test mode exclusively. Public surface = demo app behind Cloudflare Tunnel + rate limiting; operational surfaces (Trigger dashboard, Drizzle Studio, MinIO console) behind Cloudflare Access or Tailscale. All demo data synthetic.

**D23 — License: Apache-2.0.** Matches the ecosystem (Trigger.dev, Formance), includes patent grant.

**D24 — Canonical statuses: `pending, settled, failed, reversed`.** Mirrors D15: `sourceType`/native status stored verbatim, mapping is data-driven per adapter, unmapped statuses quarantine. Not monotonic by design (D8).

**D25 — Stage 1 sources are seed-materialized files.** `pnpm seed` writes the deterministic Mercadia dataset to committed JSON (`packages/seed/data/`): a ledger export and a Stripe balance-transactions list fixture. Adapters land these whole units keyed by content hash, so tests and the quickstart never touch the network and a restated file is naturally a new unit. A live API client replaces only the read inside `land()` (window-keyed idempotency comes with it); `normalize()` and everything downstream are already final.