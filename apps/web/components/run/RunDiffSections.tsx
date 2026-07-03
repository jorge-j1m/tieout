import Link from "next/link";
import type { RunDiff } from "@tieout/contracts";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { StateChip, type ChipTone } from "@/components/primitives/StateChip";
import { TYPE_LABEL } from "@/lib/explain/labels";
import { shortId } from "@/lib/ids";
import { exceptionHref } from "@/lib/routes";

type Entry = RunDiff["appeared"][number];

/** One movement between two runs: the case that opened, closed itself, or came back. */
function DiffRow({ entry, tone }: { entry: Entry; tone: ChipTone }) {
  return (
    <Link
      href={exceptionHref(entry.exceptionId)}
      className="flex items-baseline justify-between gap-4 border-b border-hair py-3 no-underline hover:bg-wash"
    >
      <span className="flex items-baseline gap-3">
        <StateChip tone={tone} label={TYPE_LABEL[entry.type]} />
        <span className="font-mono text-xs text-muted">case {shortId(entry.exceptionId)}</span>
      </span>
      <span className="text-xs text-muted">View case →</span>
    </Link>
  );
}

function DiffSection({
  label,
  entries,
  tone,
  caption,
}: {
  label: string;
  entries: Entry[];
  tone: ChipTone;
  caption?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex items-baseline gap-3 border-b border-ink pb-2">
        <SectionLabel>{label}</SectionLabel>
        <span className="figures text-sm text-muted">{entries.length}</span>
      </div>
      {caption !== undefined && <p className="mt-2 text-[13px] italic text-muted">{caption}</p>}
      <div className="mt-1">
        {entries.map((entry) => (
          <DiffRow key={entry.exceptionId} entry={entry} tone={tone} />
        ))}
      </div>
    </section>
  );
}

/**
 * How this run differs from the one before it — the audit story of movement.
 * Cases that first appeared, cases the books quietly fixed, and cases that came
 * back. Each links to its full history; the counts are the headline.
 */
export function RunDiffSections({ diff }: { diff: RunDiff }) {
  const empty = diff.appeared.length + diff.reopened.length + diff.selfResolved.length === 0;
  if (empty) {
    return <p className="py-6 text-sm text-muted">Nothing changed from the previous run.</p>;
  }
  return (
    <div>
      <DiffSection label="Appeared" entries={diff.appeared} tone="break" />
      <DiffSection
        label="Self-resolved"
        entries={diff.selfResolved}
        tone="matched"
        caption="The books were fixed; the case closed itself."
      />
      <DiffSection label="Reopened" entries={diff.reopened} tone="break" />
    </div>
  );
}
