import Link from "next/link";
import { cx } from "@/lib/cx";
import { runTabHref } from "@/lib/routes";

export const RUN_TABS = ["matches", "breaks", "diff"] as const;
export type RunTab = (typeof RUN_TABS)[number];

/** Narrow a raw `?tab=` value to a known tab, defaulting to matches. */
export function asRunTab(raw: string | undefined): RunTab {
  return RUN_TABS.includes(raw as RunTab) ? (raw as RunTab) : "matches";
}

const LABEL: Record<RunTab, string> = {
  matches: "Matches",
  breaks: "Breaks",
  diff: "Diff vs previous",
};

/**
 * The run's three views, selected by `?tab=` — plain links, so each view is
 * server-rendered, shareable, and back-button friendly. Counts ride the label
 * so the tab bar doubles as a summary.
 */
export function RunTabs({
  runId,
  active,
  counts,
}: {
  runId: string;
  active: RunTab;
  counts: Record<RunTab, number>;
}) {
  return (
    <div className="flex flex-wrap gap-6 border-b border-hair" role="tablist">
      {RUN_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={runTabHref(runId, tab)}
            role="tab"
            aria-selected={isActive}
            className={cx(
              "-mb-px border-b-2 pb-2.5 pt-1 text-sm no-underline",
              isActive ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {LABEL[tab]}
            <span className="figures ml-1.5 text-xs text-muted">{counts[tab]}</span>
          </Link>
        );
      })}
    </div>
  );
}
