import Link from "next/link";
import type { Run } from "@tieout/contracts";
import { cx } from "@/lib/cx";
import { shortId } from "@/lib/ids";
import { runDurationSeconds } from "@/lib/overview";
import { runHref } from "@/lib/routes";
import { formatUtc } from "@/lib/time";

const HEAD = "text-[11px] uppercase tracking-[0.06em] text-muted";

/** The nightly runs, newest first — each row opens the run's detail. */
export function RunsTable({ runs, latestId }: { runs: Run[]; latestId: string }) {
  return (
    <div>
      <div className={cx("hidden items-center gap-4 border-b border-hair px-1.5 pb-2.5 sm:flex", HEAD)}>
        <span className="basis-36">Run</span>
        <span className="basis-44">As of</span>
        <span className="basis-24">Ruleset</span>
        <span className="flex-1">Result</span>
        <span className="basis-16 text-right">Duration</span>
      </div>
      {runs.map((run) => {
        const duration = runDurationSeconds(run);
        const breaks = run.stats.totalBreaks;
        return (
          <Link
            key={run.id}
            href={runHref(run.id)}
            className="flex flex-col gap-2 border-b border-hair px-1.5 py-3.5 no-underline hover:bg-wash sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="flex basis-36 items-center gap-2">
              <span className="font-mono text-[13.5px] text-ink">{shortId(run.id)}</span>
              {run.id === latestId && (
                <span className="rounded-[2px] border border-hair px-1.5 py-px text-[10px] uppercase tracking-[0.05em] text-muted">
                  latest
                </span>
              )}
            </span>
            <span className="basis-44 font-mono text-[12.5px] text-muted">{formatUtc(run.asOf)}</span>
            <span className="basis-24 font-mono text-[12.5px] text-muted">{run.rulesetVersion}</span>
            <span className="flex-1 font-mono text-[13px] text-ink">
              {run.stats.matches} matches ·{" "}
              <span className={breaks > 0 ? "text-break" : "text-matched"}>{breaks} breaks</span>
            </span>
            <span className="font-mono text-[12.5px] text-muted sm:basis-16 sm:text-right">
              {duration !== null ? `${duration}s` : "—"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
