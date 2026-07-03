"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

/** Overview · Runs · Breaks · Exceptions · Quarantine — the whole information architecture. */
const NAV = [
  { label: "Overview", href: "/" },
  { label: "Runs", href: "/runs" },
  { label: "Breaks", href: "/breaks" },
  { label: "Exceptions", href: "/exceptions" },
  { label: "Quarantine", href: "/quarantine" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The active view carries a 2px ink underline flush with the bar's bottom rule
 * (desktop) — the same gesture as the wordmark's double rule, once.
 */
export function NavLinks({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className={cx(
        "flex items-center",
        variant === "desktop" ? "gap-[26px]" : "gap-[18px] overflow-x-auto pb-2.5",
      )}
    >
      {NAV.map(({ label, href }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap border-b-2 no-underline",
              variant === "desktop" ? "pb-[21px] text-sm" : "shrink-0 pb-2 text-[13px]",
              active
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
