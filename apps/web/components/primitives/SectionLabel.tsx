import { cx } from "@/lib/cx";

/** The financial-statement section label: letterspaced small caps, muted ink. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cx("label-caps", className)}>{children}</div>;
}
