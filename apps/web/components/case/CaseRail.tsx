import Link from "next/link";
import type { ExceptionDetail } from "@tieout/contracts";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { StateChip, type ChipTone } from "@/components/primitives/StateChip";
import { ActionButtons } from "./ActionButtons";
import { EventTimeline } from "./EventTimeline";
import { TriageMargin } from "./TriageMargin";

const STATUS_TONE: Record<ExceptionDetail["status"], ChipTone> = {
  open: "break",
  acknowledged: "pending",
  resolved: "matched",
};

/**
 * The human side of a break: the exception case. Status, how many runs have seen
 * it, its append-only history, the operator actions, and — set apart — Claude's
 * margin note. Reads only; the write path is the exceptions workflow (Phase 3).
 */
export function CaseRail({
  exception,
  canMutate,
}: {
  exception: ExceptionDetail | null;
  canMutate: boolean;
}) {
  if (exception === null) {
    return (
      <aside className="border-t border-hair pt-4 text-sm text-muted">
        No exception is tracking this break yet.
      </aside>
    );
  }
  const latestTriage = exception.triageSuggestions[0];
  return (
    <aside className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>The case</SectionLabel>
          <Link href={`/exceptions/${exception.id}`} className="text-xs text-muted hover:text-ink">
            open case →
          </Link>
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <StateChip tone={STATUS_TONE[exception.status]} label={exception.status} />
          <span className="text-sm text-muted">
            seen in {exception.seenInRuns} {exception.seenInRuns === 1 ? "run" : "runs"}
          </span>
        </div>
      </div>

      <div>
        <SectionLabel>History</SectionLabel>
        <div className="mt-3">
          <EventTimeline events={exception.events} />
        </div>
      </div>

      <ActionButtons canMutate={canMutate} />

      {latestTriage !== undefined && <TriageMargin suggestion={latestTriage} />}
    </aside>
  );
}
