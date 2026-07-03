"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Shell } from "@/components/primitives/Shell";

const KEY = "tieout-banner-dismissed";

/**
 * The first-visit moment: a slim, dismissable banner (never a modal tour) that
 * points the visitor at one break to follow. Renders by default and hides once
 * dismissed — the dismissal persists in localStorage.
 */
export function FirstVisitBanner({
  breaksCount,
  followHref,
}: {
  breaksCount: number;
  followHref: Route;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "1") setDismissed(true);
    } catch {
      // no storage (private mode) — the banner simply won't persist its dismissal
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border-b border-hair">
      <Shell className="flex items-center justify-between gap-4 py-3.5">
        <p className="m-0 max-w-3xl text-sm leading-relaxed text-ink">
          You&rsquo;re watching <strong className="font-semibold">Mercadia</strong>, a synthetic
          marketplace reconciled nightly against Stripe and its settlement PSP. Last night,{" "}
          <strong className="font-semibold">{breaksCount} things didn&rsquo;t tie out</strong>.{" "}
          <Link href={followHref} className="font-semibold text-ink">
            Follow one →
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 cursor-pointer rounded-[2px] border border-hair px-2.5 py-1.5 text-xs text-muted hover:border-ink hover:text-ink"
        >
          Dismiss
        </button>
      </Shell>
    </div>
  );
}
