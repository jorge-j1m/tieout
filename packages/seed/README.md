# @tieout/seed

Deterministic Mercadia dataset (D19): one month of cross-border marketplace volume as
seen by three sources — Mercadia's internal ledger, Stripe balance transactions (USD),
and PagoLat settlement day-files (MXN, the invented LatAm PSP with all the real-world
pathologies: locale decimals, no line ids, control totals, restated files). Generated
arithmetically (no clock, no RNG), so every machine produces byte-identical data.
`pnpm seed` materializes it into `data/` (committed).

## Planted breaks — the acceptance contract

A reconciliation run over this dataset must find **exactly** the breaks below, no more,
no fewer. `data/manifest.json` is the machine-readable contract — planted breaks plus
the expected totals — and every count the tests and docs quote comes from it (a
doc-consistency test fails the build if any quoted number drifts):

| # | Break type            | Where it shows           | Story                                                        |
|---|-----------------------|--------------------------|--------------------------------------------------------------|
| 1 | `unexpected_fee`      | `txn_fee_radar_0001`     | A Stripe Radar fee nobody ever booked                        |
| 2 | `missing_in_ledger`   | `txn_re_0014`            | A refund issued in Stripe, never booked in the ledger        |
| 3 | `missing_in_source`   | `LED-2026-NS01`          | A payment booked in the ledger; the charge never settled     |
| 4 | `duplicate_candidate` | `LED-2026-0028-DUP`      | The same charge posted twice in the ledger                   |
| 5 | `missing_in_ledger`   | `txn_cl_d2`              | Its manual booking landed 48h30m later — just outside the ±48h window |
| 6 | `missing_in_source`   | `LED-2026-CLD2`          | The other half of #5: the booking just outside the window    |
| 7 | `duplicate_candidate` | `LED-2026-CLE2`          | A reference-less double-post: one copy pairs through the fallback, the duplicate heuristic names this survivor |
| 8 | `unexpected_fee`      | `LED-2026-PL22`          | PagoLat slipped a platform fee into the 05-22 settlement; the booking ignored it — the group mismatch is explained exactly by the fee line |
| 9 | `fx_drift`            | `LED-2026-PL23`          | The 05-23 settlement was booked at 0.0612, the run's recorded rate is 0.0588 — the rate is the suspect |

Everything else ties out: 46 records match on exact reference — the referenced charges
(including a same-amount flash-sale cluster), the refunds booked on both sides, and
the payout/deposit transfer legs — 10 manually-booked payments (no PSP reference)
match through the amount+date-window fallback, several of them only because the tie
rules disambiguate same-amount candidates, and 2 PagoLat settlements group N:1
against their ledger bookings on a net basis, MXN→USD at the run's recorded rate.

## The settlement story

PagoLat ships six day-files exercising settlement reality end to end:

- **05-21** — clean: three lines netting 2,900.00 MXN group against the $170.52
  booked as `LED-2026-PL21` — converted at the recorded 0.0588 desk rate, exact.
- **05-22** — the platform fee surprise (break #8).
- **05-23** — the wrong internal rate (break #9).
- **05-24** — a file whose footer lies about its own totals: quarantined **whole** at
  landing (D13). No raw records, one batch-level quarantine row — and no break,
  because nothing it claims can be trusted.
- **05-25 + 05-25.restated** — PagoLat re-issued the file without an erroneous line.
  The original lands first, the restatement tombstones the vanished line (D8), and the
  group matches the corrected booking. Re-running never resurrects the dead line: a
  complete unit's content only applies from its latest delivery.

Settlement lag (D12) is deliberately **not** in the manifest: the demo's watermark is
your wall clock, so lag windows would make the numbers time-dependent. The integration
suite proves lag behavior with pinned `asOf` values instead.

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
- **Group E** — a true reference-less double-post: one copy pairs through the
  fallback, and the duplicate heuristic (D29h) names the survivor — break #7.

## Regenerating

```bash
pnpm seed   # rewrites data/*.json; a no-op diff unless the generator changed
```

The test suite fails if `data/` drifts from the generator — regenerate and commit both.
