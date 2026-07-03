import Link from "next/link";
import { DoubleRule } from "@/components/primitives/DoubleRule";
import { Shell } from "@/components/primitives/Shell";
import { CommandSearch } from "./CommandSearch";
import { NavLinks } from "./NavLinks";

/**
 * Global chrome: wordmark (its underline is the double rule — final, tied out),
 * primary nav, ⌘K, and the persona chip. The chip is a static demo label until
 * the operator session lands (Phase 3 wires the real persona).
 */
export function TopBar() {
  return (
    <header className="border-b border-hair bg-paper">
      <Shell>
        {/* top row: identical on both breakpoints except height */}
        <div className="flex h-14 items-center justify-between gap-7 md:h-16">
          <div className="flex items-center gap-6 md:gap-11">
            <Link href="/" className="inline-flex w-fit flex-col gap-1 no-underline">
              <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink md:text-[19px]">
                tieout
              </span>
              <DoubleRule className="w-full" />
            </Link>
            <div className="hidden md:block">
              <NavLinks variant="desktop" />
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3.5">
            <CommandSearch />
            <Link
              href="/login"
              className="rounded-[2px] border border-hair bg-paper px-3 py-1.5 text-[13px] text-ink no-underline hover:border-ink"
            >
              <span className="hidden md:inline">CFO · read-only demo</span>
              <span className="md:hidden">Demo</span>
            </Link>
          </div>
        </div>
        {/* mobile: nav scrolls beneath the bar */}
        <div className="md:hidden">
          <NavLinks variant="mobile" />
        </div>
      </Shell>
    </header>
  );
}
