import Link from "next/link";
import { FirstVisitBanner } from "@/components/chrome/FirstVisitBanner";
import { RunContextLine } from "@/components/chrome/RunContextLine";
import { CounterBlock } from "@/components/data/CounterBlock";
import { SourcesStrip } from "@/components/data/SourcesStrip";
import { TrendStrip } from "@/components/data/TrendStrip";
import { TypedList } from "@/components/data/TypedList";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { getRunBreaks, getRuns, getSources } from "@/lib/api/endpoints";
import { buildTrend, pendingCount, rollupBreaksByType, runDurationSeconds } from "@/lib/overview";
import { breakHref, runHref, runTabHref } from "@/lib/routes";
import { shortId } from "@/lib/ids";
import { formatUtc } from "@/lib/time";

/** The morning-coffee screen: where a clean run looks quiet and a broken one points the way. */
export default async function OverviewPage() {
  const runs = await getRuns();
  const latest = runs[0];
  if (latest === undefined) {
    return (
      <Shell className="py-16">
        <SectionLabel>Overview</SectionLabel>
        <p className="mt-4 text-sm text-muted">No reconciliation runs yet.</p>
      </Shell>
    );
  }

  const [breaks, sources] = await Promise.all([getRunBreaks(latest.id), getSources()]);
  const prev = runs[1];
  const rollup = rollupBreaksByType(breaks ?? []);
  const trend = buildTrend(runs);
  const delta = prev !== undefined ? latest.stats.totalBreaks - prev.stats.totalBreaks : 0;
  const quarantined = sources.reduce((n, s) => n + s.quarantinedUnits, 0);
  const duration = runDurationSeconds(latest);

  // The banner points at one break to follow — the refund nobody booked, if present.
  const hero = (breaks ?? []).find((b) => b.type === "missing_in_ledger") ?? (breaks ?? [])[0];

  const deltaLabel =
    delta === 0
      ? "— no change vs previous run"
      : `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)} vs previous run`;

  return (
    <>
      <FirstVisitBanner
        breaksCount={latest.stats.totalBreaks}
        followHref={hero !== undefined ? breakHref(hero.id) : "/breaks"}
      />
      <RunContextLine runId={latest.id} asOf={latest.asOf} ruleset={latest.rulesetVersion} />

      <Shell className="py-9 pb-16">
        <SectionLabel>Overview</SectionLabel>

        {/* Counter blocks, ruled like a statement */}
        <div className="mt-7 flex flex-wrap border-y border-hair [&>*]:border-l [&>*]:border-hair [&>*]:pl-[clamp(16px,3vw,28px)] [&>*:first-child]:border-l-0 [&>*:first-child]:pl-0">
          <CounterBlock
            label="Matched"
            value={latest.stats.matches}
            tied
            sub={`${latest.stats.matchedTransactions} transactions`}
          />
          <CounterBlock
            label="Breaks"
            value={latest.stats.totalBreaks}
            tone="break"
            sub={
              <span className={delta > 0 ? "text-break" : delta < 0 ? "text-matched" : undefined}>
                {deltaLabel}
              </span>
            }
          />
          <CounterBlock
            label="Pending"
            value={pendingCount(latest)}
            tone="pending"
            sub="in settlement-lag window"
          />
          <CounterBlock
            label="Quarantined"
            value={quarantined}
            unit={quarantined === 1 ? "unit" : "units"}
            tone="pending"
            sub={
              <Link href="/quarantine" className="text-muted">
                see why →
              </Link>
            }
          />
        </div>

        {rollup.length > 0 && (
          <section className="mt-13">
            <SectionLabel className="mb-3.5">
              {latest.stats.totalBreaks} breaks by type
            </SectionLabel>
            <TypedList rows={rollup} />
          </section>
        )}

        <section className="mt-13">
          <SectionLabel className="mb-4">Breaks across recent runs</SectionLabel>
          <TrendStrip points={trend} />
        </section>

        <section className="mt-13">
          <SectionLabel className="mb-3.5">Sources</SectionLabel>
          <SourcesStrip sources={sources} />
        </section>

        <section className="mt-13 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-4 border-t border-hair pt-5">
          <div>
            <SectionLabel className="mb-2">Latest run</SectionLabel>
            <div className="figures text-[13.5px] text-ink">
              run {shortId(latest.id)} · as of {formatUtc(latest.asOf)} · {latest.rulesetVersion}
              {duration !== null && ` · ${duration}s`}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6">
            <Link href={runHref(latest.id)} className="text-[13.5px] text-ink">
              Run detail →
            </Link>
            <Link href={runTabHref(latest.id, "diff")} className="text-[13.5px] text-ink">
              Diff vs previous →
            </Link>
          </div>
        </section>
      </Shell>
    </>
  );
}
