import { cx } from "@/lib/cx";

/** Ids, hashes, references: monospace, verbatim. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("font-mono", className)}>{children}</span>;
}
