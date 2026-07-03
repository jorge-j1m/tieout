import { cx } from "@/lib/cx";

/**
 * A loading placeholder in the ledger's own language: hairline rules that
 * breathe, never gray blocks. `aria-hidden` — a screen reader is told the
 * region is busy by the surrounding `role`, not by these decorative bars.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton-pulse block h-2 rounded-[1px] bg-hair", className)} />;
}

/** A stack of ruled rows, each a faint line — the shape of a table still loading. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("border-t border-hair", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-hair py-4">
          <SkeletonBar className="w-28" />
          <SkeletonBar className="w-1/3" />
          <SkeletonBar className="ml-auto w-16" />
        </div>
      ))}
    </div>
  );
}
