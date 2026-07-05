import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunContextLine } from "@/components/chrome/RunContextLine";
import { CaseActions } from "@/components/case/CaseActions";
import { EventTimeline } from "@/components/case/EventTimeline";
import { InvestigationPanel } from "@/components/case/investigate/InvestigationPanel";
import { EvidenceSpine } from "@/components/explain/EvidenceSpine";
import { Money } from "@/components/primitives/Money";
import { Mono } from "@/components/primitives/Mono";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { StateChip, statusTone } from "@/components/primitives/StateChip";
import { getException, getRaw, getRun, getRuns, getTransaction } from "@/lib/api/endpoints";
import { TYPE_LABEL } from "@/lib/explain/labels";
import { breakHref } from "@/lib/routes";
import { getPersona } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const exception = await getException((await params).id);
  return { title: exception ? `Case · ${TYPE_LABEL[exception.type]}` : "Case" };
}

/**
 * A single exception, whole: the case's append-only history as the centerpiece,
 * the operator actions, and this run's finding embedded beneath — the same
 * record the break-explain view shows, not a copy of it.
 */
export default async function ExceptionCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [exception, runs, persona] = await Promise.all([getException(id), getRuns(), getPersona()]);
  if (exception === null) notFound();

  const latest = runs[0];
  const brk = exception.currentBreak;
  const subject = brk?.details.txns[0] ?? null;

  // Reopened is computed by the API (the same fact the worklist rows carry) —
  // a case that came back after a resolution reads as "Reopened", not "open".
  const displayStatus = exception.reopened ? "reopened" : exception.status;
  const openedBy = exception.events[0]?.actor ?? "system";
  const ref = subject?.reference ?? subject?.sourceId ?? null;

  // The evidence spine needs the subject's version chain and its raw record —
  // the same fan-out the break-explain view does, so the case shows the finding
  // itself rather than a summary of it.
  const [transaction, brkRun] = await Promise.all([
    subject !== null ? getTransaction(subject.id) : Promise.resolve(null),
    brk !== null ? getRun(brk.runId) : Promise.resolve(null),
  ]);
  const raw = transaction !== null ? await getRaw(transaction.rawId) : null;

  return (
    <>
      {latest !== undefined && (
        <RunContextLine runId={latest.id} asOf={latest.asOf} ruleset={latest.rulesetVersion} />
      )}
      <Shell className="max-w-[880px] py-8 pb-20">
        <Link href="/exceptions" className="text-[13px] text-muted no-underline hover:text-ink">
          ← Exceptions
        </Link>

        <header className="mt-5 border-b border-hair pb-6">
          <div className="flex flex-wrap items-center gap-3">
            <StateChip tone="break" label={TYPE_LABEL[exception.type]} />
            <StateChip tone={statusTone(displayStatus)} label={displayStatus} />
          </div>
          <div className="mt-3.5 flex flex-wrap items-baseline gap-4">
            {subject !== null ? (
              <Money
                minor={subject.amountMinor}
                currency={subject.currency}
                className="text-[clamp(24px,3vw,30px)] text-ink"
              />
            ) : (
              <span className="text-[clamp(24px,3vw,30px)] text-muted">—</span>
            )}
            {ref !== null && <Mono className="text-sm text-muted">{ref}</Mono>}
          </div>
          <p className="mt-2.5 text-[13px] text-muted">
            seen in {exception.seenInRuns} {exception.seenInRuns === 1 ? "run" : "runs"} · opened by{" "}
            {openedBy}
          </p>
        </header>

        <section className="mt-9">
          <SectionLabel>The case, append-only</SectionLabel>
          <div className="mt-4">
            <EventTimeline events={exception.events} />
          </div>
        </section>

        <section className="mt-9">
          <CaseActions exceptionId={exception.id} canMutate={persona.operator !== null} />
        </section>

        <section className="mt-11">
          <SectionLabel>The evidence</SectionLabel>
          <p className="mt-1.5 text-[12.5px] italic text-muted">
            This run’s finding, embedded — not a copy, the same record.
          </p>
          <div className="mt-5">
            {brk !== null && brkRun !== null ? (
              <>
                <EvidenceSpine
                  brk={brk}
                  transaction={transaction}
                  raw={raw}
                  run={{ id: brkRun.id, asOf: brkRun.asOf, rulesetVersion: brkRun.rulesetVersion }}
                />
                <Link
                  href={breakHref(brk.id)}
                  className="mt-4 inline-block text-[12.5px] text-ink hover:underline"
                >
                  Open the full evidence chain →
                </Link>
              </>
            ) : (
              <p className="py-6 text-[13.5px] text-muted">
                This case’s finding predates the demo’s evidence detail. The timeline above is the
                permanent record.
              </p>
            )}
          </div>
        </section>

        <InvestigationPanel exception={exception} />
      </Shell>
    </>
  );
}
