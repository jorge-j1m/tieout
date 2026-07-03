import { SectionLabel } from "@/components/primitives/SectionLabel";
import { Shell } from "@/components/primitives/Shell";
import { SkeletonBar, SkeletonRows } from "@/components/states/Skeleton";

/**
 * The wait between routes. Shown while a server component reads the record —
 * a quiet ruled placeholder, so the page arrives without a flash of empty.
 */
export default function Loading() {
  return (
    <Shell className="py-9 pb-16">
      <div role="status" aria-busy="true" aria-label="Reading the record">
        <SectionLabel>Reading the record…</SectionLabel>
        <SkeletonBar className="mt-4 h-6 w-64" />
        <SkeletonRows className="mt-8" rows={7} />
      </div>
    </Shell>
  );
}
