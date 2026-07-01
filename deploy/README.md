# Deploying the demo

The app stack from topology §Stage 3: `postgres` → one-shot `migrate` gate →
`api`, with `cloudflared` (profile `public`) as the only public exposure. The
dashboard (`apps/web`) joins this stack when it exists; until then the api is
the deployed surface.

## Local smoke test

```bash
cd deploy
cp .env.example .env            # set the passwords; TUNNEL_TOKEN not needed locally
docker compose up -d --build    # builds the image from the repo root
curl -s http://127.0.0.1:3001/healthz   # → {"ok":true}
```

## On the box (per-project dir convention)

```bash
# once: copy deploy/{docker-compose.yml,.env.example} to ~/docker/tieout/, fill .env
cd ~/docker/tieout
docker compose --profile public up -d --build
curl -s https://tieout.jorgejim.com/healthz
```

The Cloudflare tunnel token (`TUNNEL_TOKEN`) comes from creating a tunnel with a
`tieout.jorgejim.com → http://api:3001` route; add rate limiting on the
Cloudflare side. Update `TIEOUT_IMAGE` in `.env` once CI publishes images to
GHCR — then deploys become `docker compose pull && docker compose up -d`.

## Seeding the demo data

The image serves; it doesn't seed. There's no Node on the box and Postgres
isn't exposed to the host — run a throwaway container on the stack's network
instead, with the repo checkout mounted in:

```bash
cd ~/docker/tieout/deploy
set -a && source .env && set +a && cd ..
docker run --rm \
  --network tieout-app_default \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:22-alpine sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm seed && pnpm recon"

# Then precompute LLM suggestions (D33) — same container shape, key passed only
# to this one-off run, never stored in deploy/.env or the long-running api service:
docker run --rm \
  --network tieout-app_default \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TIEOUT_TRIAGE_ENABLED=true \
  -e TIEOUT_TRIAGE_API_KEY=sk-ant-... \
  -e TIEOUT_TRIAGE_MODEL=claude-opus-4-8 \
  node:22-alpine sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @tieout/jobs triage"
```

`pnpm seed` / `pnpm recon` need no network access (D25 — the demo sources are
committed fixture files), so this never touches MinIO or the internet. The
public site then serves stored suggestions only — zero live LLM calls, no
`TIEOUT_TRIAGE_API_KEY` anywhere in the stack's persistent environment.
Re-running is idempotent: `recon` re-derives the same run deterministically,
and `triage` skips any break whose content hasn't changed (cached per
`input_hash`, which includes the model — switching `TIEOUT_TRIAGE_MODEL`
re-triages everything under the new model instead of reusing the cache).
