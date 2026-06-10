# Spec: Stage 3 — show your work

> **Status: not active.** Stage 2 (`stage-2.md`) is the active spec. This document
> exists so Stage 2 decisions are made with the destination in view.

**Goal.** A stranger opens a public URL and lands — no signup — in a read-only CFO
persona over synthetic Mercadia data: a nightly run, a handful of breaks, each one
explaining itself down to the raw payload. An authenticated operator works the same
breaks through the exceptions workflow. Deployment is `git push`: CI builds, the box
pulls, migrations gate app start. The audit chain that Stages 1–2 built becomes
something a non-engineer can *see*.

## In scope

1. **`apps/api` (Hono)** — thin domain API over the existing db services, Zod
   contracts shared via `packages/contracts`:
   - Reads: runs (list/detail/diff vs. previous), breaks (filter by type/status/run),
     transactions (with full version chain), raw drill-down (break → transaction
     versions → raw payload → batch), exceptions (worklist), quarantine.
   - Mutations: **exceptions only** (assign, comment, resolve, reopen — the Stage 2
     service functions, exposed). There is no API path that edits financial rows; the
     db's append-only constraints stay the last line of defense.
2. **`apps/web` (Next.js)** — the dashboard:
   - Overview: latest run status, matched/break counts, trend across runs, quarantine
     and pending (settlement-lag) counts.
   - Breaks worklist → **explain view**: the §8 chain rendered — this raw payload,
     translated by normalizer vX into version N, evaluated by ruleset-vY as of
     watermark W, concluded `missing_in_ledger` — every hop clickable.
   - Run detail + run-vs-run diff (what appeared, what self-resolved, what reopened).
   - Exceptions workflow UI on the Stage 2 lifecycle, with its append-only history.
3. **Auth, minimal (D21/D22)** — two roles, no signup flow:
   - **demo viewer**: the default, unauthenticated, read-only persona; mutation
     endpoints reject it server-side (tested, not just hidden buttons).
   - **operator**: session login for the exceptions workflow. Single-tenant, a
     handful of accounts; SSO/multi-tenant stay parked (D20/D21).
4. **Alerts** — beyond the existing Slack run summary: configurable threshold rules
   (run failed, new breaks > N, quarantine spike), fired from a scheduled task, with
   each delivery recorded (alerting that isn't auditable is rumor).
5. **Deployment (topology §Stage 3)** — the two-stack target: app compose project
   (`caddy`/`cloudflared` → `web` + `api`, `postgres`, `minio`, one-shot `migrate`
   service gating app start), Trigger.dev stays Cloud. CI: build → GHCR → SSH →
   `compose pull && up -d`. Public exposure only via Cloudflare Tunnel + rate
   limiting; operator surfaces stay behind Tailscale/Access (D22).
6. **Public demo (D19/D22)** — synthetic data only, scheduled reset (`pnpm seed` +
   full recon as a Trigger.dev schedule) so every visitor sees the same story; one
   click into the CFO persona.
7. **Backups, rehearsed (topology §Backups)** — nightly `pg_dump` → MinIO + restic
   offsite, and **one performed, documented restore** before the demo URL goes live.
   An untested backup doesn't count — this is an acceptance item, not a footnote.

## Out of scope (resist)

k3s and self-hosted Trigger.dev (Stage 4); bank + stablecoin sources and three-way
payout reconciliation (Stage 4); multi-tenancy and workspace ids (post-Stage 4, D20);
SSO; webhooks; any UI write-path to financial data — the dashboard observes and
explains, it never edits the books (the product's first promise).

## Acceptance

- [ ] A fresh visitor reaches the public URL, lands read-only on Mercadia data, and
      can follow one break from the worklist down to its raw payload without help.
- [ ] Every mutation endpoint rejects the demo persona — proven by API tests, not UI.
- [ ] An operator logs in, resolves an exception with a reason, and the append-only
      event history shows it; a Stage 2 re-evaluation reopens it visibly.
- [ ] Run-vs-run diff correctly classifies appeared / self-resolved / reopened breaks
      (asserted against a seeded restatement scenario).
- [ ] `git push` to main deploys: images built in CI, box pulls, migrate gate runs
      before app start; rollback is `compose pull` of the previous tag.
- [ ] Demo data resets on schedule; two visitors a day apart see the same story.
- [ ] A backup restore has been performed once on a scratch database and the runbook
      committed to `docs/`.
- [ ] Alert fires on a seeded threshold breach; the delivery is recorded.
- [ ] Quickstart still ≤5 minutes; zero-infra tests still green; the web/api apps get
      one end-to-end smoke (demo persona path) in CI.

## Suggested build order

1. `packages/contracts`: API request/response schemas (reuse domain types).
2. `apps/api`: read endpoints over existing tables → exception mutations → roles.
3. `apps/web`: overview + breaks explain view (read-only value first) → run diff →
   exceptions UI → demo persona polish.
4. Alerts task + delivery recording.
5. Deployment: app compose stack + migrate gate + Cloudflare Tunnel on the box.
6. Demo reset schedule; backups + restore rehearsal; runbook in `docs/`.
7. CI: image builds + e2e smoke; flip the demo URL public last.

## Later

(parking lot — move items into the next spec, don't implement from here)

- k3s + self-hosted Trigger.dev via Helm; resource budget per topology §Resource budget.
- Bank + stablecoin adapters; three-way payout reconciliation (ledger ↔ PSP ↔ bank).
- Multi-tenancy (`workspace_id` migration, D20); SSO for operators.
- Exceptions SLAs / assignment queues; saved break filters.

# When this stage is done

`topology.md` reflects the running two-stack reality (it already sketches the target);
`how-it-works.md` §7 gains the dashboard as the second consumer of the permanent
record; `decisions.md` gains entries for auth shape, alert recording, and the deploy
pipeline. CLAUDE.md "Current focus" moves to Stage 4.
