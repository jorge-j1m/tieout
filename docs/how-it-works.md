# How Tieout works — the whole engine, in plain English

This document explains everything Tieout does behind the scenes: what data comes in,
what happens to it, what comes out, when, where, and — most importantly — **why**. It is
written for anyone: an accountant, a finance-ops analyst, a product person, a new
engineer. No code knowledge is needed. Every rule comes with an example, and all the
examples use real numbers from the built-in demo dataset (a fictional marketplace called
**Mercadia**), so you can run the engine yourself and see exactly these results.

Engineers: this document describes behavior. The *reasons* behind each design choice
live in [`decisions.md`](decisions.md), and the machines it runs on in
[`topology.md`](topology.md). If this document and the code ever disagree, the code is
reality and this document has a bug.

---

## 1. The one-paragraph version

Money moves through many systems — your accounting ledger, Stripe, banks — and each one
keeps its own records, in its own format, on its own schedule. Tieout pulls the records
out of every system, stores them **exactly as received**, translates them all into one
common shape, and then plays a giant game of matching: every record should have a
counterpart on the other side. Whatever matches is fine. Whatever doesn't becomes a
**break** — a typed, explained exception for a human to investigate. Every run, every
match, and every break is recorded permanently, so months later you can still ask "what
did we know, and why did we flag this?" and get a precise answer.

**Tieout observes and explains. It never moves money, never edits your books, and never
guesses.**

## 2. The cast of characters

In Stage 1 there are two record-keepers ("**sources**"), watched by one engine:

| Who | What they are | What their records look like |
|---|---|---|
| **The ledger** | Mercadia's own books — its internal system of record | "Entry LED-2026-0001: customer payment, **$49.00**, booked May 1, reference `ch_mercadia_0001`" |
| **Stripe** | The payment processor that actually handles the cards | "Balance transaction `txn_ch_0001`: charge, **+4900** cents, May 1, from charge `ch_mercadia_0001`" |

Neither side is "the truth." They are two **witnesses** to the same events, and each one
can be wrong, late, or incomplete in its own way. Tieout's job is to cross-examine them.

The engine itself is three steps run in order — **Land → Normalize → Reconcile** — plus
a permanent filing cabinet (a Postgres database that Tieout owns) where every piece of
evidence is kept forever:

```
  Mercadia's ledger export              Stripe balance transactions
          │                                       │
          ▼                                       ▼
  ┌─────────────────────── 1. LAND ───────────────────────────┐
  │ Store every record exactly as received — byte for byte,   │
  │ append-only, fingerprinted. Nothing interpreted yet.      │
  └────────────────────────────┬───────────────────────────────┘
                               ▼
  ┌─────────────────────  2. NORMALIZE  ───────────────────────┐
  │ Translate each raw record into the one canonical           │
  │ transaction shape — or quarantine it with stated reasons.  │
  └────────────────────────────┬───────────────────────────────┘
                               ▼
  ┌─────────────────────  3. RECONCILE  ───────────────────────┐
  │ Take a snapshot, match ledger vs Stripe, and permanently    │
  │ record the matches and the typed breaks.                   │
  └────────────────────────────┬───────────────────────────────┘
                               ▼
        run summary (console / Slack) · a worklist of breaks
```

## 3. The rule book

Eleven rules govern everything. Each exists because the opposite has burned real
finance teams.

**Rule 1 — Money is counted in whole numbers of the smallest unit.**
$49.00 is stored as `4900` cents, ¥1,234 as `1234` yen, 0.000001 USDC as `1` micro-USDC.
Never as a decimal like `49.00` in a floating-point number, because computers cannot
hold most decimal fractions exactly — they store the *nearest* binary fraction, and the
rounding crumbs eventually surface as cents that don't tie out. A reconciliation engine
that loses cents reconciles nothing. Amounts are parsed from the source's text straight
into integers; if a feed says `10.555` in a currency with two decimals, that's an error
to quarantine, **never** something to round.

**Rule 2 — Financial records are never edited or deleted.**
The database is append-only: corrections are *new versions*, and even data that
disappears from a source gets a "tombstone" version recording its disappearance. The
audit trail is the product; an UPDATE would be erasing evidence. (The only sanctioned
change to an existing row is flipping its "this is the current version" flag when a
newer version arrives — see §5.4.)

**Rule 3 — Keep the original before any translation.**
Every record is stored raw — exactly as the source sent it — *before* Tieout interprets
anything. Every translated transaction points back to its raw original and records which
version of the translator produced it. If a translation bug is found, the fix is to
re-translate from the stored originals, never to re-ask the source (which may have
changed) and never to silently patch outputs.

**Rule 4 — Every record has exactly one identity.**
A record's identity is the trio **(source, account, source's own ID)** — e.g.
`(stripe, acct_mercadia, txn_ch_0001)`. Sources that don't provide IDs (bank CSV lines,
typically) get a deterministic synthetic ID built from the file's identity, the line's
content, and which occurrence of that line it is — so two *legitimately identical* lines
in one statement stay two records instead of collapsing into one.

**Rule 5 — Two clocks: when it happened vs. when we learned it.**
Every transaction carries `occurredAt` (the event time, per the source) and `observedAt`
(when Tieout first saw it). They differ constantly — a Saturday card charge may not
appear in a settlement feed until Tuesday. Keeping both is what lets Tieout answer
"what did we know on March 3?" honestly.

**Rule 6 — When in doubt, quarantine. Never guess.**
A record that fails validation — unparseable amount, unknown currency, a transaction
type we've never seen — is set aside in a quarantine area **with structured reasons**,
and the rest of the batch continues. Tieout never coerces a weird value into a guess and
never skips silently, because both manufacture false confidence. Quarantine is a
worklist, not a trash can: the original payload is kept, so once the rule or feed is
fixed, the record can be processed for real.

**Rule 7 — Every job assumes it will run twice.**
Schedulers retry, networks fail mid-run, humans click twice. So every unit of work
carries an "idempotency key" (a fingerprint of *what* it is — e.g. a file's content
hash), and doing the same unit again changes nothing: landing the same file twice
produces zero new rows; a job killed halfway and retried completes to exactly the state
a single clean run would have produced. This is tested, not hoped.

**Rule 8 — Statuses can move backwards.**
A "settled" payment can become "reversed" weeks later (chargebacks; on crypto rails,
chain reorganizations). Tieout never assumes status only moves forward.

**Rule 9 — All timestamps are UTC.**
Sources reporting local times get converted exactly once, at the door (in the adapter).
A feed that sends `09:15+02:00` to an interface whose contract says UTC is *drift*, and
drift quarantines.

**Rule 10 — No currency conversion at the door.**
A €100 record is stored as €100 forever. If matching across currencies is ever needed,
conversion happens *at match time* with an explicitly recorded rate and tolerance —
because converting at ingestion bakes an invisible, unauditable rate choice into the
permanent record. (Stage 1 matches within a single currency only.)

**Rule 11 — Same input, same answer. Always.**
Matching is deterministic: feed it the same records in any order, any number of times,
and it produces byte-identical matches and breaks. There is no randomness, no clock
reads, no "usually." This is what makes a reconciliation defensible in an audit — and
it's enforced by property-based tests that shuffle inputs thousands of ways and demand
identical output.

## 4. Step 1 — Landing: getting data in

**What comes in.** In Stage 1, two feeds:

- **Ledger**: a JSON export of Mercadia's internal ledger entries (a file).
- **Stripe**: *balance transactions* — Stripe's own money-movement journal (every
  charge, refund, fee, and payout as it affects the Stripe balance). In Stage 1 this is
  a committed, deterministic fixture shaped exactly like the real API response, so
  nothing needs the network; the live API client will later replace only the "fetch"
  part, nothing downstream.

**When.** Stripe landing is scheduled hourly; ledger landing runs on demand (and both
run as part of any full pipeline run, e.g. the `pnpm recon` command or the `recon-all`
job). Each scheduled poll re-covers a **48-hour lookback window** on purpose: data
arrives late and out of order (Rule 5), and re-seeing the same records is free thanks to
Rule 7.

**What "landing" stores.** Each unit of work (one file, one API window) becomes an
**ingestion batch**, and every record in it becomes a **raw record**:

| Stored thing | What it is | Example |
|---|---|---|
| Ingestion batch | "On June 5 we landed file X from source Y" — with the unit's idempotency key, a content fingerprint, and any control totals the source declares (e.g. "this file says it has 45 entries") | `ledger:file:9f3ab2…`, 45 entries |
| Raw record | One record, payload byte-for-byte as received, plus its identity and version | `(ledger, mercadia:operating, LED-2026-0001) v1` |

**The content-hash trick.** Every payload is fingerprinted (a SHA-256 hash of its
canonical form). When a record arrives whose identity Tieout already knows:

- same fingerprint → *we already have this observation*; skip, write nothing;
- different fingerprint → *the source restated it*; store it as **version 2**, keeping
  version 1 untouched (Rule 2).

**Example — a restated file.** PSPs really do re-issue settlement files with
corrections. Suppose the ledger export is re-sent and entry `LED-2026-0001` now reads
$48.90 instead of $49.00. The new file has a different content hash, so it's a new
batch; 44 of its 45 entries are unchanged (skipped), and `LED-2026-0001` gets a raw
**v2** with the new payload. Both versions exist forever; nothing was overwritten.

**Example — a crash mid-landing.** A landing job dies after writing 20 of 45 records.
The retry presents the same idempotency key, finds the half-finished batch, skips the
20 already-landed records, and writes the missing 25. Final state: identical to one
clean run. (This convergence is covered by an automated test.)

Landing also advances a per-source **cursor** — a high-water mark of how far we've
ingested — which only ever moves forward; the overlapping windows behind it are what
catch stragglers.

## 5. Step 2 — Normalization: one common language

Raw records are in each source's dialect. Normalization translates each one into the
single canonical transaction shape that everything downstream speaks:

| Canonical field | Meaning | Ledger example | Stripe example |
|---|---|---|---|
| `source` / `sourceAccount` / `sourceId` | identity (Rule 4) | `ledger / mercadia:operating / LED-2026-0001` | `stripe / acct_mercadia / txn_ch_0001` |
| `sourceType` | the source's own word, kept verbatim | `payment` | `charge` |
| `type` | canonical type: `payment, refund, payout, fee, transfer, reversal, adjustment` | `payment` | `payment` |
| `amountMinor` | integer, smallest unit, **signed from Mercadia's point of view** (money in = positive) | `4900` | `4900` |
| `currency` | native currency, ISO code | `USD` | `USD` (uppercased from `usd`) |
| `occurredAt` | event time, UTC | booked-at timestamp | charge-created timestamp |
| `valueDate` | the banking "value date", when the source has one | booking date | the day Stripe makes funds available |
| `account` | which account's money story this is | `mercadia:operating` | `acct_mercadia` |
| `reference` | the cross-system claim ("I am about charge X") | `ch_mercadia_0001` | `ch_mercadia_0001` |
| `status` | canonical: `pending, settled, failed, reversed` | `posted` → `settled` | `available` → `settled` |
| `metadata` | source extras worth keeping (description, Stripe's fee/net, …) | description | fee `172`, net `4728` |

Two details worth pausing on:

- **Translation tables are data, not opinions.** `charge → payment`,
  `stripe_fee → fee`, `posted → settled`, `void → reversed`, and so on. A source value
  with no table entry is **not** mapped to "probably a payment" — it quarantines
  (Rule 6). When Stripe invents a new transaction type, Tieout's reaction is "a human
  should look at this," not a silent default.
- **The translator is versioned.** Every transaction records `normalizerVersion`
  (currently `ledger-v1` / `stripe-v1`). Found a translation bug? Bump the version and
  re-run: every raw record gets re-translated into new transaction versions, traceably,
  per Rule 3.

### 5.1 What quarantine looks like

Each rejected record becomes a quarantine row with the original payload and a list of
precise reasons. Real examples from the test fixtures:

| Drifted input | Quarantine reason |
|---|---|
| type `wire_in` | "unmapped ledger type: wire_in" |
| amount `12.3.4` | "malformed dot-format amount" |
| amount `10.555` in USD | "amount has 3 fraction digits; USD carries 2" |
| currency `DOGE` | "unknown currency: DOGE" |
| timestamp `09:15+02:00` | invalid — the ledger contract is UTC (Rule 9) |
| Stripe amount `10.5` | invalid — balance transactions are integer cents (Rule 1) |

A quarantined record produces **no transaction** and therefore cannot quietly distort a
reconciliation. (The clean demo dataset quarantines nothing — also asserted by a test.)

### 5.2 Versions and "current"

When normalization produces a transaction for an identity that already has one — because
the raw record was restated — the new transaction becomes **version 2, current**, and
version 1 is flipped to *not current* with a `supersededAt` timestamp (the one sanctioned
edit, Rule 2). Continuing §4's example:

| Identity | Version | Amount | Current? |
|---|---|---|---|
| `ledger / LED-2026-0001` | v1 | $49.00 | no — superseded June 6 |
| `ledger / LED-2026-0001` | v2 | $48.90 | **yes** |

Future reconciliations use v2. Any *past* run that used v1 still says so, explicitly —
see §8.

### 5.3 Built-in safety nets

The database itself — not just the code — enforces the bookkeeping: one current version
per identity, no duplicate raw versions, no double-translation of the same raw record by
the same translator version, and (later, in matching) no transaction in two matches in
one run. Even buggy code physically cannot create those situations.

## 6. Step 3 — Reconciliation: the matching game

This is the heart. A reconciliation run ("**recon run**"):

1. **Fixes its snapshot.** The run computes its `asOf` watermark — "everything we had
   observed up to this moment" — from the data itself (the latest `observedAt`), not
   from the wall clock. It then takes all *current* transaction versions observed by
   then. This is why running recon twice with no new data gives identical results.
2. **Matches** ledger vs. Stripe with **ruleset v1** (below).
3. **Records everything, permanently**: the run (with its watermark, ruleset version,
   and stats), each match (with *which version* of each transaction it matched), and
   each break (with full details).

### The four passes of ruleset v1

All passes are 1:1 — one ledger record to one Stripe record. (Grouped matching — one
Stripe payout vs. many ledger entries — is Stage 2.)

**Pass 1 — Duplicate sweep (within each side).**
If one side has two records claiming the same reference, the earliest is kept in the
game and every extra is consumed as a `duplicate_candidate` break. *Example: Mercadia
posted order #1027 twice — `LED-2026-0028` and `LED-2026-0028-DUP`, both $85.99, both
referencing `ch_mercadia_0028`. The original stays matchable; the re-post becomes a
break for a human to reverse in the books.*

**Pass 2 — Exact reference.**
A ledger record and a Stripe record citing the same reference are each other's
counterpart. If their amounts and currency agree → **match** (kind:
`exact_reference`). If they cite the same reference but *disagree on the amount* →
that's not a missing record, it's a contradiction: an `amount_mismatch` break consuming
both. *Example match: `LED-2026-0001` ($49.00, ref `ch_mercadia_0001`) ↔ `txn_ch_0001`
(+4900¢, source `ch_mercadia_0001`).*

**Pass 3 — Amount + date window.**
Records still unmatched (e.g. a manual journal entry booked without a PSP reference)
are paired by exact amount, same currency, and event times within **±2 days**, choosing
the nearest in time when several qualify (kind: `amount_date_window`). *Example: order
#1007's $58.59 was booked manually as `LED-2026-0008` with no reference; it still finds
`txn_ch_0008` (+5859¢, same day).* The demo dataset makes every amount unique so this
pass can never pair the wrong records; in the real world this pass is deliberately
conservative — same cent, same currency, close in time.

**Pass 4 — Leftovers become breaks.**
Anything still standing alone *is* the finding: a leftover ledger record →
`missing_in_stripe`; a leftover Stripe record → `missing_in_ledger`. There is no
"unmatched but probably fine" bucket in Stage 1 — every record ends up in exactly one
match or exactly one break, provably (a property test asserts this partition for
thousands of generated scenarios).

### The four break types, as an accountant would read them

| Break type | Plain English | Demo example | Typical resolution |
|---|---|---|---|
| `missing_in_ledger` | "Money moved at the processor that your books don't show." | Stripe charged an **$8.50** Radar fee (`txn_fee_radar_0001`) nobody booked; a **$66.81** refund (`txn_re_0014`) was issued in Stripe but never booked | Book the fee / the refund |
| `missing_in_stripe` | "Your books claim money moved, but the processor has no record." | `LED-2026-NS01`: a **$111.11** payment booked, but the charge never settled | Reverse or re-collect; investigate why it was booked |
| `amount_mismatch` | "Both sides describe the same event but disagree on the amount." | (none planted in the demo) ledger says $49.00, Stripe says $48.90 for the same charge | Find the fee/rounding/entry error; correct the books |
| `duplicate_candidate` | "The same event appears twice on one side." | `LED-2026-0028-DUP`, the double-posted $85.99 | Reverse the duplicate posting |

Every break stores the full identity, amount, time, and version of each transaction
involved — enough to explain itself years later without re-deriving anything.

### What a break is *not*

A break is a **statement of disagreement between two record-keepers**, not an
accusation and not yet a journal entry. Tieout never "fixes" a break by touching data —
resolution happens in the real systems (book the missing fee, reverse the duplicate),
and the *next* reconciliation run naturally comes back clean. (A proper exceptions
workflow — assign, comment, resolve, with its own append-only history — is Stage 2/3.)

## 7. What comes out

Each run ends with a summary — to the console, and to Slack if a webhook is configured.
The demo's actual output:

```
recon run 7e9b0611-…
  as of:    2026-06-05T00:00:00.000Z
  ruleset:  ruleset-v1
  ledger: 1 batch(es), 0 raw inserted, 45 unchanged, 0 normalized, 0 quarantined
  stripe: 1 batch(es), 0 raw inserted, 45 unchanged, 0 normalized, 0 quarantined
  matches:  43 (86 transactions)
  breaks:   4
    - missing_in_ledger: 2
    - missing_in_stripe: 1
    - duplicate_candidate: 1
```

But the summary is just the receipt. The real output is the permanent record in
Tieout's database: the run, its matches (each naming transaction **and version**), its
breaks (with full details), all queryable forever. Stage 3 puts a dashboard and an
exceptions worklist on top; the data model underneath is already final.

## 8. "Why was this flagged in March?" — reproducibility

Because of Rules 2, 5, and 11, every historical run can be explained precisely:

1. The run row says **as of when** it looked (`asOf`), and **which rulebook** it used
   (`ruleset-v1`).
2. Its matches and breaks name the exact **versions** of the transactions they
   evaluated — so even if `LED-2026-0001` was later restated from $49.00 to $48.90, the
   March run still visibly says "I matched **v1, $49.00**."
3. Each of those versions points to its raw original, byte-for-byte as the source sent
   it, and to the translator version that processed it.

So the answer to "why was this flagged in March?" is a chain of records, not a
recollection: *this raw payload* → *translated by stripe-v1 into this transaction v1* →
*evaluated by ruleset-v1 as of March 3, 02:00 UTC* → *no ledger counterpart existed
among what we had observed* → `missing_in_ledger`.

## 9. When everything runs

| Job | When | What it does |
|---|---|---|
| `land-stripe` | hourly (scheduled) | lands a 48h overlapping window of balance transactions, then fans out normalization per batch |
| `land-ledger` | on demand | same, for the ledger export |
| `normalize-batch` | fan-out after landing | translates one batch; skips anything already translated |
| `recon-run` | on demand (nightly, eventually) | one reconciliation run + summary |
| `recon-all` | on demand | the whole pipeline in one go — the demo button |
| `pnpm recon` (terminal) | on demand | identical to `recon-all`, no job platform needed |

Failures are boring by design: any job can die at any point and be retried (Rule 7);
retries converge to the same state; orchestration is handled by Trigger.dev, but **all
financial data and all audit history live only in Tieout's own Postgres** — the job
platform remembers nothing the product needs.

## 10. The lifetime of the data, end to end

Following one record through its whole life:

1. **Born at the source.** May 1, 08:00 UTC: a customer pays $49.00; Stripe writes
   `txn_ch_0001`; Mercadia's bookkeeping writes `LED-2026-0001` referencing the charge.
2. **Landed.** June 5: Tieout ingests both feeds. Two batches; raw records v1 written,
   `observedAt = June 5`. Re-running changes nothing (same fingerprints).
3. **Normalized.** Both raws become canonical transactions v1 (current), `+4900¢ USD`,
   `occurredAt = May 1`, both referencing `ch_mercadia_0001`.
4. **Reconciled.** The run matches them (`exact_reference`), recording both ids *and
   versions* in the match, under run `7e9b0611-…`.
5. **Restated (maybe).** If a corrected export later says $48.90: raw v2 lands,
   transaction v2 becomes current, v1 is marked superseded (never deleted). The next
   run now sees a $48.90 ledger claim vs. a $49.00 Stripe record with the same
   reference → `amount_mismatch` break. The old run still cleanly describes the world
   as it was.
6. **Forever.** Nothing in this chain is ever deleted. Storage is cheap; a broken audit
   trail is not.

What *can* change, exhaustively: the `isCurrent`/`supersededAt` flags (§5.2), a batch's
processing status (`landed` → `normalized` — operational bookkeeping, not financial
data), and source cursors (operational progress markers). That is the complete list.

## 11. Frequently asked questions

**Q: The amounts differ by one cent. Is that a break?**
Yes. Stage 1 has no tolerances — same reference + different amount is an
`amount_mismatch`, full stop. Tolerances (and FX drift handling) arrive in Stage 2 as
*explicit, recorded* rules, never as silent fuzziness.

**Q: A charge settled three days late. False alarm?**
In Stage 1, an unmatched record is a break, so yes — you might see it flagged and then
self-resolve on the next run. Settlement-lag awareness ("inside this source's normal
lag window it's *pending*, not *missing*") is planned for Stage 2, precisely because
false breaks teach users to ignore the product.

**Q: Stripe's fees came out of the payout, not as separate lines. Will that match?**
Not yet — that's grouped (1:N / N:1) matching: one payout vs. many charges minus fees.
Stage 2. In Stage 1, separate fee lines (like the demo's Radar fee) surface as
`missing_in_ledger` until booked.

**Q: Can someone quietly edit a record to make a break disappear?**
Not inside Tieout. There is no edit path — only new versions, which leave the old ones
and a supersession timestamp behind, and the database itself rejects the shortcuts
(§5.3). The way to clear a break is to fix the real books and re-run.

**Q: Why did the same refund show up as two rows?**
You're looking at versions (the record was restated) — only one is marked *current* —
or at two legitimately distinct records with different identities. The identity trio
(§ Rule 4) is always the tiebreaker.

**Q: What currencies does it understand?**
USD, EUR, GBP, MXN, BRL, COP, ARS (2 decimals), JPY (0), BHD (3), USDC (6). Anything
else quarantines until it's added deliberately — adding a currency is a decision, not a
default.

**Q: Multiple Stripe accounts? Multiple ledgers?**
Identity includes the account (Rule 4), so records from different accounts never
collide. Multi-account is assumed from day one.

**Q: Who can see this data? Is any of it real?**
The demo dataset is entirely synthetic. The development setup binds the database to the
local machine only; nothing is exposed publicly until the Stage 3 demo app, and
operational consoles stay behind a private network. Secrets never live in the
repository, and only Stripe *test mode* keys are ever used.

## 12. What Stage 1 deliberately does not do

So you don't go looking for it: no dashboard or UI (Stage 3), no bank/PagoLat/stablecoin
sources (Stages 2/4), no grouped 1:N matching, no tolerances or FX conversion, no
settlement-lag logic, no exceptions workflow (assign/comment/resolve), no webhooks, no
automatic re-matching when a matched transaction is superseded (the version bookkeeping
for it is already in place; the event mechanism is Stage 2). Each of these is scoped in
[`specs/`](specs/) and resisted until its stage — small, verified steps are how an audit
trail stays trustworthy.

## 13. Glossary

| Term | Meaning |
|---|---|
| **Source** | Any system whose money records we ingest (the ledger, Stripe, …) |
| **Adapter** | The per-source plug-in that knows how to fetch its data and translate its dialect |
| **Batch** | One unit of ingestion — a file or an API window — with its idempotency key |
| **Raw record** | A source record stored byte-for-byte as received; the permanent original |
| **Normalization** | Translating a raw record into the canonical transaction shape |
| **Canonical transaction** | The one common shape all sources are translated into |
| **Quarantine** | The holding area for records that failed validation, with structured reasons |
| **Content hash** | A fingerprint of a payload; "same fingerprint" = "same observation" |
| **Version** | The nth observation of one identity; restatements add versions, never edits |
| **Current** | The latest version of an identity — the one reconciliation uses |
| **Superseded** | A version replaced by a newer one (kept forever, flagged with a timestamp) |
| **Identity** | The trio (source, account, source's own ID) that makes a record unique |
| **occurredAt / observedAt** | When the event happened vs. when Tieout learned of it |
| **Watermark / asOf** | "Everything observed up to this moment" — a run's fixed snapshot point |
| **Recon run** | One execution of the matching game over a snapshot, recorded permanently |
| **Ruleset** | The versioned rulebook a run used (currently `ruleset-v1`) |
| **Match** | A recorded "these records are counterparts," naming exact transaction versions |
| **Break** | A typed, explained disagreement between sources — the work product |
| **Idempotent** | Safe to run twice: the second run changes nothing |
| **Minor units** | The smallest unit of a currency (cents, yen, micro-USDC) — how all money is stored |

---

*To see all of this live: follow the README quickstart, run `pnpm recon` twice, and
compare the two runs. The four breaks it reports are exactly the four planted in
[`packages/seed/README.md`](../packages/seed/README.md).*
