import Link from "next/link";
import type { SourceSummary } from "@tieout/contracts";
import { Mono } from "@/components/primitives/Mono";
import { sourceKind, sourceLabel } from "@/lib/explain/labels";
import { formatUtc } from "@/lib/time";

/** Per-source record counts and last-landed times — the ingestion at a glance. */
export function SourcesStrip({ sources }: { sources: SourceSummary[] }) {
  return (
    <div className="flex flex-wrap border-t border-b border-hair">
      {sources.map((s) => (
        <div key={s.source} className="flex-1 basis-56 border-l border-hair py-4 pl-4 pr-5 first:border-l-0 first:pl-0">
          <Mono className="text-sm font-semibold text-ink">{sourceLabel(s.source)}</Mono>
          <div className="mt-0.5 text-xs text-muted">{sourceKind(s.source)}</div>
          <div className="figures mt-3 text-lg text-ink">
            {s.records} {s.records === 1 ? "record" : "records"}
            {s.batches > 1 && <span className="text-sm text-muted"> · {s.batches} batches</span>}
          </div>
          {s.lastLanded !== null && (
            <div className="mt-1.5 text-[11.5px] text-muted">landed {formatUtc(s.lastLanded)}</div>
          )}
          {s.quarantinedUnits > 0 && (
            <Link href="/quarantine" className="mt-1.5 block text-[11.5px] text-pending">
              {s.quarantinedUnits} unit quarantined →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
