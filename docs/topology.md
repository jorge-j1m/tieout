# Topology

How the system runs, stage by stage. The repo deploys to a single Ubuntu box ("the box") reachable over Tailscale; development happens via Remote-SSH against it. Update this doc whenever a service, port, volume, or exposure rule changes.

## Environments

- **dev** — code runs on the box via `pnpm dev` (`trigger.dev dev` executes tasks locally against Trigger.dev Cloud's orchestration; dev runs are not billed). Postgres + MinIO from the compose file below. The read/serve tier runs on the host too: `apps/api` (Hono) on `:3001` and `apps/web` (Next.js) on `:3000`, the dashboard reading the API over `API_BASE_URL` (D34).
- **prod (Stage 3+)** — same box, containers built by CI, tasks deployed to Trigger.dev (Cloud until Stage 4).

## Compose (current, Stages 1–2)

One compose project, infrastructure only — app code runs on the host during dev.
(MinIO is provisioned for the raw-file archive; the archive *client* is deferred —
the demo's settlement files are git-committed, so the repo is already their archive.
It wires up with the first source whose files live outside the repo.)

```yaml
# docker-compose.yml
name: tieout
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-tieout}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
      POSTGRES_DB: ${POSTGRES_DB:-tieout}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?set in .env}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set in .env}
    ports:
      - "127.0.0.1:9000:9000"   # S3 API
      - "127.0.0.1:9001:9001"   # console
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  miniodata:
```

Ports bind to `127.0.0.1` deliberately: app code runs on the same host, and nothing is reachable from outside the box. Admin access from the laptop goes through the SSH/Tailscale session, not exposed ports.

## Environment variables

Committed as `.env.example`, real values in `.env` (gitignored). Current set:

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
DATABASE_URL=postgres://...@127.0.0.1:5432/tieout
TEST_DATABASE_URL=                  # optional; tests default to "<db>_test" or in-memory PGlite (D28)
MINIO_ROOT_USER / MINIO_ROOT_PASSWORD
S3_ENDPOINT=http://127.0.0.1:9000   # raw file archive (client deferred — see above)
TRIGGER_PROJECT_REF=                # from Trigger.dev Cloud project (proj_…)
TRIGGER_SECRET_KEY=                 # from Trigger.dev Cloud project
STRIPE_SECRET_KEY=sk_test_...       # TEST MODE ONLY — the adapter refuses other keys
STRIPE_LIVE_LANDING=                # =1 makes the hourly land-stripe poll the real test-mode API
SLACK_WEBHOOK_URL=                  # run summaries / failures
API_OPERATOR_TOKENS=                # named operator bearer tokens "ana:t1,leo:t2" (D32)
API_PORT=3001                       # apps/api listen port
API_BASE_URL=http://127.0.0.1:3001  # apps/web → apps/api base URL (D34)
SESSION_COOKIE_SECURE=              # =true forces the operator session cookie's Secure flag (behind https); default: on in production (D36)
TIEOUT_TRIAGE_ENABLED=              # =true turns on LLM triage (D33); off = zero LLM calls anywhere
TIEOUT_TRIAGE_API_KEY=              # triage only; never in the app-stack containers
TIEOUT_TRIAGE_BASE_URL=             # any OpenAI-compatible /v1 root; default is Anthropic's compat endpoint
TIEOUT_TRIAGE_MODEL=claude-opus-4-8 # triage model on that provider (claude-haiku-4-5 = the cheap option)
TIEOUT_TRIAGE_MAX_CALLS=25          # hard LLM-call cap per triage pass
```

## Exposure rules (all stages)

- **Public internet**: only the demo dashboard (`tieout.jorgejim.com`) and the read-mostly api (`tieout-api.jorgejim.com`, D37), only from Stage 3, only via Cloudflare Tunnel (`cloudflared` as a compose service; outbound-only, no router ports). Cloudflare rate limiting on.
- **Operator surfaces** (Trigger.dev dashboard, Drizzle Studio, MinIO console): Tailscale or Cloudflare Access. Never public.
- **SSH**: Tailscale only, key auth only.

## Stage 3 target — two compose stacks

Separate compose projects with separate networks and separate Postgres instances, so the orchestrator can be rebuilt without touching financial data:

1. **App stack** (`tieout-app`) — **built, in `deploy/docker-compose.yml`**: `postgres`; `minio`; a one-shot `migrate` service gating app start (`depends_on: condition: service_completed_successfully`); `api` (Hono, localhost-bound, Docker healthcheck on `/healthz`); `web` (Next.js standalone from `Dockerfile.web`, localhost-bound `:3000`, reads the api over the stack network via `API_BASE_URL=http://api:3001`); `cloudflared` under the `public` profile — one outbound tunnel routing `tieout.jorgejim.com → web:3000` and `tieout-api.jorgejim.com → api:3001` (D37). One image for api and migrate, built from the root `Dockerfile` (prod deps only, api+db workspace slice); runbook in `deploy/README.md`. `TIEOUT_TRIAGE_API_KEY` is deliberately absent from this stack — the demo serves precomputed triage suggestions only (D33).
2. **Trigger stack** (`trigger`): the official self-host compose — webapp, supervisor, its own Postgres/Redis/ClickHouse, registry — **only if Stage 4 is delayed**; the plan of record is to stay on Trigger.dev Cloud until k3s.

Deploys: GitHub Actions builds images → GHCR → SSH to the box → `docker compose pull && docker compose up -d` (until CI exists, `--build` on the box does the same job).

## Backups

From the moment real schema exists: nightly `pg_dump` to MinIO (cron or scheduled task) + restic copy offsite (e.g. B2). A restore has to be rehearsed once before Stage 3 ships — an untested backup doesn't count.

## Resource budget

Stage 1 fits anywhere. Stage 4 (k3s + self-hosted Trigger.dev via Helm) wants 6+ vCPU / 12+ GB for the Trigger stack alone, plus app stack and k3s overhead → 16 GB box minimum, 32 GB comfortable. Check before migrating.