import { cx } from "@/lib/cx";
import { formatUtc } from "@/lib/time";

/** An instant, UTC-explicit, in a semantic `<time>`. Never local time. */
export function UtcTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={cx("figures", className)}>
      {formatUtc(iso)}
    </time>
  );
}
