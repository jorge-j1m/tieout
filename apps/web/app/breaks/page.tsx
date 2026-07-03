import Link from "next/link";
import {
  BREAK_TYPES,
  EXCEPTION_STATUSES,
  type BreakType,
  type ExceptionStatus,
} from "@tieout/contracts";
import { RunContextLine } from "@/components/chrome/RunContextLine";
import { BreaksTable, type BreakRow } from "@/components/data/BreaksTable";
import { WorklistFilters } from "@/components/data/WorklistFilters";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { EmptyTiedOut } from "@/components/states/EmptyTiedOut";
import { getExceptions, getRunBreaks, getRuns } from "@/lib/api/endpoints";
import { runHref } from "@/lib/routes";

export const metadata = { title: "Breaks" };

/** Narrow a raw query value to a known enum member, or undefined. */
function asMember<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return raw !== undefined && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** The breaks worklist: a run's disagreements, filterable by type and status. */
export default async function BreaksPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; type?: string; status?: string }>;
}) {
  const params = await searchParams;
  const runs = await getRuns();
  const latest = runs[0];
  if (latest === undefined) {
    return (
      <Shell className="py-14">
        <SectionLabel>Breaks</SectionLabel>
        <p className="mt-3 text-sm text-muted">No reconciliation runs yet.</p>
      </Shell>
    );
  }

  const run = (params.run !== undefined ? runs.find((r) => r.id === params.run) : latest) ?? latest;
  const type = asMember<BreakType>(BREAK_TYPES, params.type);
  const status = asMember<ExceptionStatus>(EXCEPTION_STATUSES, params.status);

  const [breaks, exceptions] = await Promise.all([
    getRunBreaks(run.id, { type }),
    getExceptions(),
  ]);
  const statusByFingerprint = new Map(exceptions.map((e) => [e.fingerprint, e.status]));

  const rows: BreakRow[] = (breaks ?? [])
    .map((brk) => ({
      break: brk,
      status: brk.fingerprint !== null ? (statusByFingerprint.get(brk.fingerprint) ?? null) : null,
    }))
    .filter((row) => status === undefined || row.status === status);

  const typesPresent = [...new Set((breaks ?? []).map((b) => b.type))];

  return (
    <>
      <RunContextLine runId={run.id} asOf={run.asOf} ruleset={run.rulesetVersion} />
      <Shell className="py-9 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionLabel>Breaks</SectionLabel>
          {run.id !== latest.id && (
            <Link href={runHref(latest.id)} className="text-xs text-muted hover:text-ink">
              ← back to the latest run
            </Link>
          )}
        </div>

        <div className="mt-6">
          <WorklistFilters selection={{ run: params.run, type, status }} types={typesPresent} />
        </div>

        <div className="mt-8">
          {rows.length > 0 ? (
            <BreaksTable rows={rows} now={run.asOf} />
          ) : (
            <EmptyTiedOut>
              {type !== undefined || status !== undefined
                ? "Nothing matches these filters."
                : "Everything tied out."}
            </EmptyTiedOut>
          )}
        </div>
      </Shell>
    </>
  );
}
