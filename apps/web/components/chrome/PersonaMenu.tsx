"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions";

/**
 * The persona chip and its menu. The label is resolved server-side and passed
 * in — this component only toggles the dropdown and routes to login/logout. For
 * the demo viewer the menu offers the operator login; for an operator, sign-out.
 * Both terminate in server actions or navigation, never client-side auth state.
 */
export function PersonaMenu({ operator }: { operator: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = operator !== null ? `${operator} · operator` : "CFO · read-only demo";
  const shortLabel = operator !== null ? operator : "Demo";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-[2px] border border-hair bg-paper px-3 py-1.5 text-[13px] text-ink hover:border-ink"
      >
        <span className="hidden md:inline">{label}</span>
        <span className="md:hidden">{shortLabel}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[240px] border border-hair bg-paper p-1.5 shadow-[0_4px_14px_rgba(22,19,14,0.08)]"
        >
          <div className="px-2.5 py-2 text-[13px] text-ink">{label}</div>
          <div className="my-1 h-px bg-hair" />
          {operator !== null ? (
            <form action={logout}>
              <button
                type="submit"
                role="menuitem"
                className="block w-full rounded-[2px] px-2.5 py-2 text-left text-[13px] text-muted hover:bg-wash hover:text-ink"
              >
                Log out →
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              role="menuitem"
              className="block rounded-[2px] px-2.5 py-2 text-[13px] text-muted underline hover:bg-wash hover:text-ink"
            >
              Operator login →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
