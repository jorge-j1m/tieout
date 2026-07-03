/**
 * Narrow a raw string (typically a query param) to a known enum member, or
 * undefined. The one place URL state becomes a typed value.
 */
export function asMember<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return raw !== undefined && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}
