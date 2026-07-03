/** Join class fragments, dropping falsy ones. The whole utility — no dependency needed. */
export function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
