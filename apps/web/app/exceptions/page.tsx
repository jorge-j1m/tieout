import type { ExceptionRow } from "@tieout/contracts";
import { RunContextLine } from "@/components/chrome/RunContextLine";
import { CapNote } from "@/components/data/CapNote";
import { ExceptionsTable } from "@/components/data/ExceptionsTable";
import {
  asExceptionTab,
  EXCEPTION_TABS,
  ExceptionTabs,
  type ExceptionTab,
} from "@/components/data/ExceptionTabs";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { EmptyTiedOut } from "@/components/states/EmptyTiedOut";
import { getExceptions, getRuns } from "@/lib/api/endpoints";

export const metadata = { title: "Exceptions" };

/** Which tab a case belongs under — reopened cases leave the open tab for their own. */
function tabOf(e: ExceptionRow): ExceptionTab {
  if (e.status === "acknowledged") return "acknowledged";
  if (e.status === "resolved") return "resolved";
  return e.reopened ? "reopened" : "open";
}

/** Empty copy per tab; the double rule marks only the brand moments. */
const EMPTY: Record<ExceptionTab, { message: string; rule: boolean }> = {
  open: { message: "Nothing open.", rule: true },
  acknowledged: { message: "Nothing acknowledged right now.", rule: false },
  resolved: { message: "Nothing resolved yet.", rule: false },
  reopened: { message: "Nothing reopened. Everything that was fixed has stayed fixed.", rule: true },
};

/** The operator's queue: every case a run surfaced, grouped by where it stands. */
export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ status }, exceptions, runs] = await Promise.all([
    searchParams,
    getExceptions(),
    getRuns(),
  ]);
  const latest = runs[0];
  const now = latest?.asOf ?? new Date().toISOString();

  const partition: Record<ExceptionTab, ExceptionRow[]> = {
    open: [],
    acknowledged: [],
    resolved: [],
    reopened: [],
  };
  for (const e of exceptions) partition[tabOf(e)].push(e);
  const counts = Object.fromEntries(
    EXCEPTION_TABS.map((t) => [t, partition[t].length]),
  ) as Record<ExceptionTab, number>;

  const tab = asExceptionTab(status);
  const rows = partition[tab];
  const empty = EMPTY[tab];

  return (
    <>
      {latest !== undefined && (
        <RunContextLine runId={latest.id} asOf={latest.asOf} ruleset={latest.rulesetVersion} />
      )}
      <Shell className="py-9 pb-16">
        <SectionLabel>Exceptions</SectionLabel>

        <div className="mt-6">
          <ExceptionTabs active={tab} counts={counts} />
        </div>

        <div className="mt-8">
          {rows.length > 0 ? (
            <ExceptionsTable rows={rows} now={now} />
          ) : (
            <EmptyTiedOut rule={empty.rule}>{empty.message}</EmptyTiedOut>
          )}
          <CapNote count={exceptions.length} cap={200} noun="cases" />
        </div>
      </Shell>
    </>
  );
}
