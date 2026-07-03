import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreaksTable, type BreakRow } from "@/components/data/BreaksTable";
import { CounterBlock } from "@/components/data/CounterBlock";
import { SourcesStrip } from "@/components/data/SourcesStrip";
import { MatchesTable } from "@/components/run/MatchesTable";
import { RunConfigPanels } from "@/components/run/RunConfigPanels";
import { RunDiffSections } from "@/components/run/RunDiffSections";
import { asRunTab, RunTabs, type RunTab } from "@/components/run/RunTabs";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { EmptyTiedOut } from "@/components/states/EmptyTiedOut";
import {
  getExceptions,
  getRun,
  getRunBreaks,
  getRunDiff,
  getRunMatches,
  getSources,
} from "@/lib/api/endpoints";
import { shortId } from "@/lib/ids";
import { pendingCount, runDurationSeconds } from "@/lib/overview";
import { formatUtc } from "@/lib/time";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const run = await getRun((await params).id);
  return { title: run ? `Run ${shortId(run.id)}` : "Run" };
}

/**
 * A single reconciliation run, whole: its counts, the rules it ran under, the
 * sources it drew from, and three tabbed views — the pairs it tied out, the
 * breaks it surfaced, and how it differs from the run before it.
 */
export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab = asRunTab(rawTab);

  // One fan-out: the run, the always-shown reads (sources strip, diff badge),
  // and only the active tab's rows — the other badges come free from run.stats,
  // so an inactive tab costs nothing.
  const [run, matches, breaks, exceptions, diff, sources] = await Promise.all([
    getRun(id),
    tab === "matches" ? getRunMatches(id) : null,
    tab === "breaks" ? getRunBreaks(id) : null,
    tab === "breaks" ? getExceptions() : null,
    getRunDiff(id),
    getSources(),
  ]);
  if (run === null) notFound();

  const { stats } = run;
  const duration = runDurationSeconds(run);
  const pending = pendingCount(run);
  const quarantined = sources.reduce((n, s) => n + s.quarantinedUnits, 0);

  const statusByFingerprint = new Map((exceptions ?? []).map((e) => [e.fingerprint, e.status]));
  const breakRows: BreakRow[] = (breaks ?? []).map((brk) => ({
    break: brk,
    status: brk.fingerprint !== null ? (statusByFingerprint.get(brk.fingerprint) ?? null) : null,
  }));

  const counts: Record<RunTab, number> = {
    matches: stats.matches,
    breaks: stats.totalBreaks,
    diff: diff ? diff.appeared.length + diff.reopened.length + diff.selfResolved.length : 0,
  };

  return (
    <Shell className="py-9 pb-16">
      <header>
        <SectionLabel>Reconciliation run</SectionLabel>
        <h1 className="mt-1.5 font-mono text-2xl text-ink">{shortId(run.id)}</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          as of {formatUtc(run.asOf)} · {run.rulesetVersion}
          {duration !== null && <> · {duration}s</>} · {run.status}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-x-10 border-t border-hair">
        <CounterBlock
          label="Matched"
          value={stats.matches}
          tone="ink"
          tied
          sub={`${stats.matchedTransactions} transactions`}
        />
        <CounterBlock
          label="Breaks"
          value={stats.totalBreaks}
          tone={stats.totalBreaks > 0 ? "break" : "ink"}
        />
        <CounterBlock label="Pending" value={pending} tone={pending > 0 ? "pending" : "ink"} />
        <CounterBlock
          label="Quarantined"
          value={quarantined}
          tone={quarantined > 0 ? "pending" : "ink"}
        />
      </div>

      {stats.config !== null && (
        <div className="mt-10">
          <RunConfigPanels config={stats.config} />
        </div>
      )}

      <div className="mt-10">
        <SectionLabel className="mb-3">Sources landed</SectionLabel>
        <SourcesStrip sources={sources} />
      </div>

      <div className="mt-12">
        <RunTabs runId={run.id} active={tab} counts={counts} />
        <div className="mt-6">
          {tab === "matches" &&
            (matches && matches.length > 0 ? (
              <MatchesTable matches={matches} />
            ) : (
              <EmptyTiedOut>This run tied nothing — no pairs to show.</EmptyTiedOut>
            ))}

          {tab === "breaks" &&
            (breakRows.length > 0 ? (
              <BreaksTable rows={breakRows} now={run.asOf} />
            ) : (
              <EmptyTiedOut>Everything tied out.</EmptyTiedOut>
            ))}

          {tab === "diff" &&
            (diff ? (
              <RunDiffSections diff={diff} />
            ) : (
              <p className="py-6 text-sm text-muted">No previous run to compare against.</p>
            ))}
        </div>
      </div>
    </Shell>
  );
}
