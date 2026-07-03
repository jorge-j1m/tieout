import { CopyButton } from "@/components/primitives/CopyButton";
import { Mono } from "@/components/primitives/Mono";
import { shortId } from "@/lib/ids";

/** Render a jsonb payload verbatim: pretty-print objects, show strings as-is. */
function payloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}

/**
 * The raw record, byte-for-byte as received — the bottom of every provenance
 * chain. Captioned plainly, its content hash copyable so a reviewer can tie the
 * bytes on screen to the bytes on file.
 */
export function PayloadViewer({ payload, contentHash }: { payload: unknown; contentHash: string }) {
  return (
    <figure className="m-0">
      <pre className="overflow-x-auto border border-hair bg-wash/40 p-4 font-mono text-xs leading-relaxed text-ink">
        {payloadText(payload)}
      </pre>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="italic">exactly as received</span>
        <span>
          content hash <Mono className="text-ink">{shortId(contentHash)}…</Mono>
        </span>
        <CopyButton value={contentHash} />
      </figcaption>
    </figure>
  );
}
