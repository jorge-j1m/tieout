/**
 * The display form of a uuid: its first 8 hex chars, the convention the whole
 * UI (and the design) uses for run and record ids. Full ids stay in hrefs and
 * copy actions — truncation is presentation, never identity.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
