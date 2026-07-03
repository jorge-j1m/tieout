import type { TransactionRow } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { UtcTime } from "@/components/primitives/UtcTime";

/**
 * The version chain of one identity. Superseded versions are shown with respect —
 * "v1 · superseded …" — never struck through or flagged as errors: a restatement
 * is a new truth, and the old one still happened (append-only honesty, D8).
 */
export function VersionChain({ versions }: { versions: TransactionRow[] }) {
  if (versions.length <= 1) return null;
  return (
    <ol className="mt-3 border-t border-hair">
      {versions.map((v) => (
        <li
          key={v.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hair py-2 text-sm"
        >
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-ink">v{v.version}</span>
            {v.isCurrent ? (
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-matched">
                current
              </span>
            ) : (
              <span className="text-xs text-muted">
                superseded {v.supersededAt !== null && <UtcTime iso={v.supersededAt} />}
              </span>
            )}
          </span>
          <Money minor={v.amountMinor} currency={v.currency} />
        </li>
      ))}
    </ol>
  );
}
