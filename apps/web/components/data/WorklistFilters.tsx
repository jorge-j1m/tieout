import Link from "next/link";
import { BREAK_TYPES, EXCEPTION_STATUSES, type BreakType, type ExceptionStatus } from "@tieout/contracts";
import { TYPE_LABEL } from "@/lib/explain/labels";
import { breaksHref } from "@/lib/routes";
import { cx } from "@/lib/cx";

interface Selection {
  run?: string;
  type?: BreakType;
  status?: ExceptionStatus;
}

function Chip({ active, href, children }: { active: boolean; href: ReturnType<typeof breaksHref>; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-[2px] border px-2.5 py-1 text-xs no-underline",
        active ? "border-ink text-ink" : "border-hair text-muted hover:border-ink hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Filter the worklist by break type and exception status. Each control is a
 * plain link that merges into the current selection — server-rendered, shareable,
 * and it works with JavaScript off. Currency is intentionally absent while the
 * dataset is single-currency: a filter with one option answers no question.
 */
export function WorklistFilters({ selection, types }: { selection: Selection; types: BreakType[] }) {
  const { run, type, status } = selection;
  const orderedTypes = BREAK_TYPES.filter((t) => types.includes(t));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps mr-1">Type</span>
        <Chip active={type === undefined} href={breaksHref({ run, status })}>
          All
        </Chip>
        {orderedTypes.map((t) => (
          <Chip key={t} active={type === t} href={breaksHref({ run, status, type: t })}>
            {TYPE_LABEL[t]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps mr-1">Status</span>
        <Chip active={status === undefined} href={breaksHref({ run, type })}>
          All
        </Chip>
        {EXCEPTION_STATUSES.map((s) => (
          <Chip key={s} active={status === s} href={breaksHref({ run, type, status: s })}>
            {s}
          </Chip>
        ))}
      </div>
    </div>
  );
}
