import { LinkTabs } from "@/components/primitives/LinkTabs";
import { asMember } from "@/lib/enums";
import { exceptionsHref } from "@/lib/routes";

export const EXCEPTION_TABS = ["open", "acknowledged", "resolved", "reopened"] as const;
export type ExceptionTab = (typeof EXCEPTION_TABS)[number];

/** Narrow a raw `?status=` value to a known worklist tab, defaulting to open. */
export function asExceptionTab(raw: string | undefined): ExceptionTab {
  return asMember(EXCEPTION_TABS, raw) ?? "open";
}

const LABEL: Record<ExceptionTab, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  reopened: "Reopened",
};

/**
 * The worklist's four views. `reopened` is a lifecycle filter, not a fourth
 * status — a case that came back after someone resolved it.
 */
export function ExceptionTabs({
  active,
  counts,
}: {
  active: ExceptionTab;
  counts: Record<ExceptionTab, number>;
}) {
  return (
    <LinkTabs
      active={active}
      tabs={EXCEPTION_TABS.map((tab) => ({
        key: tab,
        label: LABEL[tab],
        href: exceptionsHref(tab === "open" ? undefined : tab),
        count: counts[tab],
      }))}
    />
  );
}
