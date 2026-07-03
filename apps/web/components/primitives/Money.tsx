import { cx } from "@/lib/cx";
import { formatMoney } from "@/lib/money";

/**
 * An amount, exactly as the record states it: tabular monospace figures,
 * currency-explicit, never rounded (D5). Right-alignment belongs to the table
 * cell; the sacredness belongs here.
 */
export function Money({
  minor,
  currency,
  className,
}: {
  minor: string | bigint;
  currency: string;
  className?: string;
}) {
  return <span className={cx("figures", className)}>{formatMoney(minor, currency)}</span>;
}
