import { DoubleRule } from "@/components/primitives/DoubleRule";

/**
 * The brand's empty state: a clean run is an achievement, and the double rule —
 * bookkeeping for "tied out" — says so. Used wherever a worklist comes up clear;
 * `rule={false}` keeps the layout for empties that aren't brand moments
 * (nothing acknowledged yet is neutral, not an achievement).
 */
export function EmptyTiedOut({ children, rule = true }: { children?: React.ReactNode; rule?: boolean }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="text-lg text-ink">{children ?? "Everything tied out."}</p>
      {rule && <DoubleRule className="mt-3 w-24" />}
    </div>
  );
}
