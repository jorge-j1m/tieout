# Onboarding — from "I understand the engine" to "I can change it"

You've read [`how-it-works.md`](how-it-works.md). This document is the bridge to the
code: where every concept lives, which direction dependencies flow, how to verify a
change, and step-by-step recipes for the changes you'll actually make. It plays the
role of the conventional `ARCHITECTURE.md` (a codemap: concepts → modules → invariants)
plus the "how do I iterate" half of a `CONTRIBUTING.md`, merged because this repo is
small enough for one document.

Reading order for a new contributor: `CLAUDE.md` (the contract) →
[`how-it-works.md`](how-it-works.md) (the behavior) → this file (the map) →
[`decisions.md`](decisions.md) (the why) → the active spec in [`specs/`](specs/)
(the current scope). ~45 minutes total.

## 1. Get a working loop first

```bash
pnpm install
cp .env.example .env            # set the local passwords
docker compose up -d            # postgres + minio (127.0.0.1 only)
pnpm db:migrate
pnpm seed                       # materialize the Mercadia dataset
pnpm recon                      # full pipeline; expect 54 matches, 7 breaks
turbo run typecheck lint test   # the definition of done — must be green
```

If `pnpm recon` reports anything other than 54 matches / 7 breaks on a fresh clone,
stop and fix that before changing anything — the demo dataset is the living acceptance
test.

**The fast iteration loop** is per-package, not repo-wide:

```bash
cd packages/core && npx vitest          # watch mode while editing matching/money
cd packages/db && npx vitest           # db tests (need Postgres up — see below)
turbo run typecheck lint test          # full gate before calling anything done
```

Two sharp edges of the test setup:

- **db and jobs tests never touch your working data, and need no infrastructure.**
  With `DATABASE_URL` configured (your normal setup) they run against an isolated
  `<name>_test` database (auto-created; override with `TEST_DATABASE_URL`) on the same
  engine as production. With no `DATABASE_URL` at all — fresh clone, no docker — they
  fall back to an ephemeral in-memory PGlite (real Postgres compiled to WASM), so the
  full gate runs on a bare clone. They run sequentially (`@tieout/jobs#test` waits for
  `@tieout/db#test` in `turbo.json`) because the postgres mode shares one test
  database — don't "fix" the slowness by parallelizing them.
- **There is no way to skip the db suites** — they always run, on one engine or the
  other, so local green means what CI green means. CI runs both paths: real Postgres 17
  for engine fidelity, and a zero-infra PGlite job protecting the fresh-clone
  experience. One PGlite guardrail (D28): never query bigint columns through Drizzle's
  relational API (`db.query…with`) — use `db.select()`, as all existing code does.

## 2. The codemap: concept → code

The dependency direction is law (enforced by `package.json` dependencies — a violation
won't typecheck):

```
contracts  ◄──  core  ◄──  db, adapters, seed  ◄──  jobs
(shapes)      (pure       (I/O at the edges)      (orchestration:
               logic,                              tasks, CLI,
               zero I/O)                           integration test)
```

Lower layers never import higher ones. `core` imports nothing but `contracts` and does
**no I/O — no database, no fetch, no env, no clock reads** (time always arrives as a
parameter). That purity is what makes its property tests trustworthy; don't erode it.

| Concept (how-it-works §) | Code | Tests that guard it |
|---|---|---|
| Canonical transaction, enums, adapter interface | `packages/contracts/src/{txn,canonical,adapter,recon}.ts` | consumers' tests; `normalizedTxnSchema.parse` runs inside every adapter |
| Rule 1: money as bigint minor units (§3) | `packages/core/src/money.ts` (`CURRENCY_EXPONENTS`, `parseDecimalToMinor`, `minorToDecimalString`) | `money.test.ts` round-trip properties |
| Content hashes, synthetic ids (§4, Rule 4) | `packages/core/src/hash.ts` (`contentHash`, `syntheticSourceId`) | `hash.test.ts` |
| Matching ruleset v1, all four passes (§6) | `packages/core/src/matching.ts` (`reconcile`, `RULESET_VERSION`) | `matching.test.ts` — unit cases per pass + partition/determinism properties |
| The spine schema and its constraints (§5.3) | `packages/db/src/schema.ts`; migrations in `packages/db/drizzle/` | `db/src/test/schema.test.ts` proves each constraint rejects |
| Landing: batches, raw versioning, idempotency (§4) | `packages/db/src/services/ingest.ts` (`landBatch`) | `db/src/test/services.test.ts` (re-land, crash-retry, restatement) |
| Normalization persistence: versions, supersession, quarantine rows (§5) | `packages/db/src/services/normalize.ts` (`normalizeBatch`) | same file |
| Recon persistence: watermark, as-of selection, runs, matches, breaks (§6, §8) | `packages/db/src/services/recon.ts` (`currentWatermark`, `loadTransactionsAsOf`, `persistReconRun`) | integration test, incl. restate-and-re-execute |
| Cursors (§4) | `packages/db/src/services/cursors.ts` | services test ("cursors only move forward") |
| Ledger dialect: schema, type/status maps, quarantine (§5) | `packages/adapters/src/ledger/adapter.ts` | golden files in `packages/adapters/fixtures/ledger/` |
| Stripe dialect (§5) | `packages/adapters/src/stripe/adapter.ts` | golden files in `fixtures/stripe/` |
| Golden-test harness | `packages/adapters/src/test/golden.ts` | — |
| Mercadia dataset + planted breaks (§ demo) | `packages/seed/src/generate.ts`; committed output in `packages/seed/data/`; manifest contract in `data/manifest.json` | `seed/src/generate.test.ts` (determinism + committed-files freshness) |
| Pipeline: land → normalize → recon glue (§9) | `apps/jobs/src/pipeline/pipeline.ts` (also `DEFAULT_MATCH_WINDOW_MS`) | the integration test drives exactly this |
| Trigger.dev tasks (§9) | `apps/jobs/src/trigger/*.ts` (thin wrappers — keep them thin) | — |
| `pnpm recon` CLI | `apps/jobs/src/cli/recon.ts` | — |
| Stage 1 acceptance, end to end | `apps/jobs/src/test/integration.test.ts` | itself |

Rule of thumb for *where new logic goes*: if it's a decision (matching, money,
classification) → `core`. If it's a source dialect → that adapter. If it's "write/read
the spine correctly" → a `db` service. If it's sequencing/retry/fan-out → `jobs`. If
two of those layers need the same type → `contracts`.

## 3. Change recipes

Each recipe lists the files to touch, what to bump, how to verify, and the trap that
will otherwise bite you.

### 3.1 Change how a source is normalized (mapping, field, fix a bug)

1. Edit the adapter (`packages/adapters/src/<source>/adapter.ts`) — schema, type/status
   map, or field derivation.
2. **Bump `<SOURCE>_NORMALIZER_VERSION`** (e.g. `stripe-v1` → `stripe-v2`). This is not
   optional: it's how already-normalized rows get re-processed (Rule 3). Without the
   bump, existing transactions are considered done and your change silently applies
   only to future data.
3. Regenerate goldens and **review the diff like code**:
   `UPDATE_GOLDEN=1 pnpm --filter @tieout/adapters test`, then `git diff fixtures/`.
4. Add a fixture case if your change has a new edge (one good case in `entries.json` /
   `balance-transactions.json`, one drift case in `drift.json`).
5. Verify: `turbo run typecheck lint test`, then `pnpm recon` — re-normalization will
   create version n+1 transactions superseding the old ones; the integration test's
   "everything is v1" assertion only holds on a truncated database, which the test does
   itself.

### 3.2 Change the matching rules

1. Edit `packages/core/src/matching.ts`. **Bump `RULESET_VERSION`** — runs record it,
   and an auditor must be able to tell which rulebook produced which result.
2. Keep the partition invariant: every input transaction ends in exactly one match or
   one break. The property tests in `matching.test.ts` will fail you if you don't —
   that's them working; don't weaken them, satisfy them.
3. Keep determinism: no clock, no randomness, no iteration over unordered structures
   that reaches the output. The shuffle-property test enforces this.
4. If behavior changes on the demo data, the expected counts live in one place:
   the `expected` block the generator computes into `packages/seed/data/manifest.json`
   (the integration test asserts against it, never against literals). Update the
   generator, re-run `pnpm seed`, then fix the numbers quoted in `how-it-works.md` §7,
   `packages/seed/README.md`, and §1 of this file — the seed package's doc-consistency
   test fails until docs and manifest agree.
5. New tolerance/window knobs go on `MatchingConfig` (core) with the default in
   `apps/jobs/src/pipeline/pipeline.ts`, and get recorded in run `stats` so runs stay
   self-describing.

### 3.3 Change the database schema

1. Edit `packages/db/src/schema.ts`. If you're adding a status/type/kind value, the
   enum constant lives in `packages/contracts/src/canonical.ts` — change it there;
   the schema imports it.
2. `pnpm db:generate` → a new SQL file appears in `packages/db/drizzle/`. **Read it.**
   Commit it with the schema change; never hand-edit an already-committed migration.
3. `pnpm db:migrate`, then `turbo run test`.
4. If the new column/constraint encodes an invariant, add a rejection test to
   `schema.test.ts` — constraints without tests rot.
5. Trap: never write a migration that UPDATEs or DELETEs rows in `raw_records` /
   `transactions` (Rule 2). Backfills happen by re-normalizing from raw, not by SQL
   surgery on financial rows.

### 3.4 Add a new source adapter (the Stage 2 workhorse)

1. Create `packages/adapters/src/<source>/adapter.ts` implementing `SourceAdapter`
   from contracts: `land()` (may do I/O) + `normalize()` (pure, deterministic, no
   clock). Copy the ledger adapter's shape — defensive identity extraction at landing,
   full Zod validation + data-driven maps at normalize, `normalizedTxnSchema.parse` on
   the way out.
2. Choose the idempotency key for a unit of work: file hash for files,
   `source:account:window` for APIs (D25).
3. Id-less lines (bank CSVs): `syntheticSourceId(fileIdentity, lineContent,
   occurrenceIndex)` — the occurrence index is what keeps legitimate duplicate lines
   apart.
4. Fixtures: `fixtures/<source>/` with good + drift files; golden tests via
   `expectGolden` (see either existing adapter test — they're ~40 lines).
5. Register it in `apps/jobs/src/pipeline/adapters.ts`, add a `land-<source>` task,
   extend the seed generator if the demo should include it (recipe 3.6).
6. Export it from `packages/adapters/src/index.ts`.

### 3.5 Add a currency / a break type / a canonical type

- **Currency**: add to `CURRENCY_EXPONENTS` in `packages/core/src/money.ts` with its
  exponent. The round-trip property tests pick it up automatically. Mention it in
  `how-it-works.md`'s FAQ list.
- **Break type / canonical type / status / match kind**: add to the constant in
  `packages/contracts/src/canonical.ts` → `pnpm db:generate` (the Postgres enums are
  built from those constants) → migrate → produce it somewhere in `core` → cover it in
  a matching unit test and in the break-types table of `how-it-works.md`.

### 3.6 Change the seed dataset

1. Edit `packages/seed/src/generate.ts`. Stay deterministic: derive everything from
   the order index — no `Date.now()`, no randomness. Bulk amounts stay unique
   (`4900 + i·137`) so the easy volume is unambiguous; the adversarial cluster
   collides amounts *on purpose* — extend it (with new amounts outside the bulk
   residue class) rather than diluting it.
2. `pnpm seed` to rewrite `packages/seed/data/` — commit generator **and** data
   together; the freshness test fails the build if they drift.
3. If you changed the planted breaks or the totals: the generator computes all of
   `manifest.json` (planted breaks + the `expected` totals) — update
   `packages/seed/README.md`'s table and the numbers quoted in `how-it-works.md` §7
   and §1 of this file; the doc-consistency test enumerates every spot that must agree.

### 3.7 Add or change a Trigger.dev task

1. Tasks live in `apps/jobs/src/trigger/`, one file each, and must stay thin: parse
   payload → open db client → call pipeline/service functions → `sql.end()` in
   `finally`. If you're writing logic in a task, it belongs a layer down.
2. Fan out with `batchTrigger`/`batchTriggerAndWait` + per-item idempotency keys —
   never `trigger()` in a loop. Pass ids between tasks, never payload blobs; the
   database is the shared memory.
3. Anything the product must remember goes in our Postgres, never in Trigger.dev logs
   (1-day retention on the free tier).

### 3.8 Fix a bug in already-ingested data

You almost never touch stored rows. Decision tree:

- Source sent wrong data → it will (or should) restate; landing creates version n+1
  automatically. Nothing to code.
- *We* normalized it wrong → recipe 3.1 (bump normalizer version, re-run).
- We matched it wrong → recipe 3.2 (bump ruleset, re-run recon; old runs stay as the
  record of what v1 concluded).
- The raw payload itself is wrong in our store → that can only mean a landing bug;
  fix `land()`, re-land (new content hash → new versions). Still no UPDATE.

## 4. How you know you're done

1. `turbo run typecheck lint test` green. With docker up, the db suites run on real
   Postgres 17 (same engine as CI); without it they run on in-memory PGlite — either
   way they run, never skip.
2. `pnpm recon` twice → identical summaries, and the expected breaks (7, unless you
   changed the dataset on purpose).
3. Behavior changes carry a test at the right layer: property test in `core`, golden
   file in `adapters`, rejection test for new constraints in `db`, count/shape update
   in the integration test.
4. Versions bumped where behavior changed: `normalizerVersion` (adapter) or
   `RULESET_VERSION` (matching).
5. Docs in the same change: a new decision → numbered entry in `decisions.md`; changed
   behavior → the matching section of `how-it-works.md`; changed commands/services →
   `topology.md` / `README.md`. If docs and code disagree, code wins and the doc is the
   bug — fix it in the same commit.
6. CI (`.github/workflows/ci.yml`) runs the same gate against Postgres 17, a second
   zero-infra test job on PGlite, and gitleaks; if it's green locally with docker up,
   it's green there.

## 5. The guardrails will catch you — let them

A deliberate feature of this codebase: most invariant violations are *mechanically*
rejected, so iterate boldly and read failures as information.

| If you… | This stops you |
|---|---|
| put a float anywhere near money | `parseDecimalToMinor` throws; bigint types don't mix with `number`; property tests round-trip every currency |
| create two "current" versions of one identity | partial unique index `transactions_current_identity_uq` |
| normalize the same raw twice with one normalizer version | unique `transactions_raw_normalizer_uq` |
| put one transaction in two matches in a run | unique `match_members_run_txn_uq` |
| make matching order-dependent or non-deterministic | the shuffle property test |
| let a transaction vanish from the match/break partition | the partition property test |
| change adapter output without noticing the blast radius | golden-file diffs |
| edit the seed generator but not the committed data (or vice versa) | the freshness test |
| quote demo numbers in a doc that drift from the dataset | the seed doc-consistency test |
| break the quickstart | the integration test is the quickstart |

If a guardrail blocks something you believe is correct, that's a design conversation —
re-read the relevant decision in [`decisions.md`](decisions.md) first, and if the
decision itself must change, edit the entry in place, date the change, and say why.
