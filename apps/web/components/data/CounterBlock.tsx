import { DoubleRule } from "@/components/primitives/DoubleRule";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { cx } from "@/lib/cx";

export type CounterTone = "ink" | "break" | "pending";

const TONE: Record<CounterTone, string> = {
  ink: "text-ink",
  break: "text-break",
  pending: "text-pending",
};

/**
 * A financial-statement counter: small-caps label, a large monospace number,
 * a quiet sub-line. `tied` draws the double rule beneath the figure — reserved
 * for the matched count, the screen's one note of achievement.
 */
export function CounterBlock({
  label,
  value,
  unit,
  tone = "ink",
  sub,
  tied = false,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: CounterTone;
  sub?: React.ReactNode;
  tied?: boolean;
}) {
  return (
    <div className="flex-1 basis-52 py-6">
      <SectionLabel>{label}</SectionLabel>
      <div className={cx("figures mt-2.5 text-[clamp(32px,4.2vw,44px)] leading-none", TONE[tone])}>
        {value}
        {unit !== undefined && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </div>
      {tied && <DoubleRule className="mt-3 w-14" />}
      {sub !== undefined && <div className="mt-2.5 text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}
