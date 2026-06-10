# Tieout

**Open-source payments reconciliation engine.** Tieout ingests money records from every system they live in — your ledger, payment processors, banks, stablecoin rails — normalizes them into one model, matches them against each other, and surfaces the transactions it can't explain. Every run and every decision is recorded immutably, so "why was this flagged in March?" is a query, not an apology.

> Working title. Rename is a find-and-replace away.

**New here?** [`docs/how-it-works.md`](docs/how-it-works.md) explains the entire engine in plain English — every rule, with worked examples — readable by accountants and engineers alike. Ready to change code? [`docs/onboarding.md`](docs/onboarding.md) maps every concept to the file that implements it.

## The problem

Money moves through many systems, and each keeps its own record in its own format, on its own timing, with its own fees. None of them is a single source of truth, so they drift apart silently: processor fees nobody booked, charges marked paid that never settled, a payout sent twice, a EUR settlement a few cents off. Most teams find this out the slow way — spreadsheets, month-end close, or an angry customer. Tieout finds it nightly, explains it, and gives finance a worklist instead of a VLOOKUP marathon.

## What it does

1. **Ingest** — scheduled, durable jobs pull transactions from each source (API or settlement file) and land them raw, exactly as received.
2. **Normalize** — adapters convert every source into one canonical transaction model. Malformed data is quarantined, never guessed at.
3. **Match** — a deterministic engine ties records together across sources (exact reference, then amount/currency/date-window), tolerant of FX and settlement lag.
4. **Surface breaks** — everything that doesn't tie out becomes a typed exception (missing in source, amount mismatch, duplicate, unexpected fee...) in a workflow finance can investigate and resolve.
5. **Audit** — append-only, versioned storage end to end. Runs are reproducible: the system can show exactly what it knew and decided at any point in time.

Tieout observes and explains; it never moves money.

## Who it's for

Engineering and finance-ops teams at companies that move money across more than one rail — marketplaces, fintechs, multi-PSP e-commerce, crypto platforms. The canonical user is the ops engineer reconciling five systems in Google Sheets and dreading every close. The reference customer persona ("Mercadia", a cross-border LatAm marketplace) drives the demo dataset (`packages/seed`).

## Quickstart (the contract)

This must always work, in under five minutes, on a fresh clone:

```bash
git clone <repo> && cd tieout
pnpm install
cp .env.example .env          # fill in the local passwords
docker compose up -d          # postgres + minio
pnpm db:migrate
pnpm seed                     # Mercadia dataset with planted breaks
pnpm recon                    # land → normalize → reconcile (no accounts needed)
```

The run reports **54 matches and exactly 7 breaks** — the ones planted in the seed data
(see `packages/seed/README.md`). Run `pnpm recon` again: identical matches, identical
breaks, zero duplicate rows ingested. That determinism is the product.

To run the same pipeline as durable, scheduled Trigger.dev tasks instead: create a free
project at [cloud.trigger.dev](https://cloud.trigger.dev), set `TRIGGER_PROJECT_REF` and
`TRIGGER_SECRET_KEY` in `.env`, then `pnpm dev` and trigger `recon-all` from the dashboard.

## Repo layout

```
apps/jobs           Trigger.dev tasks + recon CLI (thin: orchestrate, retry, fan out)
apps/web, apps/api  Stage 3 placeholders
packages/contracts  Zod schemas + shared types — the boundary everything imports
packages/core       Pure domain: money (bigint minor units), matching, hashing. Zero I/O.
packages/db         Drizzle schema + migrations + persistence services. Constraints are correctness features.
packages/adapters   SourceAdapter implementations (ledger, stripe) + golden-file fixtures
packages/seed       Deterministic Mercadia dataset with planted breaks
docs/               how-it-works.md · onboarding.md · decisions.md · topology.md · specs/
```

`turbo run typecheck lint test` is the definition of done; CI runs it on every PR.

## Stack

TypeScript end to end. Postgres + Drizzle for the data spine, Trigger.dev for durable orchestration, Hono (API) and Next.js (dashboard) at Stage 3, MinIO (raw file archive), Docker Compose on self-managed infrastructure. Monorepo via pnpm workspaces + Turborepo. Details and rationale: `docs/decisions.md`. Runtime layout: `docs/topology.md`.

## Status

Early development. Staged roadmap:

- **Stage 1 (current)** — first honest reconciliation: Stripe + internal ledger, 1:1 matching, breaks persisted, seed data, property-tested core. Spec: `docs/specs/stage-1.md`.
- **Stage 2** — settlement files (PSP), grouped matching (1:N fees, N:1 settlements), tolerances, quarantine workflow.
- **Stage 3** — dashboard, exceptions UI, alerts, auth, self-hosted deployment, public demo.
- **Stage 4** — k3s migration, bank + stablecoin sources, three-way payout reconciliation.

## Demo

The public demo (Stage 3) runs entirely on **synthetic data** (the Mercadia dataset, with deliberately planted breaks). One click drops you into a read-only CFO persona — no signup, no real money, ever. Data resets on a schedule so every visitor sees the same story: a nightly run, a handful of breaks, each one explained.

## License

Apache-2.0.
