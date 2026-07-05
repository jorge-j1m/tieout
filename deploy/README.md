# Deploying the demo

The app stack from topology §Stage 3: `postgres` → one-shot `migrate` gate →
`api` → `web`, with `cloudflared` (profile `public`) as the only public
exposure. The dashboard reads the api over the stack network (D34); the api
stays public separately as the curl-able surface (D37).

## Local smoke test

```bash
cd deploy
cp .env.example .env            # set the passwords; TUNNEL_TOKEN not needed locally
docker compose up -d --build    # builds api (Dockerfile) + web (Dockerfile.web) from the repo root
curl -s http://127.0.0.1:3001/healthz   # → {"ok":true}
curl -so /dev/null -w "%{http_code}" http://127.0.0.1:3000/login   # → 200
```

## On the box (per-project dir convention)

```bash
# once: git clone the repo to ~/docker/tieout, fill deploy/.env
cd ~/docker/tieout/deploy
docker compose --profile public up -d --build
curl -s https://tieout-api.jorgejim.com/healthz
curl -so /dev/null -w "%{http_code}" https://tieout.jorgejim.com
```

The Cloudflare tunnel token (`TUNNEL_TOKEN`) names the stack's tunnel; its
public hostnames are `tieout.jorgejim.com → http://web:3000` and
`tieout-api.jorgejim.com → http://api:3001` (D37 — sibling subdomains,
Universal SSL covers one level only). Add rate limiting on the Cloudflare
side. Update `TIEOUT_IMAGE`/`TIEOUT_WEB_IMAGE` in `.env` once CI publishes
images to GHCR — then deploys become `docker compose pull && docker compose up -d`.

To lend the public visitor key (D36), set both in `deploy/.env` — the hint the
login page publishes and the token the api accepts must be the same pair:

```
API_OPERATOR_TOKENS=visitor:under-the-double-rule
DEMO_LOGIN_HINT=visitor:under-the-double-rule
```

then recreate `api` and `web` (`docker compose --profile public up -d`). Keep
Cloudflare rate limiting on: that key lets anyone acknowledge/resolve the
synthetic exceptions (annotations only — no path to financial rows).

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
committed fixture files), so this never touches MinIO or the internet. With
live investigation off (the default), the public site serves stored suggestions
only — zero live LLM calls, no `TIEOUT_TRIAGE_API_KEY` anywhere in the stack's
persistent environment. Re-running is idempotent: `recon` re-derives the same
run deterministically, and `triage` skips any break whose content hasn't changed
(cached per `input_hash`, which includes the model — switching
`TIEOUT_TRIAGE_MODEL` re-triages everything under the new model instead of
reusing the cache).

## Live investigation (D38 — optional, off by default)

Turning on "Investigate with Claude" lets a signed-in operator drive a streamed,
cited conversation on a case. Unlike batch triage above, this makes **live** LLM
calls from the long-running `web` container, so — and only then — the key enters
the stack's persistent environment (the `api` never gets it). Enable it in
`deploy/.env`:

```
TIEOUT_INVESTIGATE_ENABLED=true
TIEOUT_TRIAGE_API_KEY=sk-ant-...          # the web tier reads this to stream
TIEOUT_TRIAGE_BASE_URL=https://api.anthropic.com/v1
TIEOUT_INVESTIGATE_MODEL=claude-sonnet-5  # ~$0.05–0.08/turn
TIEOUT_INVESTIGATE_DAILY_CAP=10           # assistant turns / 24h; a maxed day ≈ $0.80
```

then recreate the stack (`docker compose --profile public up -d`). Spend is
bounded four ways: only a signed-in operator can stream (rotate
`API_OPERATOR_TOKENS` to revoke the lent `visitor` key), the daily cap, a
per-turn tool-round limit, and a prepaid key with no auto-reload. Keep Cloudflare
rate limiting on. To seed the demo with a real saved thread, log in as `visitor`
after a reseed and run one investigation on a planted break — anonymous visitors
then land on a real, cited conversation (read-only, zero live calls for them).
