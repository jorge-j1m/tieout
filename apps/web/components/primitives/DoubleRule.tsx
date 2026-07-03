import { cx } from "@/lib/cx";

/**
 * The brand mark's device: in bookkeeping, a double underline beneath a number
 * means *final, tied out*. Heavy rule over light rule; purely decorative to
 * assistive tech. Reprise it wherever something fully reconciles.
 */
export function DoubleRule({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx("block", className ?? "w-14")}>
      <span className="mb-[2px] block h-[2px] bg-ink" />
      <span className="block h-px bg-ink" />
    </span>
  );
}
