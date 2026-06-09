# Spec: Stage 1 — first honest reconciliation

**Goal.** On a fresh clone, ingest the internal ledger and Stripe (test mode / seed fixtures), normalize both, run a reconciliation, and persist breaks — finding exactly the planted breaks in the seed data, deterministically, twice in a row.

## In scope

1. **Workspace scaffold** — pnpm + Turborepo, all packages from the repo map (web/api as empty placeholders), strict TS config, vitest, turbo pipeline (`typecheck`, `lint`, `test`, `build`).
2. **The full spine schema, at full fidelity** (even though Stage 1 uses a fraction of it — retrofitting versioning is a rewrite):
   - `ingestion_batches` (source, connection, kind, externalRef, contentHash, controlTotals jsonb, status, observedAt)
   - `raw_records` (batchId, source, sourceAccount, sourceId, version, contentHash, payload jsonb, observedAt) — unique `(source, sourceAccount, sourceId, version)`
   - `transactions` (rawId, version, isCurrent, supersededAt, source, sourceAccount, sourceId, sourceType, type, amountMinor bigint, currency, occurredAt, valueDate, observedAt, account, reference, status, normalizerVersion, metadata jsonb) — partial unique `(source, sourceAccount, sourceId) WHERE isCurrent`; indexes on `(currency, account, occurredAt)` and `(reference)`
   - `quarantined_records`, `source_cursors`
   - `recon_runs` (asOf watermark, status, stats jsonb), `matches` (runId, rulesetVersion, kind), `match_members` (matchId, transactionId, transactionVersion), `breaks` (runId, type, details jsonb)
3. **Adapters**: `ledger` (reads seeded internal records) and `stripe` (balance transactions; runs against committed fixtures so tests never need network). Both implement `SourceAdapter`: `land() → batch`, `normalize(raw) → NormalizedTxn | Quarantine`.
4. **Matching v1** in `packages/core`: exact `reference` 1:1 first, then fallback `(amountMinor, currency, occurredAt ± window)` 1:1. Unmatched → typed breaks (`missing_in_ledger`, `missing_in_stripe`, `amount_mismatch`, `duplicate_candidate`).
5. **Tasks** in `apps/jobs`: `land.stripe` (scheduled, windowed, idempotency key = source+window), `land.ledger`, `normalize.batch`, `recon.run` (snapshot watermark → match → persist run, matches, breaks → summary). Fan-out not required yet; a single partition loop is fine if structured to fan out later.
6. **Seed** (`pnpm seed`): deterministic Mercadia subset — ledger + Stripe-shaped data, one currency (USD) is enough, with planted breaks: an unbooked Stripe fee, a refund missing from the ledger, a charge that never settled, one duplicate. The seed README lists the planted breaks so acceptance is checkable.
7. **Output**: run summary (matched count, breaks by type) to console + optional Slack webhook.
8. **Tests**: property tests in core (no transaction in two matches; matched sums preserved; determinism — same input, same result); golden-file tests per adapter; one integration test running the full pipeline against seed data.

## Out of scope (resist)

UI, auth, PagoLat/bank/stablecoin adapters, grouped (1:N) matching, FX/tolerances, settlement-lag logic, outbox/re-evaluation, exceptions workflow, self-hosting, webhooks. Note ideas here under "Later" instead of building them.

## Acceptance

- [ ] Fresh clone → README quickstart works in ≤5 minutes.
- [ ] `pnpm seed && <run recon>` finds exactly the planted breaks — no more, no fewer.
- [ ] Running recon twice produces identical results (same matches, same breaks).
- [ ] Re-running ingestion creates zero duplicate raw or transaction rows (idempotency proven by test).
- [ ] Killing a land task mid-run and retrying it converges to the same state.
- [ ] `turbo run typecheck lint test` green; CI runs it on every PR.

## Suggested build order

1. Scaffold + tooling + CI skeleton.
2. `packages/contracts`: `NormalizedTxn`, adapter interface, break types.
3. `packages/db`: schema + migrations + constraint tests.
4. `packages/core`: money utils → matching v1 → property tests.
5. `packages/seed`: dataset + planted-breaks manifest.
6. `packages/adapters`: ledger, then stripe (fixtures + golden tests).
7. `apps/jobs`: land → normalize → recon tasks wired to Trigger.dev Cloud.
8. Integration test + README quickstart verification.

## Later

(parking lot — move items into the next spec, don't implement from here)