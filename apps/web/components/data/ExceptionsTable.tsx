import Link from "next/link";
import type { ExceptionRow } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { StateChip, statusTone } from "@/components/primitives/StateChip";
import { cx } from "@/lib/cx";
import { TYPE_LABEL } from "@/lib/explain/labels";
import { shortId } from "@/lib/ids";
import { exceptionHref } from "@/lib/routes";
import { age } from "@/lib/time";

const HEAD = "text-[11px] uppercase tracking-[0.06em] text-muted";

/**
 * The exceptions worklist: one row per case, its type worn in the status color,
 * the subject it concerns, the amount at stake, how many runs have seen it, its
 * age, and who touched it last. The whole row opens the case.
 */
export function ExceptionsTable({ rows, now }: { rows: ExceptionRow[]; now: string }) {
  return (
    <div>
      <div className={cx("hidden items-center gap-4 border-b border-hair px-1.5 pb-2.5 sm:flex", HEAD)}>
        <span className="basis-40">Type</span>
        <span className="flex-1">Case</span>
        <span className="basis-24 text-right">Amount</span>
        <span className="basis-24">Seen in</span>
        <span className="basis-14">Age</span>
        <span className="basis-24">Last actor</span>
      </div>
      {rows.map((row) => (
        <Link
          key={row.id}
          href={exceptionHref(row.id)}
          className="flex flex-col gap-2 border-b border-hair px-1.5 py-3.5 no-underline hover:bg-wash sm:flex-row sm:items-center sm:gap-4"
        >
          <span className="basis-40">
            <StateChip tone={statusTone(row.reopened ? "reopened" : row.status)} label={TYPE_LABEL[row.type]} />
          </span>
          <span className="flex-1 font-mono text-[13px] text-ink">
            {row.subjectId ?? shortId(row.fingerprint)}
          </span>
          <span className="basis-24 font-mono text-[13.5px] text-ink sm:text-right">
            {row.amountMinor !== null && row.currency !== null ? (
              <Money minor={row.amountMinor} currency={row.currency} />
            ) : (
              <span className="text-muted">—</span>
            )}
          </span>
          <span className="basis-24 text-[12.5px] text-muted">
            {row.seenInRuns} {row.seenInRuns === 1 ? "run" : "runs"}
          </span>
          <span className="basis-14 font-mono text-[12.5px] text-muted">{age(row.createdAt, now)}</span>
          <span className="basis-24 text-[12.5px] text-muted">{row.lastActor}</span>
        </Link>
      ))}
    </div>
  );
}
