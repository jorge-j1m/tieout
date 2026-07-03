import { cx } from "@/lib/cx";

/** The page measure: 1280px, gutters that breathe from 20px to 40px. */
export function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto w-full max-w-[1280px] px-[clamp(20px,5vw,40px)]", className)}>
      {children}
    </div>
  );
}
