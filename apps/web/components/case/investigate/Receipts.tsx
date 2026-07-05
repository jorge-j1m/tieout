import Link from "next/link";
import type { Citation } from "@tieout/contracts";
import { citationHref } from "@/lib/routes";

/**
 * The settled state of the live trace: "Records consulted" — every record Clara
 * verifiably read this turn. These are the receipts behind her answer; the ones
 * with a page link into the evidence chain, the rest name the record plainly.
 */
export function Receipts({ consulted, breakId }: { consulted: Citation[]; breakId?: string }) {
  if (consulted.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
      <span className="label-caps normal-case tracking-[0.04em]">Records consulted</span>
      {consulted.map((c, i) => {
        const to = citationHref(c.kind, c.id, breakId);
        return (
          <span key={c.id} className="text-muted">
            {to !== null ? (
              <Link href={to} className="text-ink underline decoration-hair underline-offset-2 hover:decoration-ink">
                {c.label}
              </Link>
            ) : (
              <span title={`${c.kind} ${c.id}`}>{c.label}</span>
            )}
            {i < consulted.length - 1 && <span aria-hidden className="text-hair"> · </span>}
          </span>
        );
      })}
    </div>
  );
}
