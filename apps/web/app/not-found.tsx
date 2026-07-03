import Link from "next/link";
import { DoubleRule } from "@/components/primitives/DoubleRule";
import { Shell } from "@/components/primitives/Shell";

export const metadata = { title: "Not in the record" };

/**
 * A 404 in the ledger's voice: what you asked for isn't in the record. Reached
 * by `notFound()` when a run, break, exception, or case id names nothing.
 */
export default function NotFound() {
  return (
    <Shell className="py-24">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-xl text-ink">That isn’t in the record.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          No run, break, or case answers to that id. It may have belonged to a dataset that has
          since reset.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="rounded-[2px] border border-ink bg-paper px-4 py-2 text-sm text-ink no-underline hover:bg-wash"
          >
            ← Back to the overview
          </Link>
        </div>
        <div className="mt-8 flex justify-center">
          <DoubleRule className="w-14 opacity-40" />
        </div>
      </div>
    </Shell>
  );
}
