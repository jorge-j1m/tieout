# @tieout/jobs

Trigger.dev v4 tasks. Tasks stay thin — they fetch, store, and fan out; everything
they orchestrate lives in `packages/core`, `packages/db` services, or an adapter,
which is why `src/pipeline/` is shared verbatim by the tasks, the `pnpm recon` CLI,
and the integration test.

| Task              | Kind               | What it does                                                           |
| ----------------- | ------------------ | ---------------------------------------------------------------------- |
| `land-stripe`     | scheduled (hourly) | Lands a 48h overlapping window of balance transactions, fans out normalize |
| `land-ledger`     | triggerable        | Lands the internal ledger export, fans out normalize                    |
| `normalize-batch` | fan-out unit       | Normalizes one batch; idempotent per (raw, normalizerVersion)           |
| `recon-run`       | triggerable        | Snapshot watermark → match → persist run/matches/breaks → Slack summary |
| `recon-all`       | demo button        | Whole pipeline in one trigger — same code path as `pnpm recon`          |

(The spec names these `land.stripe`, `land.ledger`, `normalize.batch`, `recon.run`;
task ids use dashes.)

Idempotency: every unit of work has an explicit key — ingestion batches dedupe on
`idempotencyKey` in **our** Postgres (source + file/content hash; window-keyed for
live API sources when they arrive), normalize fan-out uses
`normalize:<source>:<normalizerVersion>:<batchId>` Trigger keys, and normalization
itself skips already-processed raw records. Every task can run twice safely.

## Running

```bash
pnpm recon   # full pipeline, no Trigger.dev account needed (root: pnpm recon)
pnpm dev     # trigger.dev dev — needs TRIGGER_PROJECT_REF + TRIGGER_SECRET_KEY in .env
```
