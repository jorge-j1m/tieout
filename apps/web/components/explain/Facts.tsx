import { Mono } from "@/components/primitives/Mono";

/**
 * A definition grid for record facts — label left, value right, hairline rows.
 * The financial-statement way to lay out "field: value" without a table.
 */
export function Facts({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-0 text-sm">
      {rows.map(({ label, value }, i) => (
        <div key={i} className="contents">
          <dt className="border-t border-hair py-2 text-muted">{label}</dt>
          <dd className="border-t border-hair py-2 text-right text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A short mono identity token, e.g. `stripe / acct_mercadia / txn_re_0014`. */
export function Identity({ parts }: { parts: string[] }) {
  return <Mono className="text-ink">{parts.join(" / ")}</Mono>;
}
