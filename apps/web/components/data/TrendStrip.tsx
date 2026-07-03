import { formatUtcDate } from "@/lib/time";
import { cx } from "@/lib/cx";

export interface TrendPoint {
  runId: string;
  asOf: string;
  breaks: number;
  /** Rose vs the previous run (more breaks) → oxblood; fell → green; first → neutral. */
  rose: boolean | null;
}

/**
 * Breaks across recent runs — a restrained strip, not a decorative chart. Bars
 * are colored by direction (rose = oxblood, fell = green), so the eye reads the
 * story a clean run tells: quiet is the goal state.
 */
export function TrendStrip({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.breaks));
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div>
      <div className="flex h-16 items-end gap-[clamp(4px,1.2vw,10px)] border-b border-hair pb-0.5">
        {points.map((p) => (
          <div
            key={p.runId}
            title={`${formatUtcDate(p.asOf)} · ${p.breaks} breaks`}
            className={cx(
              "min-w-0 max-w-[26px] flex-1",
              p.rose === false ? "bg-matched" : p.breaks === 0 ? "bg-hair" : "bg-break",
            )}
            style={{ height: `${Math.max(3, Math.round((p.breaks / max) * 56))}px` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="font-mono">{first && formatUtcDate(first.asOf).slice(5)}</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[7px] w-[7px] bg-break" />
            rose
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[7px] w-[7px] bg-matched" />
            fell
          </span>
        </span>
        <span className="font-mono">{last && formatUtcDate(last.asOf).slice(5)}</span>
      </div>
    </div>
  );
}
