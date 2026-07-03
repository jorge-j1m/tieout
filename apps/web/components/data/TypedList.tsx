import Link from "next/link";
import type { BreakType } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { TYPE_LABEL } from "@/lib/explain/labels";
import { breaksByTypeHref } from "@/lib/routes";

export interface TypeRollup {
  type: BreakType;
  count: number;
  totalMinor: string;
  currency: string;
}

/**
 * The run's breaks as a typed list — a list, not a pie chart (the brief: every
 * element answers a question; no chart is filler). Each row opens the worklist
 * filtered to that type.
 */
export function TypedList({ rows }: { rows: TypeRollup[] }) {
  return (
    <div className="border-t border-hair">
      {rows.map((row) => (
        <Link
          key={row.type}
          href={breaksByTypeHref(row.type)}
          className="flex items-center gap-4 border-b border-hair px-1.5 py-3.5 no-underline hover:bg-wash"
        >
          <span className="min-w-36 flex-[1_1_200px] text-xs font-semibold uppercase tracking-[0.06em] text-break">
            {TYPE_LABEL[row.type]}
          </span>
          <span className="figures w-8 text-sm text-ink">{row.count}</span>
          <span className="flex-1" />
          <Money minor={row.totalMinor} currency={row.currency} className="text-sm text-ink" />
          <span aria-hidden className="text-sm text-muted">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}
