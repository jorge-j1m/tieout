# Spec: Stage 2 — settlement reality

> **Status: not active.** Stage 1 (`stage-1.md`) is the active spec. This document is
> the plan of record for what comes next, collected from the promises already made in
> `decisions.md`, `how-it-works.md`, and the Stage 1 parking lot.

**Goal.** Reconcile the messy middle of real payment operations: PSP settlement files
(restated, control-totaled, locale-formatted, id-less), grouped money movements (one
payout vs. many charges minus fees), cross-currency matching with recorded rates and
explicit tolerances, settlement lag that suppresses false breaks, and an exceptions
lifecycle — while every Stage 1 guarantee (determinism, re-executability, append-only
trail) holds for the richer ruleset.

## In scope

1. **PagoLat settlement-file adapter** — the invented LatAm PSP, as a *file* source:
   day-files of MXN settlement lines with locale decimals (`1.234,56`), header/footer
   control totals (opening + sum(lines) = closing), renamable headers, **no line ids**
   (→ `syntheticSourceId`, occurrence index preserves legitimate duplicate lines).
   Fixture-driven like Stripe; raw files archived to MinIO (D9 finally exercised).
2. **Batch integrity (D13)** — control totals verified at landing; a failing file
   quarantines as a *whole batch* (batch-level quarantine, not row-level); a
   failure-rate circuit breaker halts a batch mid-normalization (D14).
3. **Tombstones (D8, finally real)** — re-landing a unit whose previous version
   contained identities now absent writes a tombstone raw version; normalization turns
   it into a transaction version marking the disappearance. Old watermarks still
   re-execute identically (D27 extends to tombstones, by test).
4. **Live Stripe client** — replaces only the read inside `land()` (D25), behind an
   env flag; fixtures stay the default for tests and the demo. The hourly schedule
   returns with it (window-keyed idempotency keys, 48h lookback already built).
5. **Matching v2 (`ruleset-v2`)** in `packages/core`, all of it pure and property-tested:
   - **Grouped matching**: 1:N / N:1 — one Stripe payout vs. its charges minus fees;
     one ledger batch entry vs. N settlement lines. `match_members` already supports
     N members per match (D17 anticipated this); groups record their grouping key in
     match details. New invariant: group sums preserved (within recorded tolerance).
   - **Tolerances** as explicit, recorded rules (never silent fuzziness): per-rule
     config on `MatchingConfig`, applied tolerance recorded on the match, defaults
     recorded in run `stats` so runs stay self-describing.
   - **FX at match time (D7)**: cross-currency candidates convert with an explicitly
     recorded rate (value, source, timestamp — persisted, e.g. an `fx_rates` table);
     inside tolerance → match carrying the rate; outside → `fx_drift` break (D18).
   - **Settlement lag (D12)**: per-source lag expectations; an unmatched record inside
     its source's window is reported **pending**, not a break, with the suppression
     counted in run stats; past the window it becomes the usual `missing_*` break.
     Time stays a parameter — the lag evaluation clock is the run's `asOf`.
   - **Double-post relabeling** (from the Stage 1 parking lot): reference-less
     same-amount/account/tight-time double-posts on one side become
     `duplicate_candidate` instead of one fallback match + one `missing_in_stripe`.
     Flip the pinned core test and seed break #7 (`LED-2026-CLE2`) deliberately.
   - New break types from D18 as they become reachable: `unexpected_fee`, `fx_drift`.
6. **Outbox + re-evaluation (D17)** — an `outbox` table written in the same
   transaction as supersession (no dual writes, the outbox is the only event
   mechanism); a dispatcher task consumes it and triggers scoped re-evaluation.
   Re-evaluation creates **new** run records — past runs are never mutated, so D27
   re-execution stays intact. A reopened conclusion may reopen its exception.
7. **Exceptions, headless (D18)** — `exceptions` + append-only `exception_events`
   tables: a break flows into an exception (open → acknowledged → resolved, with
   reasons; reopened by re-evaluation). Service functions + tests only; the UI is
   Stage 3. Resolving never touches financial rows — it records a human's judgment.
8. **Seed: Mercadia grows a settlement story** — PagoLat MXN day-files + Stripe
   payouts, with planted scenarios: a clean grouped payout, a payout with an
   unexpected fee, a restated file with a removed line (→ tombstone), a control-total
   failure (→ batch quarantine), an in-lag pending that self-resolves, an out-of-lag
   break, and an FX-drift pair. The manifest's `expected` block remains the single
   source of truth; the doc-consistency test keeps every quoted number honest.

## Out of scope (resist)

UI, auth, the API app (all Stage 3); bank + stablecoin adapters and three-way payout
reconciliation (Stage 4); k8s/self-hosted Trigger.dev (Stage 4); webhooks (later, and
as hints only — poll is truth); multi-tenancy. Note ideas under "Later".

## Acceptance

- [ ] A Stripe payout groups its charges minus fees into one match; group sums proven
      preserved by property test.
- [ ] A PagoLat day-file lands, normalizes (locale decimals parsed straight to bigint),
      and its lines match ledger entries N:1; a file failing its control totals
      quarantines as a batch.
- [ ] A restated file with a removed line produces a tombstone version; the next run
      reflects the disappearance; re-executing the pre-restatement watermark is
      byte-identical (extends the D27 integration test).
- [ ] An unmatched transaction inside its source's lag window reports as pending, not
      a break; a run after the window flips it to a break — both from the same data,
      different `asOf`.
- [ ] A cross-currency match records its rate (value/source/timestamp); pushing the
      pair outside tolerance yields `fx_drift` instead.
- [ ] Superseding a matched transaction emits exactly one outbox event (same
      transaction as the supersession) and re-evaluation reopens the conclusion as a
      new run; the original run still re-executes identically.
- [ ] Break → exception → resolve → restatement → reopened, entirely through service
      functions, with an append-only event trail.
- [ ] `LED-2026-CLE2` now surfaces as `duplicate_candidate` (test flipped on purpose,
      manifest + docs updated in the same change).
- [ ] All Stage 1 invariants still hold under `ruleset-v2`: partition, determinism
      (shuffle), idempotent tasks, quickstart ≤5 minutes, zero-infra tests green.

## Suggested build order

1. `packages/contracts`: new break types, grouped match shapes, tolerance/lag/FX config.
2. `packages/db`: `exceptions`, `exception_events`, `outbox`, `fx_rates` (+ constraint
   tests); tombstone semantics in landing/normalize services.
3. `packages/core`: ruleset-v2 — grouped pass, tolerances, FX, lag, double-post
   relabel — property tests first (group-sum, partition, determinism over the new pools).
4. `packages/adapters`: PagoLat (fixtures: clean file, drifted file, restated file,
   control-total failure) + MinIO archival; live Stripe `land()` behind the flag.
5. `packages/seed`: settlement story + manifest expectations + doc updates (the
   doc-consistency test enumerates the spots).
6. `apps/jobs`: outbox dispatcher, re-evaluation task, returning hourly schedule.
7. Integration tests: the acceptance list above, end to end, on both test-database modes.

## Later

(parking lot — move items into the next spec, don't implement from here)

- Webhooks as freshness hints (poll remains truth, D21).
- Per-source data-quality scorecards (quarantine rates, restatement frequency).

# When this stage is done

`docs/decisions.md` gains numbered entries for: grouped-match recording, tolerance
recording, FX-rate persistence, lag semantics, outbox shape, exception lifecycle.
`how-it-works.md` §6/§11/§12 rewrite to describe ruleset-v2 behavior (several FAQ
answers flip from "Stage 2" to "yes"). CLAUDE.md "Current focus" moves to Stage 3.
