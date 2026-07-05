import { Mono } from "@/components/primitives/Mono";
import { shortId } from "@/lib/ids";
import { toolVerb, type TraceCall } from "@/lib/investigate/present";
import { cx } from "@/lib/cx";

/**
 * The live provenance spine (D38's signature): as Clara calls tools, each opens
 * as a ticking line — small-caps verb, mono id — drawn in with the house
 * `hop-draw` motion (held still under reduced-motion). It is the record being
 * consulted, in real time; when the answer settles it becomes the receipts line.
 */
export function LiveTrace({ calls }: { calls: TraceCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ol className="mt-2 list-none space-y-1">
      {calls.map((call, i) => (
        <li
          key={i}
          style={{ ["--hop-index" as string]: i }}
          className="hop-draw flex items-baseline gap-2 text-[12px]"
        >
          <span
            aria-hidden
            className={cx(
              "h-[5px] w-[5px] shrink-0 translate-y-[-1px] rounded-full",
              call.done ? "bg-muted" : "bg-hair",
            )}
          />
          <span className="label-caps normal-case tracking-[0.04em] text-muted">
            {toolVerb(call.tool)}
          </span>
          {call.ref !== null && <Mono className="text-muted">{shortId(call.ref)}</Mono>}
          {!call.done && <span className="text-muted">…</span>}
        </li>
      ))}
    </ol>
  );
}
