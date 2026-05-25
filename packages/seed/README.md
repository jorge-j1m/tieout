# @tieout/seed

Deterministic Mercadia dataset (D19): one month of USD card volume for a cross-border
marketplace, as seen by two sources — Mercadia's internal ledger and Stripe balance
transactions. Generated arithmetically (no clock, no RNG), so every machine produces
byte-identical data. `pnpm seed` materializes it into `data/` (committed).

## Planted breaks — the acceptance contract

A reconciliation run over this dataset must find **exactly** these four breaks, no more,
no fewer (`data/manifest.json` is the machine-readable version):

| # | Break type            | Where it shows           | Story                                                        |
|---|-----------------------|--------------------------|--------------------------------------------------------------|
| 1 | `missing_in_ledger`   | `txn_fee_radar_0001`     | A Stripe Radar fee nobody ever booked                        |
| 2 | `missing_in_ledger`   | `txn_re_0014`            | A refund issued in Stripe, never booked in the ledger        |
| 3 | `missing_in_stripe`   | `LED-2026-NS01`          | A payment booked in the ledger; the charge never settled     |
| 4 | `duplicate_candidate` | `LED-2026-0028-DUP`      | The same charge posted twice in the ledger                   |

Everything else ties out: 37 charges match on exact reference, 3 manually-booked
payments (no PSP reference) match through the amount+date-window fallback, and 3 of the
4 refunds are booked on both sides.

## Regenerating

```bash
pnpm seed   # rewrites data/*.json; a no-op diff unless the generator changed
```

The test suite fails if `data/` drifts from the generator — regenerate and commit both.
