import { LEDGER_SOURCE, type MatchWithMembers } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { Mono } from "@/components/primitives/Mono";
import { StateChip } from "@/components/primitives/StateChip";
import { cx } from "@/lib/cx";
import { MATCH_KIND_LABEL, sourceLabel } from "@/lib/explain/labels";

type Member = MatchWithMembers["members"][number];

/**
 * Read a scalar off a match's untyped `details` bag. Grouped matches record
 * their group key, converted sums, and applied FX rate here; the reader stays
 * defensive because the bag's shape is per-kind, not schema-fixed.
 */
function str(details: Record<string, unknown> | null, key: string): string | null {
  const v = details?.[key];
  return typeof v === "string" ? v : null;
}

/** The FX rate a grouped cross-currency match applied, if it recorded one. */
function fxRate(details: Record<string, unknown> | null): string | null {
  const fx = details?.["fx"];
  const one = Array.isArray(fx) ? fx[0] : fx;
  if (one !== null && typeof one === "object" && "rate" in one) {
    const rate = (one as { rate: unknown }).rate;
    return typeof rate === "string" ? rate : null;
  }
  return null;
}

/** The ledger anchor and the external counterpart(s) a match tied together. */
function sides(members: Member[]): { ledger: Member | undefined; external: Member[] } {
  const ledger = members.find((m) => m.source === LEDGER_SOURCE);
  return { ledger, external: members.filter((m) => m !== ledger) };
}

/** How the external side reads on the summary line: an id, or "N PagoLat lines". */
function externalLabel(external: Member[]): string {
  const first = external[0];
  if (first === undefined) return "—";
  if (external.length === 1) return first.sourceId;
  return `${external.length} ${sourceLabel(first.source)} lines`;
}

/** The lines of a grouped match, each in its native currency, plus the tied net. */
function GroupedMembers({
  external,
  details,
  netCurrency,
}: {
  external: Member[];
  details: Record<string, unknown> | null;
  /** The anchor's currency — the converted net is stated in it, never assumed. */
  netCurrency: string | undefined;
}) {
  const partsNet = str(details, "partsNetMinor");
  const rate = fxRate(details);
  return (
    <div className="mt-3 border-l border-hair pl-4">
      {external.map((m) => (
        <div key={m.transactionId} className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
          <Mono className="text-muted">{m.sourceId}</Mono>
          <Money minor={m.amountMinor} currency={m.currency} className="text-ink" />
        </div>
      ))}
      {partsNet !== null && netCurrency !== undefined && (
        <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-hair pt-1.5 text-[13px]">
          <span className="text-muted">
            {external.length} lines net{rate !== null && <span> · at {rate}</span>}
          </span>
          <Money minor={partsNet} currency={netCurrency} className="text-ink" />
        </div>
      )}
    </div>
  );
}

const CITES = "mt-1 text-xs text-muted";

/** One matched pair or group: the rule it used, both sides, and the amount tied. */
function MatchRow({ match }: { match: MatchWithMembers }) {
  const { ledger, external } = sides(match.members);
  const grouped = match.kind === "grouped_reference" && external.length > 1;
  const reference = ledger?.reference ?? external[0]?.reference ?? str(match.details, "groupKey");
  const amount = ledger ?? match.members[0];

  const summary = (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-baseline sm:gap-4">
      <StateChip tone="matched" label={MATCH_KIND_LABEL[match.kind]} className="sm:basis-40 sm:shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13.5px] text-ink">
          {ledger?.sourceId ?? "—"} <span className="text-muted">↔</span> {externalLabel(external)}
        </div>
        {reference !== null && reference !== undefined && (
          <div className={CITES}>
            cites <Mono>{reference}</Mono>
          </div>
        )}
      </div>
      {amount !== undefined && (
        <Money minor={amount.amountMinor} currency={amount.currency} className="text-sm text-ink sm:text-right" />
      )}
    </div>
  );

  if (!grouped) return <div className="border-b border-hair px-1.5">{summary}</div>;

  return (
    <details className="group border-b border-hair px-1.5 [&_summary]:list-none">
      <summary className={cx("cursor-pointer hover:bg-wash", "flex items-baseline gap-2")}>
        <span className="mt-4 select-none text-muted transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        <div className="min-w-0 flex-1">{summary}</div>
      </summary>
      <div className="pb-4 pl-6">
        <GroupedMembers external={external} details={match.details} netCurrency={ledger?.currency} />
      </div>
    </details>
  );
}

/**
 * The Matches tab: every pair the run tied out, grouped matches expandable to
 * their member lines. It reads the same record the pipeline wrote — the members
 * arrive already joined to their transaction versions, so no side is a bare id.
 */
export function MatchesTable({ matches }: { matches: MatchWithMembers[] }) {
  return (
    <div className="border-t border-hair">
      {matches.map((match) => (
        <MatchRow key={match.id} match={match} />
      ))}
    </div>
  );
}
