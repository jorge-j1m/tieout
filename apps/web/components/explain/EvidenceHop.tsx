import { cx } from "@/lib/cx";

/**
 * One node on the provenance spine: a numbered marker on a hairline rail, a
 * title, and the hop's evidence. Flat panels connected by a line — no cards,
 * no shadows. The number is decorative to assistive tech; the title carries it.
 */
export function EvidenceHop({
  index,
  title,
  children,
  last = false,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li
      className="hop-draw relative pl-10"
      style={{ "--hop-index": index - 1 } as React.CSSProperties}
    >
      {/* the spine: a hairline down the left, cut short on the last hop */}
      {!last && <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-hair" />}
      <span
        aria-hidden
        className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-hair bg-paper font-mono text-xs text-muted"
      >
        {index}
      </span>
      <div className={cx("pb-8", last && "pb-0")}>
        <h2 className="label-caps mb-2.5">{title}</h2>
        {children}
      </div>
    </li>
  );
}
