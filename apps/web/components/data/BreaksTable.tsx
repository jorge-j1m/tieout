import Link from "next/link";
import type { Break, ExceptionStatus } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { StateChip, statusTone } from "@/components/primitives/StateChip";
import { TYPE_LABEL, sourceLabel } from "@/lib/explain/labels";
import { headlineFor } from "@/lib/explain/present";
import { breakHref } from "@/lib/routes";
import { age } from "@/lib/time";

export interface BreakRow {
  break: Break;
  status: ExceptionStatus | null;
}

/** Distinct sources a break touches, e.g. "Ledger ↔ Stripe" for a two-sided break. */
function sourcesLabel(brk: Break): string {
  const sources = [...new Set(brk.details.txns.map((t) => t.source))].map(sourceLabel);
  return sources.join(" ↔ ");
}

/**
 * The worklist: one row per break, each naming the ids and amount in plain
 * English and carrying its exception status. Rows are the whole click target —
 * the entire row opens the explain view.
 */
export function BreaksTable({ rows, now }: { rows: BreakRow[]; now: string }) {
  return (
    <div className="border-t border-hair">
      {rows.map(({ break: brk, status }) => {
        const subject = brk.details.txns[0];
        return (
          <Link
            key={brk.id}
            href={breakHref(brk.id)}
            className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-hair px-1.5 py-4 no-underline hover:bg-wash sm:grid-cols-[8.5rem_1fr_auto] sm:items-baseline"
          >
            <StateChip tone="break" label={TYPE_LABEL[brk.type]} />
            <span className="text-sm text-ink">{headlineFor(brk)}</span>
            <span className="flex items-baseline justify-between gap-4 sm:justify-end">
              {subject !== undefined && (
                <Money minor={subject.amountMinor} currency={subject.currency} className="text-sm" />
              )}
            </span>
            <span className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted sm:col-start-2 sm:col-end-4">
              <span>{sourcesLabel(brk)}</span>
              {subject !== undefined && <span>· {age(subject.occurredAt, now)} old</span>}
              {status !== null && <StateChip tone={statusTone(status)} label={status} />}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
