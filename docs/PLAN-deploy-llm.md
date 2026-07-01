# Plan: Deploy Tieout live + earn an honest AI/LLM resume line

> Hand this file to a Claude agent working in the tieout repo
> (github.com/jorge-j1m/tieout, TypeScript). It is self-contained.
> Context: Tieout is Jorge's flagship portfolio project — an open-source
> payments-reconciliation engine. Goal: make it a **deployed, clickable proof**
> of payments-domain skill (career research says one deployed, maintained
> project beats five repos), and add one applied-LLM feature so the resume can
> truthfully claim LLM-integration experience (present in a large share of
> 2026 senior backend JDs).

## Why (do not skip)

1. The resume links to Tieout. Recruiters who click must land on something that
   runs, not a README with a "Working title" note.
2. "AI/LLM integration" may only go on the resume once a real, defensible
   feature exists. This plan creates that feature. No feature → no resume line.

## Constraints

- Honest engineering only — the demo must actually work; no faked screenshots.
- The LLM must NEVER decide reconciliation outcomes. Matching stays
  deterministic. The LLM only *triages and explains* exceptions the engine has
  already surfaced, and every suggestion is recorded in the existing immutable
  audit log (suggestion, model, timestamp) so the audit story stays intact.
  This guardrail is itself an interview talking point.
- Keep costs bounded: batch/queue triage calls, cap per-run spend, cache
  results per exception hash.

## Phase 1 — Polish the repo (~1 hour)

1. Remove the "> Working title" note from README.md.
2. README top: one-paragraph pitch (reuse the repo description), a
   quick-start (`git clone` → `npm i` / `bun i` → seed → run), and an
   architecture sketch (ingest → normalize → match → exceptions → audit log).
3. Add a `seed/` demo dataset if one doesn't exist: 3 sources (ledger CSV,
   processor CSV, bank CSV) with ~200 records engineered so the matcher
   produces ~10 interesting exceptions (missing counterpart, amount mismatch,
   duplicate, timing/settlement lag, currency rounding).
4. Ensure `npm test` (or the repo's runner) passes clean.

## Phase 2 — Deploy the demo (~2 hours)

Target: **tieout.jorgejim.com** on the remote2 server, following the existing
convention there: per-project directory under `~/docker` with its own
docker-compose and Cloudflare tunnel (jorgejim.com is already served this way —
copy that project's tunnel/compose pattern).

1. Dockerfile (multi-stage, small final image) + docker-compose.yml.
2. The deployed app: web UI (whatever Tieout already has; if none, a minimal
   read-only view) showing the seed dataset reconciled — matched sets,
   unexplained exceptions, and the audit log. Read-only demo mode: visitors
   cannot upload data or mutate state.
3. New Cloudflare tunnel route: tieout.jorgejim.com → the container.
4. Health check + restart policy. Verify from outside:
   `curl -s https://tieout.jorgejim.com/health`.
5. Add the demo URL to the repo description and README, and to the Tieout
   entries on jorgejim.com and (optionally) the resume project line.

> **As deployed:** matches the plan, with two mechanics worth recording. (a)
> This work wasn't committed/pushed when it was deployed, so the box got the
> working tree via `tar` over `ssh` rather than `git clone`; `~/docker/tieout`
> has no `.git` until Jorge commits and pushes, at which point it can switch to
> the productfinder-style `git pull` convention. (b) The Cloudflare tunnel is a
> per-project sidecar inside `deploy/docker-compose.yml` (the `cloudflared`
> service, `profile: public`) on the same compose network as `api` — not the
> shared `~/docker/cloudflared` tunnel other single-container static sites use;
> this matches `productfinder`'s pattern, the other Node monorepo on the box.
> Health check: `/healthz`, not `/health`. Item 5 (updating jorgejim.com/resume)
> is still open — Jorge's call on timing.

## Phase 3 — LLM-assisted exception triage (~1 day)

The feature: for each unexplained exception, an LLM produces a **suggested
classification + plain-English explanation + suggested next action**, shown
alongside the deterministic result and stored in the audit log as a
suggestion (never as a resolution).

> **As built:** no provider SDK. `packages/triage` speaks the OpenAI-compatible
> `/chat/completions` shape over plain fetch — `TIEOUT_TRIAGE_BASE_URL` +
> `TIEOUT_TRIAGE_API_KEY` + `TIEOUT_TRIAGE_MODEL` plug in any provider
> (Anthropic's compat endpoint is the default; OpenAI, Ollama, vLLM,
> OpenRouter all work). Output is Zod-validated JSON, not SDK structured
> outputs. The notes below are the original plan, kept for the record.

Implementation notes (verified against the Claude API docs, July 2026):

- SDK: `@anthropic-ai/sdk` (official TypeScript SDK). API key via
  `ANTHROPIC_API_KEY` env var — never committed, injected via docker-compose
  env file. The deployed demo should ship with **pre-computed** triage results
  for the seed dataset (run once at build/seed time) so the public site makes
  zero live API calls.
- Model: default `claude-opus-4-8`. Make it a config value
  (`TIEOUT_TRIAGE_MODEL`); `claude-haiku-4-5` is the cheap option if triage
  volume ever matters. Do not hardcode date-suffixed model IDs.
- Use **structured outputs** so results are typed, not parsed from prose:
  `client.messages.parse()` with `output_config: { format: zodOutputFormat(TriageSchema) }`
  (`zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`). Schema roughly:

  ```ts
  const TriageSchema = z.object({
    classification: z.enum([
      "timing_lag", "amount_mismatch", "missing_counterpart",
      "duplicate", "fx_rounding", "unknown",
    ]),
    confidence: z.enum(["high", "medium", "low"]),
    explanation: z.string(),        // 1-3 sentences, plain English
    suggested_action: z.string(),   // one concrete next step
  });
  ```

- Prompt: system prompt describes the reconciliation domain and the exception
  taxonomy; user turn carries the exception record + the near-miss candidates
  the matcher considered (that context is what makes suggestions good).
- Read `response.parsed_output`; on `stop_reason !== "end_turn"` or a parse
  failure, store `classification: "unknown"` — never block the pipeline on the
  LLM.
- Tests: unit-test the triage module with a mocked client; snapshot-test the
  audit-log entries it writes.

## Acceptance criteria

- [x] https://tieout.jorgejim.com loads the reconciled seed dataset from a cold
      visit, exceptions visible with LLM triage suggestions attached. (Deployed
      2026-07-02: 9 planted breaks reconciled, all 9 triaged — see
      `[[plan-deploy-llm-status]]`.)
- [x] Audit log shows every triage suggestion with model + timestamp
      (`triage_suggestions.model` + `createdAt`, verified via `GET
      /exceptions/:id` — both `claude-opus-4-8` and `claude-sonnet-5` passes
      are recorded side by side for the demo dataset).
- [ ] Deterministic results are byte-identical with the LLM disabled
      (`TIEOUT_TRIAGE_ENABLED=false`) — true by construction (D33: triage never
      writes to matches/breaks/exceptions), not re-verified with a diffed run
      in this session.
- [x] No API key in the image, repo, or client-visible code; public demo makes
      no live LLM calls. (`TIEOUT_TRIAGE_API_KEY` only ever passed to the
      one-off precompute container — see `deploy/README.md` — never to the
      long-running `api` service's environment.)
- [x] README documents the feature and the guardrail (suggestions, never
      resolutions).

## When done — the resume/README line this earns

Resume (Projects, Tieout entry) may then truthfully append:
"...with LLM-assisted exception triage (Claude API, structured outputs) that
suggests classifications for unexplained transactions without ever overriding
deterministic matching."

Also update: `docs/FACTS.md` (new CONFIRMED capability), jorgejim.com Tieout
entry, and the Skills line may add "LLM integration (Claude API)".
