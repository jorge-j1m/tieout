import type { QuarantineRow } from "@tieout/contracts";
import { Mono } from "@/components/primitives/Mono";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { StateChip } from "@/components/primitives/StateChip";
import { UtcTime } from "@/components/primitives/UtcTime";
import { sourceLabel } from "@/lib/explain/labels";
import { declaredFooter, isWholeBatch, quarantineReasons, quarantineTitle } from "@/lib/quarantine";

/** The settlement currency of the source whose footer we're showing, when known. */
const SOURCE_CURRENCY: Record<string, string> = { pagolat: "MXN" };

/** A declared footer figure: verbatim string, currency-suffixed where known. */
function Figure({ value, currency }: { value: string; currency: string }) {
  return (
    <Mono className="text-ink">
      {value}
      {currency !== "" && <span className="text-muted"> {currency}</span>}
    </Mono>
  );
}

function DeclaredRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair py-1.5 text-[13.5px] last:border-b-0">
      <span className="text-muted">{term}</span>
      {children}
    </div>
  );
}

/**
 * One held record. The engine kept it because the file contradicts itself — the
 * declared footer says one thing, the lines another — so the record is preserved
 * whole and shown exactly as received. Nothing here was coerced or discarded.
 */
export function QuarantineCard({ row }: { row: QuarantineRow }) {
  const reasons = quarantineReasons(row.errors);
  const footer = declaredFooter(row.payload);
  const currency = SOURCE_CURRENCY[row.source] ?? "";

  return (
    <article>
      <div className="border-b border-hair pb-6">
        <StateChip tone="pending" label={isWholeBatch(row) ? "held whole" : "line held"} />
        <div className="mt-3.5 font-mono text-[clamp(18px,2.4vw,22px)] text-ink">
          {quarantineTitle(row)}
        </div>
        <div className="mt-1.5 text-[13px] text-muted">
          {sourceLabel(row.source)} · landed <UtcTime iso={row.observedAt} className="text-muted" />
        </div>
      </div>

      {footer !== null && (
        <section className="mt-8">
          <SectionLabel>Declared (file footer)</SectionLabel>
          <p className="mt-1.5 mb-3 text-[12.5px] italic text-muted">
            The file’s own claims — which the lines don’t bear out.
          </p>
          <div className="max-w-md">
            {footer.lineCount !== null && (
              <DeclaredRow term="Line count">
                <Mono className="text-ink">{footer.lineCount}</Mono>
              </DeclaredRow>
            )}
            {footer.totalNet !== null && (
              <DeclaredRow term="Total net">
                <Figure value={footer.totalNet} currency={currency} />
              </DeclaredRow>
            )}
            {footer.openingBalance !== null && (
              <DeclaredRow term="Opening balance">
                <Figure value={footer.openingBalance} currency={currency} />
              </DeclaredRow>
            )}
            {footer.closingBalance !== null && (
              <DeclaredRow term="Closing balance">
                <Figure value={footer.closingBalance} currency={currency} />
              </DeclaredRow>
            )}
          </div>
        </section>
      )}

      {reasons.length > 0 && (
        <section className="mt-8">
          <SectionLabel>Why it’s held</SectionLabel>
          <div className="mt-3 border-t border-hair">
            {reasons.map((reason, i) => (
              <div key={i} className="flex gap-3 border-b border-hair py-2.5 text-[13.5px] leading-relaxed">
                <span aria-hidden className="text-break">
                  ·
                </span>
                <span className="text-ink">
                  {reason.message}
                  {reason.path !== "" && <Mono className="ml-2 text-[11.5px] text-muted">{reason.path}</Mono>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <SectionLabel>As received</SectionLabel>
        <p className="mt-1.5 mb-3 text-[12.5px] italic text-muted">exactly as it landed</p>
        <pre className="overflow-x-auto border border-hair bg-wash/40 p-4 font-mono text-xs leading-relaxed text-ink">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </section>
    </article>
  );
}
