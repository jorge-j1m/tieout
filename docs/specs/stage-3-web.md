# Spec: Stage 3 — `apps/web`, the dashboard

> **Status: DONE.** All build phases (0–5) shipped; `turbo run typecheck lint test`
> green and a Playwright e2e smoke walks the demo path over the real stack. Decisions
> D34–D36 are recorded and the docs pass is complete. Kept as the record of how the
> dashboard was built.
>
> **As built — deviations from the first plan, code being reality:** the sources
> endpoint is global `GET /sources` (sources aren't run-scoped), not `/runs/:id/sources`;
> the run's config was already inside `stats`, so Run Detail reads it there rather than
> via a separate query; `GET /runs/:id/matches` joins each member to its transaction
> version (so the Matches tab names both sides with no N+1), `/exceptions` gained
> worklist enrichment (subject amount/id, last actor, `reopened`), and `/quarantine`
> joins the offending file's `externalRef`. Per review feedback the brittle
> class-assertion RTL tests were dropped in favour of pure-logic tests (money, presenter,
> overview, quarantine, the mutation actions) plus typecheck, live render, and the e2e
> smoke; `EvidenceSpine` and `TriageMargin` render tests were kept.

**Goal.** Turn the permanent record into something a stranger can *see*. A demo
visitor lands read-only on Mercadia, follows one break from the worklist down to
its raw payload, and leaves understanding that every number here can prove where
it came from. An operator logs in and works the same cases (acknowledge, resolve)
— never editing the books. The aesthetic is *editorial ledger*: warm paper,
hairline rules, monospace money, three state colors, the double-rule motif. Light
only. The UI brief (`aa93be58…`, "Tieout UI brief") is the visual source of truth;
where it and the record disagree on a number, the record wins.

## Locked decisions

- **Data source: API-backed.** Server Components read `apps/api` over `fetch`;
  there is no second dataset. The UI cannot show a number it can't fetch from the
  record — that constraint *is* the product. (New: D34.)
- **Styling: Tailwind v4**, CSS-first `@theme`. The editorial tokens (paper, ink,
  hairline, oxblood/green/amber, Plex fonts, small-caps labels) live once as theme
  variables; bespoke motifs (the double rule, the provenance spine) are small
  `@utility`/component classes, not repeated utility strings. (New: D35.)
- **Sessions: httpOnly cookie relaying the operator bearer token.** `/login`
  validates a name+token against the API's new `GET /me`; on success the token is
  stored in an httpOnly, `secure`, `sameSite=lax` cookie. Mutations forward it as
  `Authorization: Bearer …`. The web holds no token list and rolls no crypto; the
  API stays the single authority on validity and the single guard on writes. (New: D36.)

## In scope

### A. `apps/api` — additive read endpoints (no financial write path)

All over existing tables/services; money stays a string (D5). Reuse the Zod
response schemas added to `packages/contracts` (below).

- `GET /me` — `{ operator: string | null }` from the `Authorization` header. Powers
  login validation and the persona chip.
- `GET /breaks/:id` — one break with full `details` (the explain view is entered by
  break id; today only `/runs/:id/breaks` lists them).
- `GET /runs/:id/matches` — matches with `kind` + members + `details` (the Run
  Detail "Matches" tab; grouped matches expand to member lines).
- `GET /runs/:id/sources` — per-source record counts, last-landed time, quarantined
  units, derived from `ingestion_batches`/`raw_records` (Overview sources strip and
  Run Detail landing table).
- Extend `GET /runs/:id` to include the run's recorded configuration — tolerances
  (from `stats`) and the FX rates it applied (`fx_rates` for the run's `asOf` day) —
  so "the rate is the suspect" is provable, not asserted.
- Add a computed `seenInRuns` (count of distinct runs among an exception's events)
  to the `/exceptions` and `/exceptions/:id` responses.

Every new handler is read-only and returns serialized rows; the append-only
constraints stay the last line of defense. Every mutation endpoint continues to
reject the demo persona — asserted by API tests, not UI (stage-3 acceptance).

### B. `packages/contracts` — response schemas

Today `api.ts` pins only request schemas ("responses are serialized rows … their
schemas arrive with the web client"). Add the response schemas now, in the package
everything imports, so api and web share one boundary:

- Row schemas for run, break, transaction (+ version chain), raw (+ batch), match
  (+ members), exception (+ events, + triage), quarantine, source-summary, `me`.
- Money fields are `z.string()` (bigint minor units serialized, D5) parsed only by
  the display layer — never coerced to `number`.
- Timestamps are ISO strings, always rendered UTC-explicit.

### C. `apps/web` — the dashboard

Next.js App Router, React Server Components by default, TypeScript strict. Joins
the Turborepo pipeline (`dev`/`build`/`typecheck`/`lint`/`test`). IBM Plex Sans +
Mono self-hosted via `next/font` (build-time; no runtime third-party request on a
public site). Light only.

**Data layer.** A server-only typed client (`lib/api/*`): one function per
endpoint, `fetch` against `API_BASE_URL`, responses parsed with the contracts
schemas. A pure `formatMoney(minor, currency)` renders exact, right-aligned,
tabular figures with correct exponents (USD 2, MXN 2, JPY 0, USDC 6); no float ever
touches money. `UtcTime` renders *occurred* vs *observed* explicitly.

**Evidence-chain presenter (`lib/explain`, pure + unit-tested).** Assembles the
hero spine from `break.details` + the transaction version chain + raw payload +
batch, and *derives* the "what matching tried" prose deterministically from the
structured verdict (type + `details`: `txns`, `reference`, `deltaMinor`/
`toleranceMinor`, `feeNetMinor`, `groupKey`, FX rate). The prose is generated from
facts, not stored — the honest form of the mock's hand-written narrative. Four
type variants: `missing_in_ledger`, `amount_mismatch` (side-by-side + tolerance),
`fx_drift` (grouped lines, recorded vs booked rate, drift in bps), `duplicate_candidate`
(kept beside consumed).

**Component system (one coherent set).** Primitives: `Money`, `Mono`, `StateChip`
(label + color, never color alone), `SectionLabel` (letterspaced small caps),
`DoubleRule`, `CopyButton`, `UtcTime`. Composites: `CounterBlock`, `TypedList`,
`TrendStrip`, `SourcesStrip`, `EvidenceSpine`/`EvidenceHop`, `PayloadViewer`,
`VersionChain`, `EventTimeline`, `TriageMargin` ("Suggested by Claude · never
blocks, never edits"), `RunDiffSections`, `BreaksTable`, `ExceptionsTable`,
`QuarantinePanel`. Chrome: `TopBar` (double-rule wordmark, nav, ⌘K, persona chip),
`RunContextLine`, `Footer` (the promise), `CommandSearch`, `FirstVisitBanner`.
States: skeletons as faint hairline rules; empty states in domain voice
("Everything tied out." over a double rule); honest error states.

**Routes.** `/` Overview · `/runs` + `/runs/[id]` (matches/breaks/diff) · `/breaks`
+ `/breaks/[id]` (hero) · `/exceptions` + `/exceptions/[id]` · `/quarantine` ·
`/login`. A root layout carries chrome + footer and the run-context line on data
views. Filters and tabs are URL search params (shareable, server-rendered).

**Personas & mutations.** Demo viewer is default, no auth, every mutation button
visible-but-disabled with the "enforced server-side" tooltip. Operator mutations
(acknowledge, resolve — resolve requires a reason) are Server Actions that forward
the session token to the API. The disabled buttons are courtesy; the API is the
guard.

## Out of scope (resist)

Marketing/landing page; signup, password reset, OAuth; settings screens; dark mode;
any edit path to financial data (no inline edits, "fix" buttons, or deletes);
decorative charts; AI chat; live tickers; gamification. Deployment/CI, demo reset
schedule, backups, and alerts stay in `stage-3.md` — this spec is the web app and
the reads it needs.

## Testing & definition of done

`turbo run typecheck lint test` green; behavior changes carry tests.

- `packages/contracts`: response-schema round-trip tests.
- `apps/api`: tests for each new endpoint, including demo-persona rejection where a
  guard applies, and the `/me` persona resolution.
- `apps/web`: unit tests for `formatMoney` (every exponent, negatives, thousands)
  and the explain presenter (one per break-type variant, from seed-shaped fixtures);
  React Testing Library tests for `StateChip`, `Money`, `EvidenceSpine`,
  `TriageMargin`; one Playwright **e2e smoke of the visitor's walk** (Overview →
  the $66.81 break → its raw payload), the demo-persona path stage-3 requires in CI.
- Quickstart stays ≤5 minutes on a fresh clone.

## Build phases (iterative; each ends green and is independently reviewable)

0. **Scaffold + boundary.** `apps/web` (Next + Tailwind v4 tokens + fonts + root
   layout/chrome + typed API client). `packages/contracts` response schemas.
   `apps/api` read extensions (`/me`, `/breaks/:id`, `/runs/:id/matches`,
   `/runs/:id/sources`, run config, `seenInRuns`).
1. **Value first: Overview + Breaks worklist + Break-explain hero** (all four
   variants; the demo's climax). Verify the seed produces the key exemplars; where
   framing differs, the record wins.
2. **Runs list + Run detail + run-vs-run diff** (appeared / self-resolved / reopened).
3. **Exceptions worklist + case view + operator login/session/mutations.**
4. **Quarantine** (control-total contradiction, circuit-breaker rows).
5. **Polish:** loading/empty/error states, mobile treatment of the visitor's walk,
   ⌘K search, first-visit banner, the footer promise; e2e smoke; docs pass.

## Decisions to record (`decisions.md`)

- **D34** — Web is API-backed; no second dataset. The record is the only source.
- **D35** — Tailwind v4 with CSS-first tokens; motifs as small component classes.
- **D36** — Operator session = httpOnly cookie relaying the bearer token; API stays
  the authority and the guard; no token list or crypto in the web tier.

## Docs to update when done

`apps/web/README.md` (real quickstart), `topology.md` (web in the running stack),
`onboarding.md` (codemap + "add a page" recipe), `how-it-works.md` §7 (the
dashboard as the record's second consumer), `decisions.md` (D34–D36), and
`stage-3.md` acceptance boxes as they're met.

## Later

Saved break filters; exceptions assignment/SLAs; per-transaction deep pages beyond
the explain chain; richer search (server-side, typo-tolerant). Park here, don't build.
