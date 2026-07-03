import { CapNote } from "@/components/data/CapNote";
import { RunsTable } from "@/components/data/RunsTable";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { getRuns } from "@/lib/api/endpoints";

export const metadata = { title: "Runs" };

/** Every nightly reconciliation run, newest first. */
export default async function RunsPage() {
  const runs = await getRuns();
  const latest = runs[0];

  return (
    <Shell className="py-9 pb-16">
      <div className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
        <SectionLabel>Runs</SectionLabel>
        <span className="text-[12.5px] text-muted">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>
      {latest !== undefined ? (
        <RunsTable runs={runs} latestId={latest.id} />
      ) : (
        <p className="text-sm text-muted">No reconciliation runs yet.</p>
      )}
      <CapNote count={runs.length} cap={50} noun="runs" />
    </Shell>
  );
}
