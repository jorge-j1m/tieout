import Link from "next/link";
import type { ExceptionEvent, ExceptionEventKind } from "@tieout/contracts";
import type { ChipTone } from "@/components/primitives/StateChip";
import { UtcTime } from "@/components/primitives/UtcTime";
import { shortId } from "@/lib/ids";
import { runHref } from "@/lib/routes";
import { cx } from "@/lib/cx";

const KIND: Record<ExceptionEventKind, { label: string; tone: ChipTone }> = {
  opened: { label: "Opened", tone: "muted" },
  acknowledged: { label: "Acknowledged", tone: "pending" },
  resolved: { label: "Resolved", tone: "matched" },
  self_resolved: { label: "Self-resolved", tone: "matched" },
  reopened: { label: "Reopened", tone: "break" },
};

const TONE_DOT: Record<ChipTone, string> = {
  break: "bg-break",
  matched: "bg-matched",
  pending: "bg-pending",
  muted: "bg-muted",
};

// Literal classes so Tailwind generates them — never build class names by interpolation.
const TONE_TEXT: Record<ChipTone, string> = {
  break: "text-break",
  matched: "text-matched",
  pending: "text-pending",
  muted: "text-muted",
};

/**
 * The append-only history of a case — every acknowledge, resolve, and run-driven
 * reopen, attributed and UTC-stamped. This is the centerpiece: nothing here is
 * ever edited or removed, so the timeline is the whole truth of the case.
 */
export function EventTimeline({ events }: { events: ExceptionEvent[] }) {
  return (
    <ol className="list-none">
      {events.map((event, i) => {
        const kind = KIND[event.kind];
        const last = i === events.length - 1;
        return (
          <li key={event.id} className="relative pl-6">
            {!last && <span aria-hidden className="absolute left-[3px] top-3 bottom-0 w-px bg-hair" />}
            <span
              aria-hidden
              className={cx("absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full", TONE_DOT[kind.tone])}
            />
            <div className={cx("pb-5", last && "pb-0")}>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={cx(
                    "text-xs font-semibold uppercase tracking-[0.06em]",
                    TONE_TEXT[kind.tone],
                  )}
                >
                  {kind.label}
                </span>
                <span className="text-sm text-ink">
                  {event.runId !== null ? (
                    <>
                      by run{" "}
                      <Link href={runHref(event.runId)} className="font-mono text-ink underline">
                        {shortId(event.runId)}
                      </Link>
                    </>
                  ) : (
                    <>by {event.actor}</>
                  )}
                </span>
                <UtcTime iso={event.createdAt} className="text-xs text-muted" />
              </div>
              {event.note !== null && <p className="mt-1 text-sm text-ink">“{event.note}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
