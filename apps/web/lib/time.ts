/**
 * Time rendering: UTC everywhere, and it says so. Two clocks matter — *occurred*
 * (event time per the source) and *observed* (when tieout first saw it) — and
 * neither is ever shown in local time; a reconciliation is a legal record, not
 * a calendar invite.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-06-05 00:00 UTC` — the run-context form. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  return `${formatUtcDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** `2026-06-05` — dates alone (rate days, value dates). */
export function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Coarse age for worklists: `7d` past the first day, `3h` inside it, floor 1h. */
export function age(iso: string, nowIso: string): string {
  const ms = new Date(nowIso).getTime() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d`;
  return `${Math.max(1, Math.floor(ms / 3_600_000))}h`;
}
