import { cx } from "@/lib/cx";

/**
 * A state, worn as letterspaced small caps in its token color. The label is
 * always text — color is never the only signal (brief: accessibility bar).
 */
export type ChipTone = "break" | "matched" | "pending" | "muted";

const TONE_CLASS: Record<ChipTone, string> = {
  break: "text-break",
  matched: "text-matched",
  pending: "text-pending",
  muted: "text-muted",
};

export function StateChip({
  tone,
  label,
  className,
}: {
  tone: ChipTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "text-xs font-semibold uppercase tracking-[0.06em]",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
