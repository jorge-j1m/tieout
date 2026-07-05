import type { ExceptionDetail } from "@tieout/contracts";
import { TriageMargin } from "@/components/case/TriageMargin";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { getInvestigation, getInvestigationBudget } from "@/lib/api/endpoints";
import { readInvestigateConfig } from "@/lib/investigate/provider";
import { getPersona } from "@/lib/session";
import { Investigation } from "./Investigation";

/**
 * The Investigate section (D38): a first-class part of the case, given real
 * space. It opens with Clara's precomputed read (the batch-triage suggestion,
 * D33, repositioned as the lede) so it is never empty, then the live shared
 * conversation beneath. The gate is computed here, server-side: an operator with
 * the feature on and budget left may ask; everyone else reads the saved thread.
 */
export async function InvestigationPanel({ exception }: { exception: ExceptionDetail }) {
  const [thread, budget, persona] = await Promise.all([
    getInvestigation(exception.id),
    getInvestigationBudget().catch(() => null),
    getPersona(),
  ]);
  const config = readInvestigateConfig();

  const isOperator = persona.operator !== null;
  const enabled = budget?.enabled ?? false;
  const remaining = budget?.remaining ?? 0;
  const canInvestigate = isOperator && enabled && remaining > 0;

  const disabledNote = !isOperator
    ? "You’re viewing as a read-only demo visitor. Sign in as an operator to ask Clara — the thread and its citations are fully readable either way."
    : !enabled
      ? "Live investigation is off on this deployment. The saved thread stays readable."
      : remaining <= 0
        ? "Today’s investigation budget is spent. It resets in a few hours; the saved thread stays readable."
        : null;

  const brk = exception.currentBreak;
  const seededIds = [
    exception.id,
    ...(brk !== null ? [brk.id, ...brk.details.txns.map((t) => t.id)] : []),
  ];
  const triage = exception.triageSuggestions[0];

  return (
    <section className="mt-11">
      <SectionLabel>Investigate</SectionLabel>
      <p className="mt-1.5 text-[12.5px] text-muted">
        {config.assistantName} · assistant · suggests, never resolves
      </p>

      {triage !== undefined && (
        <div className="mt-4 max-w-prose">
          <TriageMargin suggestion={triage} />
        </div>
      )}

      <div className="mt-6">
        <Investigation
          exceptionId={exception.id}
          breakId={brk?.id}
          breakType={exception.type}
          initial={thread?.messages ?? []}
          seededIds={seededIds}
          operatorName={persona.operator ?? "you"}
          assistantName={config.assistantName}
          canInvestigate={canInvestigate}
          disabledNote={disabledNote}
        />
      </div>
    </section>
  );
}
