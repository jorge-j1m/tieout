import type { Break, BreakTxnDetail } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { Mono } from "@/components/primitives/Mono";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { formatMoney } from "@/lib/money";

/**
 * The type-specific comparison panels the explain view shows beneath the primary
 * transaction. Each reads only fields the engine actually records on the break —
 * the record is the source, never invented framing.
 */

const readStr = (d: Break["details"], k: string): string | undefined =>
  typeof d[k] === "string" ? (d[k] as string) : undefined;

const readObj = (d: Break["details"], k: string): Record<string, unknown> | undefined =>
  typeof d[k] === "object" && d[k] !== null ? (d[k] as Record<string, unknown>) : undefined;

function SidePanel({ heading, txn }: { heading: string; txn: BreakTxnDetail }) {
  return (
    <div className="flex-1 border border-hair p-4">
      <SectionLabel>{heading}</SectionLabel>
      <div className="mt-2">
        <Mono className="text-sm text-ink">{txn.sourceId}</Mono>
      </div>
      <div className="mt-3 text-2xl">
        <Money minor={txn.amountMinor} currency={txn.currency} />
      </div>
    </div>
  );
}

/** amount_mismatch: the two sides side by side, the delta stated between them. */
export function AmountMismatchPanel({ brk }: { brk: Break }) {
  const [ledger, source] = brk.details.txns;
  if (ledger === undefined || source === undefined) return null;
  const currency = ledger.currency;
  const delta = (BigInt(ledger.amountMinor) - BigInt(source.amountMinor)).toString();
  const absDelta = delta.startsWith("-") ? delta.slice(1) : delta;
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <SidePanel heading="Ledger" txn={ledger} />
        <SidePanel heading="Source" txn={source} />
      </div>
      <p className="mt-3 text-sm text-break">
        The two sides differ by {formatMoney(absDelta, currency)} — beyond the run&rsquo;s tolerance.
      </p>
    </div>
  );
}

/** duplicate_candidate: the kept primary beside the entry flagged as its duplicate. */
export function DuplicatePanel({ brk }: { brk: Break }) {
  const consumed = brk.details.txns[0];
  const kept = readObj(brk.details, "kept") as BreakTxnDetail | undefined;
  if (consumed === undefined || kept === undefined) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <SidePanel heading="Kept — primary" txn={kept} />
      <SidePanel heading="Flagged — duplicate" txn={consumed} />
    </div>
  );
}

/** fx_drift: the settlement lines, their net at the recorded rate, and the booking. */
export function FxDriftPanel({ brk }: { brk: Break }) {
  const anchorNet = readStr(brk.details, "anchorNetMinor");
  const partsNet = readStr(brk.details, "partsNetMinor");
  const fx = readObj(brk.details, "fx");
  const rate = fx !== undefined && typeof fx.rate === "string" ? fx.rate : undefined;
  const lines = brk.details.txns.filter((t) => t.groupRef !== null);
  const anchor = brk.details.txns.find((t) => t.groupRef === null) ?? brk.details.txns[0];
  const bookingCurrency = anchor?.currency ?? "USD";

  return (
    <div>
      {lines.length > 0 && (
        <ol className="border-t border-hair">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-baseline justify-between border-b border-hair py-2 text-sm"
            >
              <Mono className="text-ink">{line.sourceId}</Mono>
              <Money minor={line.amountMinor} currency={line.currency} />
            </li>
          ))}
        </ol>
      )}
      <dl className="mt-3 space-y-1 text-sm">
        {rate !== undefined && (
          <div className="flex justify-between">
            <dt className="text-muted">Recorded rate</dt>
            <dd className="font-mono text-ink">{rate}</dd>
          </div>
        )}
        {partsNet !== undefined && (
          <div className="flex justify-between">
            <dt className="text-muted">Lines net at that rate</dt>
            <dd>
              <Money minor={partsNet} currency={bookingCurrency} />
            </dd>
          </div>
        )}
        {anchorNet !== undefined && (
          <div className="flex justify-between">
            <dt className="text-muted">Booking records</dt>
            <dd>
              <Money minor={anchorNet} currency={bookingCurrency} />
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-sm text-break">The rate is the suspect.</p>
    </div>
  );
}

/** Dispatch to the right comparison for a break's type, or nothing for the 1-sided types. */
export function VariantPanel({ brk }: { brk: Break }) {
  switch (brk.type) {
    case "amount_mismatch":
      return <AmountMismatchPanel brk={brk} />;
    case "duplicate_candidate":
      return <DuplicatePanel brk={brk} />;
    case "fx_drift":
      return <FxDriftPanel brk={brk} />;
    default:
      return null;
  }
}
