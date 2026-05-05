# Tieout

**Open-source payments reconciliation engine.** Tieout ingests money records from every system they live in — your ledger, payment processors, banks, stablecoin rails — normalizes them into one model, matches them against each other, and surfaces the transactions it can't explain. Every run and every decision is recorded immutably, so "why was this flagged in March?" is a query, not an apology.

> Working title. Rename is a find-and-replace away.

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

Engineering and finance-ops teams at companies that move money across more than one rail — marketplaces, fintechs, multi-PSP e-commerce, crypto platforms. The canonical user is the ops engineer reconciling five systems in Google Sheets and dreading every close. The reference customer persona ("Mercadia", a cross-border LatAm marketplace) is documented in `docs/specs/` and drives the demo dataset.

## Demo

The public demo runs entirely on **synthetic data** (the Mercadia dataset, with deliberately planted breaks). One click drops you into a read-only CFO persona — no signup, no real money, ever. Data resets on a schedule so every visitor sees the same story: a nightly run, a handful of breaks, each one explained.

## Stack

TypeScript end to end. Postgres + Drizzle for the data spine, Trigger.dev for durable orchestration, Hono (API), Next.js (dashboard), MinIO (raw file archive), Docker Compose on self-managed infrastructure. Monorepo via pnpm workspaces + Turborepo. Details and rationale: `docs/decisions.md`. Runtime layout: `docs/topology.md`.

## Status

Early development. Staged roadmap:

- **Stage 1 (current)** — first honest reconciliation: Stripe + internal ledger, 1:1 matching, breaks persisted, seed data, property-tested core. Spec: `docs/specs/stage-1-mvp.md`.
- **Stage 2** — settlement files (PSP), grouped matching (1:N fees, N:1 settlements), tolerances, quarantine workflow.
- **Stage 3** — dashboard, exceptions UI, alerts, auth, self-hosted deployment, public demo.
- **Stage 4** — k3s migration, bank + stablecoin sources, three-way payout reconciliation.

## Quickstart (the contract)

This must always work, in under five minutes, on a fresh clone:

```bash
git clone <repo> && cd tieout
pnpm install
docker compose up -d          # postgres + minio
pnpm db:migrate
pnpm seed                     # Mercadia dataset with planted breaks
pnpm dev                      # runs tasks locally via trigger.dev dev
```

A reconciliation run over the seed data should find exactly the planted breaks — run it twice, get identical results.

## License

Apache-2.0.


# Turborepo starter

This Turborepo starter is maintained by the Turborepo core team.

## Using this example

Run the following command:

```sh
npx create-turbo@latest
```

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `docs`: a [Next.js](https://nextjs.org/) app
- `web`: another [Next.js](https://nextjs.org/) app
- `@repo/ui`: a stub React component library shared by both `web` and `docs` applications
- `@repo/eslint-config`: `eslint` configurations (includes `eslint-config-next` and `eslint-config-prettier`)
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

### Build

To build all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo build
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo build
pnpm dlx turbo build
pnpm exec turbo build
```

You can build a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo build --filter=docs
```

Without global `turbo`:

```sh
npx turbo build --filter=docs
pnpm exec turbo build --filter=docs
pnpm exec turbo build --filter=docs
```

### Develop

To develop all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo dev
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo dev
pnpm exec turbo dev
pnpm exec turbo dev
```

You can develop a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo dev --filter=web
```

Without global `turbo`:

```sh
npx turbo dev --filter=web
pnpm exec turbo dev --filter=web
pnpm exec turbo dev --filter=web
```

### Remote Caching

> [!TIP]
> Vercel Remote Cache is free for all plans. Get started today at [vercel.com](https://vercel.com/signup?utm_source=remote-cache-sdk&utm_campaign=free_remote_cache).

Turborepo can use a technique known as [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup?utm_source=turborepo-examples), then enter the following commands:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo login
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo login
pnpm exec turbo login
pnpm exec turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo link
```

Without global `turbo`:

```sh
npx turbo link
pnpm exec turbo link
pnpm exec turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration Options](https://turborepo.dev/docs/reference/configuration)
- [CLI Usage](https://turborepo.dev/docs/reference/command-line-reference)
