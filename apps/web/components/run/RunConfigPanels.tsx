import type { RunConfig } from "@tieout/contracts";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { sourceLabel } from "@/lib/explain/labels";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A millisecond span in its most natural whole unit: `2d`, `36h`, else minutes. */
function formatSpan(ms: number): string {
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  return `${Math.round(ms / 60_000)}m`;
}

/** A labelled fact in a config panel: muted term, monospace value. */
function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair py-2 last:border-b-0">
      <span className="text-[13px] text-muted">{term}</span>
      <span className="font-mono text-[13px] text-ink">{children}</span>
    </div>
  );
}

/**
 * The rules this run reconciled under, read straight off the record it saved so
 * the run stays self-describing and reproducible (D8). Two panels: the matching
 * tolerances, and the FX rates the run fixed for the whole pass (D7). No cross-
 * currency legs, or an older run that saved no config, simply shows less.
 */
export function RunConfigPanels({ config }: { config: RunConfig }) {
  const lagEntries = Object.entries(config.lagMsBySource ?? {});
  return (
    <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
      <div>
        <SectionLabel className="mb-1">Tolerances</SectionLabel>
        {/* The tolerance applies per compared currency pair, so it has no single
            currency — state it in minor units rather than mislabel it. */}
        <Row term="Amount tolerance">{config.toleranceMinor} minor units</Row>
        <Row term="Date window">±{formatSpan(config.windowMs)}</Row>
        {config.duplicateWindowMs !== null && (
          <Row term="Duplicate window">{formatSpan(config.duplicateWindowMs)}</Row>
        )}
        {config.fxToleranceBps !== null && <Row term="FX tolerance">±{config.fxToleranceBps} bps</Row>}
        {lagEntries.length > 0 ? (
          lagEntries.map(([source, ms]) => (
            <Row key={source} term={`Settlement lag · ${sourceLabel(source)}`}>
              {formatSpan(ms)}
            </Row>
          ))
        ) : (
          <Row term="Settlement lag">none configured</Row>
        )}
      </div>

      <div>
        <SectionLabel className="mb-1">FX rates used</SectionLabel>
        {config.fxRates.length > 0 ? (
          <>
            {config.fxRates.map((fx) => (
              <Row key={`${fx.base}/${fx.quote}`} term={`${fx.base}/${fx.quote}`}>
                {fx.rate}
                <span className="ml-2 text-[11.5px] text-muted">
                  {fx.rateSource} · {fx.rateDate}
                </span>
              </Row>
            ))}
            <p className="mt-2 text-[12.5px] italic text-muted">
              One rate per pair, fixed for the whole run.
            </p>
          </>
        ) : (
          <p className="py-2 text-[13px] text-muted">No cross-currency legs this run.</p>
        )}
      </div>
    </div>
  );
}
