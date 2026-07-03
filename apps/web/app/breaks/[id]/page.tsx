import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunContextLine } from "@/components/chrome/RunContextLine";
import { CaseRail } from "@/components/case/CaseRail";
import { EvidenceSpine } from "@/components/explain/EvidenceSpine";
import { CopyButton } from "@/components/primitives/CopyButton";
import { Mono } from "@/components/primitives/Mono";
import { Shell } from "@/components/primitives/Shell";
import { StateChip } from "@/components/primitives/StateChip";
import {
  getBreak,
  getExceptionByFingerprint,
  getRaw,
  getRun,
  getTransaction,
} from "@/lib/api/endpoints";
import { GLOSS, TYPE_LABEL } from "@/lib/explain/labels";
import { headlineFor } from "@/lib/explain/present";
import { shortId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { getPersona } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const brk = await getBreak((await params).id);
  return { title: brk ? TYPE_LABEL[brk.type] : "Break" };
}

/** The break-explain view — the demo's climax and the product's reason to exist. */
export default async function BreakExplainPage({ params }: { params: Promise<{ id: string }> }) {
  const brk = await getBreak((await params).id);
  if (brk === null) notFound();

  const primary = brk.details.txns[0];
  if (primary === undefined) notFound();

  // Fan out the reads that don't depend on each other; the raw record needs the
  // transaction's rawId, so it follows.
  const [transaction, run, exception, persona] = await Promise.all([
    getTransaction(primary.id),
    getRun(brk.runId),
    getExceptionByFingerprint(brk.fingerprint),
    getPersona(),
  ]);
  const raw = transaction !== null ? await getRaw(transaction.rawId) : null;

  const absMinor = primary.amountMinor.startsWith("-")
    ? primary.amountMinor.slice(1)
    : primary.amountMinor;

  return (
    <>
      {run !== null && (
        <RunContextLine runId={run.id} asOf={run.asOf} ruleset={run.rulesetVersion} />
      )}
      <Shell className="py-10">
        <header className="max-w-3xl">
          <StateChip tone="break" label={TYPE_LABEL[brk.type]} />
          <h1 className="mt-3 text-2xl font-semibold leading-tight text-ink md:text-[28px]">
            {GLOSS[brk.type]}
          </h1>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="figures text-2xl text-ink">
              {formatMoney(absMinor, primary.currency)}
            </span>
            <span className="text-sm text-muted">{headlineFor(brk)}</span>
          </div>
          {brk.fingerprint !== null && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span>fingerprint</span>
              <Mono className="text-ink">{shortId(brk.fingerprint)}…</Mono>
              <CopyButton value={brk.fingerprint} />
            </div>
          )}
        </header>

        {/* main column = the evidence chain; right rail = the human case */}
        <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            {run !== null && (
              <EvidenceSpine
                brk={brk}
                transaction={transaction}
                raw={raw}
                run={{ id: run.id, asOf: run.asOf, rulesetVersion: run.rulesetVersion }}
              />
            )}
          </div>
          <CaseRail exception={exception} canMutate={persona.operator !== null} />
        </div>
      </Shell>
    </>
  );
}
