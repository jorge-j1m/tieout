import { RunContextLine } from "@/components/chrome/RunContextLine";
import { QuarantineCard } from "@/components/quarantine/QuarantineCard";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { EmptyTiedOut } from "@/components/states/EmptyTiedOut";
import { getQuarantine, getRuns } from "@/lib/api/endpoints";

export const metadata = { title: "Quarantine" };

/**
 * The held records — input the engine refused to guess at. Each is preserved
 * whole with the structured reason it was kept, so a human can reconcile the
 * file with its own arithmetic. Quarantine is a worklist, not a trash can.
 */
export default async function QuarantinePage() {
  const [held, runs] = await Promise.all([getQuarantine(), getRuns()]);
  const latest = runs[0];

  return (
    <>
      {latest !== undefined && (
        <RunContextLine runId={latest.id} asOf={latest.asOf} ruleset={latest.rulesetVersion} />
      )}
      <Shell className="max-w-[960px] py-9 pb-16">
        <SectionLabel>Quarantine</SectionLabel>
        <p className="mt-2 text-sm italic text-muted">Quarantine is a worklist, not a trash can.</p>

        {held.length > 0 ? (
          <div className="mt-9 flex flex-col gap-14">
            {held.map((row) => (
              <QuarantineCard key={row.id} row={row} />
            ))}
          </div>
        ) : (
          <EmptyTiedOut>Nothing is held. Every record tied to its source.</EmptyTiedOut>
        )}
      </Shell>
    </>
  );
}
