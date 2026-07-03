import { LinkTabs } from "@/components/primitives/LinkTabs";
import { asMember } from "@/lib/enums";
import { runTabHref } from "@/lib/routes";

export const RUN_TABS = ["matches", "breaks", "diff"] as const;
export type RunTab = (typeof RUN_TABS)[number];

/** Narrow a raw `?tab=` value to a known tab, defaulting to matches. */
export function asRunTab(raw: string | undefined): RunTab {
  return asMember(RUN_TABS, raw) ?? "matches";
}

const LABEL: Record<RunTab, string> = {
  matches: "Matches",
  breaks: "Breaks",
  diff: "Diff vs previous",
};

/** The run's three views, selected by `?tab=`. */
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
    <LinkTabs
      active={active}
      tabs={RUN_TABS.map((tab) => ({
        key: tab,
        label: LABEL[tab],
        href: runTabHref(runId, tab),
        count: counts[tab],
      }))}
    />
  );
}
