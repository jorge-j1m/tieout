"use client";

import { useEffect } from "react";
import { DoubleRule } from "@/components/primitives/DoubleRule";
import { Shell } from "@/components/primitives/Shell";

/**
 * The error boundary, in the domain's voice. A view failing is not the record
 * failing — the permanent record is append-only and untouched; this is just the
 * page that couldn't read it. Offers a retry, and logs the digest for triage.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell className="py-24">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-xl text-ink">This view didn’t tie out.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          The record itself is safe — it’s append-only and nothing here writes to it. The page just
          couldn’t read it. Try again; if it persists, the API may be down.
        </p>
        <div className="mt-6 flex items-center justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-[2px] border border-ink bg-ink px-4 py-2 text-sm text-paper hover:opacity-90"
          >
            Try again
          </button>
        </div>
        {error.digest !== undefined && (
          <p className="mt-6 font-mono text-[11.5px] text-muted">ref {error.digest}</p>
        )}
        <div className="mt-8 flex justify-center">
          <DoubleRule className="w-14 opacity-40" />
        </div>
      </div>
    </Shell>
  );
}
