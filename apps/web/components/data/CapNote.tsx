/**
 * Honesty line for capped lists: the API returns at most `cap` rows, so a list
 * that hits the cap may be showing a truncated view — say so instead of letting
 * counts quietly disagree with the record.
 */
export function CapNote({ count, cap, noun }: { count: number; cap: number; noun: string }) {
  if (count < cap) return null;
  return (
    <p className="mt-4 text-xs text-muted">
      Showing the {cap} most recent {noun} — the record may hold more.
    </p>
  );
}
