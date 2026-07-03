import Link from "next/link";
import { Shell } from "@/components/primitives/Shell";
import { shortId } from "@/lib/ids";
import { formatUtc } from "@/lib/time";

/**
 * Every data view states its watermark: which run, as of when, under which
 * ruleset. Rendered by each page beneath the top bar — the page knows its run.
 */
export function RunContextLine({
  runId,
  asOf,
  ruleset,
}: {
  runId: string;
  asOf: string;
  ruleset: string;
}) {
  return (
    <div className="border-b border-hair">
      <Shell className="py-[9px]">
        <span className="font-mono text-xs text-muted">
          run{" "}
          <Link href={`/runs/${runId}`} className="text-ink underline">
            {shortId(runId)}
          </Link>{" "}
          · as of {formatUtc(asOf)} · {ruleset}
        </span>
      </Shell>
    </div>
  );
}
