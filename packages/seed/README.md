# @tieout/seed

Deterministic Mercadia dataset (D19): one month of USD card volume for a cross-border
marketplace, as seen by two sources — Mercadia's internal ledger and Stripe balance
transactions. Generated arithmetically (no clock, no RNG), so every machine produces
byte-identical data. `pnpm seed` materializes it into `data/` (committed).

## Planted breaks — the acceptance contract

A reconciliation run over this dataset must find **exactly** the breaks below, no more,
no fewer. `data/manifest.json` is the machine-readable contract — planted breaks plus
the expected totals — and every count the tests and docs quote comes from it (a
doc-consistency test fails the build if any quoted number drifts):

| # | Break type            | Where it shows           | Story                                                        |
|---|-----------------------|--------------------------|--------------------------------------------------------------|
| 1 | `missing_in_ledger`   | `txn_fee_radar_0001`     | A Stripe Radar fee nobody ever booked                        |
| 2 | `missing_in_ledger`   | `txn_re_0014`            | A refund issued in Stripe, never booked in the ledger        |
| 3 | `missing_in_stripe`   | `LED-2026-NS01`          | A payment booked in the ledger; the charge never settled     |
| 4 | `duplicate_candidate` | `LED-2026-0028-DUP`      | The same charge posted twice in the ledger                   |
| 5 | `missing_in_ledger`   | `txn_cl_d2`              | Its manual booking landed 48h30m later — just outside the ±48h window |
| 6 | `missing_in_stripe`   | `LED-2026-CLD2`          | The other half of #5: the booking just outside the window    |
| 7 | `missing_in_stripe`   | `LED-2026-CLE2`          | A reference-less double-post: ruleset-v1 pairs one copy and labels this one missing — relabeling is a Stage 2 item |

Everything else ties out: 44 records match on exact reference — the referenced charges
(including a same-amount flash-sale cluster) plus the refunds booked on both sides —
and 10 manually-booked payments (no PSP reference) match through the amount+date-window
fallback, several of them only because the tie rules disambiguate same-amount candidates.

## The adversarial cluster

Ambiguous candidates are the central difficulty of reconciliation, so the dataset
plants them deliberately instead of designing them out (bulk order amounts stay unique
— `4900 + i·137` — so the easy volume is unambiguous and the cluster is isolated):

- **Group A** — four same-amount ($99.99), same-day charges *with* references: pass 2
  pairs all of them regardless of amount collisions.
- **Group B** — three same-amount ($72.50), same-day, reference-less manual bookings:
  pass 3 must disambiguate purely by nearest-in-time.
- **Group C** — an exact equidistant tie: a booking precisely 2h from two identical
  settlements; the documented rule (earlier candidate wins) decides the pairing.
- **Group D** — the window edge, both sides: a booking 47h58m after its charge
  (matches) and one 48h30m after (breaks #5/#6).
- **Group E** — a true reference-less double-post: one copy pairs, the other is
  break #7, deliberately pinned with ruleset-v1's labeling.

## Regenerating

```bash
pnpm seed   # rewrites data/*.json; a no-op diff unless the generator changed
```

The test suite fails if `data/` drifts from the generator — regenerate and commit both.
