"use client";

import Link from "next/link";
import { parseCiteHref } from "@/lib/investigate/cite";
import { citationHref } from "@/lib/routes";
import { useCiteScope } from "./citation-context";

/**
 * An inline reference mark (D38). Every `a` in Clara's markdown passes through
 * here: a `cite:` link whose id she verifiably consulted becomes a real in-app
 * link with a superscript mark; a verified-but-page-less record (a transaction or
 * raw with no break context) becomes an unlinked mark; anything else — an
 * unverified id, an outside link — degrades to plain text. A citation is a
 * receipt, never a fabricated link.
 */
export function RecordCite({ href, children }: { href?: string; children?: React.ReactNode }) {
  const ref = parseCiteHref(href);
  const { verified, breakId } = useCiteScope();

  if (ref === null || !verified.has(ref.id)) return <>{children}</>;

  const to = citationHref(ref.kind, ref.id, breakId);
  const mark = (
    <sup aria-hidden className="ml-[1px] text-[0.65em] text-muted">
      ◇
    </sup>
  );
  const title = `${ref.kind} ${ref.id}`;

  if (to === null) {
    return (
      <span
        className="underline decoration-hair decoration-dotted underline-offset-2"
        title={title}
      >
        {children}
        {mark}
      </span>
    );
  }
  return (
    <Link
      href={to}
      title={title}
      className="text-ink underline decoration-hair underline-offset-2 hover:decoration-ink"
    >
      {children}
      {mark}
    </Link>
  );
}
