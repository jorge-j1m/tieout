import Link from "next/link";
import { DoubleRule } from "@/components/primitives/DoubleRule";
import { Shell } from "@/components/primitives/Shell";
import { getPersona } from "@/lib/session";
import { CommandSearch } from "./CommandSearch";
import { NavLinks } from "./NavLinks";
import { PersonaMenu } from "./PersonaMenu";

/**
 * Global chrome: wordmark (its underline is the double rule — final, tied out),
 * primary nav, ⌘K, and the persona chip. The chip reflects the real session
 * resolved server-side (D36), so it can never claim an operator the API wouldn't.
 */
export async function TopBar() {
  const { operator } = await getPersona();
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
            <PersonaMenu operator={operator} />
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
