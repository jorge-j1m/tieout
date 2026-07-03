/**
 * Operator actions on a case. For the demo persona the buttons are visible but
 * disabled, with the honest tooltip — the real guard is server-side, not this
 * `disabled` attribute (proven by API tests). Phase 3 wires the live actions
 * for authenticated operators.
 */
export function ActionButtons({ canMutate }: { canMutate: boolean }) {
  if (!canMutate) {
    const tip = "Read-only demo — enforced server-side, not just here.";
    return (
      <div className="flex flex-wrap gap-2.5" title={tip}>
        <span className="cursor-not-allowed rounded-[2px] border border-hair px-3.5 py-2 text-sm text-muted">
          Acknowledge
        </span>
        <span className="cursor-not-allowed rounded-[2px] border border-hair px-3.5 py-2 text-sm text-muted">
          Resolve
        </span>
      </div>
    );
  }
  // Operator controls arrive in Phase 3 (login + server actions).
  return null;
}
