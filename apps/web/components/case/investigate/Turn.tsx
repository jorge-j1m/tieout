import type { ReactNode } from "react";
import { UtcTime } from "@/components/primitives/UtcTime";
import {
  consultedFromParts,
  liveVerifiedIds,
  textOf,
  traceFromParts,
  type InvestigationMeta,
  type InvestigationUIMessage,
} from "@/lib/investigate/present";
import { ClaraAnswer } from "./ClaraAnswer";
import { LiveTrace } from "./LiveTrace";
import { Receipts } from "./Receipts";

/**
 * One turn in the shared case file — not a chat bubble. An attributed entry down
 * one column, the way an auditor annotates a case: a small-caps author and a UTC
 * timestamp, matching the append-only timeline exactly, so the conversation and
 * the case history read as the same document. Clara's turns wear the dashed
 * margin rule — unmistakably commentary, never the record.
 */
export function Turn({
  message,
  streaming,
  operatorName,
  assistantName,
  breakId,
  seededIds,
  controls,
}: {
  message: InvestigationUIMessage;
  streaming: boolean;
  operatorName: string;
  assistantName: string;
  breakId?: string;
  seededIds: string[];
  controls?: ReactNode;
}) {
  const meta = message.metadata as InvestigationMeta | undefined;
  const text = textOf(message);
  const isClara = message.role === "assistant";
  const author = meta?.authorName ?? (isClara ? assistantName : operatorName);

  return (
    <div className="relative pl-6">
      <span aria-hidden className="absolute left-0 top-[3px] text-[13px] leading-none text-ink">
        {isClara ? "◇" : <span className="inline-block h-[7px] w-[7px] translate-y-[3px] rounded-full bg-ink" />}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink">{author}</span>
        {isClara && <span className="text-[11px] text-muted">assistant</span>}
        {meta?.createdAt !== undefined && <UtcTime iso={meta.createdAt} className="text-xs text-muted" />}
      </div>

      {isClara ? (
        <div className="mt-1.5 border-l-2 border-dashed border-hair pl-4">
          <ClaraAnswer text={text} verified={verifiedFor(message, seededIds, meta)} breakId={breakId} streaming={streaming} />
          {streaming ? (
            <LiveTrace calls={traceFromParts(message.parts)} />
          ) : (
            <Receipts consulted={meta?.citations ?? consultedFromParts(message.parts)} breakId={breakId} />
          )}
          {!streaming && meta?.model != null && (
            <p className="mt-2 text-[11px] text-muted">{meta.model}</p>
          )}
          {controls}
        </div>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{text}</p>
          {controls}
        </>
      )}
    </div>
  );
}

/** Verified set for this turn: the persisted citations, or — mid-stream — the ids tools returned. */
function verifiedFor(
  message: InvestigationUIMessage,
  seededIds: string[],
  meta: InvestigationMeta | undefined,
): Set<string> {
  if (meta?.citations !== undefined) return new Set(meta.citations.map((c) => c.id));
  return liveVerifiedIds(message.parts, seededIds);
}
