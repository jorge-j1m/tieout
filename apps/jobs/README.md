# @tieout/jobs

Trigger.dev v4 tasks. Tasks stay thin — they fetch, store, and fan out; everything
they orchestrate lives in `packages/core`, `packages/db` services, or an adapter,
which is why `src/pipeline/` is shared verbatim by the tasks, the `pnpm recon` CLI,
and the integration test.

| Task              | Kind               | What it does                                                           |
| ----------------- | ------------------ | ---------------------------------------------------------------------- |
| `land-stripe`     | scheduled (hourly) | Polls the live test-mode API when `STRIPE_LIVE_LANDING=1` (48h overlapping window), explicit no-op otherwise |
| `land-ledger`     | triggerable        | Lands the internal ledger export, fans out normalize                    |
| `land-pagolat`    | triggerable        | Lands settlement day-files; whole-unit control-total failures quarantine and skip normalize |
| `normalize-batch` | fan-out unit       | Normalizes one batch; idempotent per (raw, normalizerVersion)           |
| `dispatch-outbox` | triggerable        | Triggers a re-evaluating recon run when supersession/tombstone events are waiting |
| `recon-run`       | triggerable        | Snapshot watermark → match → persist run/matches/breaks → sync exceptions → sweep outbox → Slack summary |
| `recon-all`       | demo button        | Whole pipeline in one trigger — same code path as `pnpm recon`          |

Idempotency: every unit of work has an explicit key — ingestion batches dedupe on
`idempotencyKey` in **our** Postgres (unit + content hash for files; window-keyed
for the live API), normalize fan-out uses
`normalize:<source>:<normalizerVersion>:<batchId>` Trigger keys, and normalization
itself skips already-processed raw records. Every task can run twice safely.

## Running

```bash
pnpm recon   # full pipeline, no Trigger.dev account needed (root: pnpm recon)
pnpm dev     # trigger.dev dev — needs TRIGGER_PROJECT_REF + TRIGGER_SECRET_KEY in .env
```
