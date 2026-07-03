import Link from "next/link";
import { cx } from "@/lib/cx";
import { exceptionsHref } from "@/lib/routes";

export const EXCEPTION_TABS = ["open", "acknowledged", "resolved", "reopened"] as const;
export type ExceptionTab = (typeof EXCEPTION_TABS)[number];

/** Narrow a raw `?status=` value to a known worklist tab, defaulting to open. */
export function asExceptionTab(raw: string | undefined): ExceptionTab {
  return EXCEPTION_TABS.includes(raw as ExceptionTab) ? (raw as ExceptionTab) : "open";
}

const LABEL: Record<ExceptionTab, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  reopened: "Reopened",
};

/**
 * The worklist's four views. `reopened` is a lifecycle filter, not a fourth
 * status — a case that came back after someone resolved it. Plain links, so each
 * view is shareable and the browser's history just works.
 */
export function ExceptionTabs({
  active,
  counts,
}: {
  active: ExceptionTab;
  counts: Record<ExceptionTab, number>;
}) {
  return (
    <div className="flex flex-wrap gap-6 border-b border-hair" role="tablist">
      {EXCEPTION_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={exceptionsHref(tab === "open" ? undefined : tab)}
            role="tab"
            aria-selected={isActive}
            className={cx(
              "-mb-px border-b-2 pb-2.5 text-sm no-underline",
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
