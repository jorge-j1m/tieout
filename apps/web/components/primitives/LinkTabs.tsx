import Link from "next/link";
import type { Route } from "next";
import { cx } from "@/lib/cx";

export interface LinkTab {
  key: string;
  label: string;
  href: Route;
  count: number;
}

/**
 * A bar of tabs that are plain links: server-rendered, shareable, back-button
 * friendly. Counts ride the labels so the bar doubles as a summary. Every
 * tabbed view (run detail, exceptions) is this one component with its own tabs.
 */
export function LinkTabs({ tabs, active }: { tabs: LinkTab[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-6 border-b border-hair" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={cx(
              "-mb-px border-b-2 pb-2.5 text-sm no-underline",
              isActive ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
            <span className="figures ml-1.5 text-xs text-muted">{tab.count}</span>
          </Link>
        );
      })}
    </div>
  );
}
