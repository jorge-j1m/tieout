/**
 * Map key for a record identity within one source: `(sourceAccount, sourceId)`
 * joined with NUL so neither part can collide with the separator.
 */
export function identityKey(sourceAccount: string, sourceId: string): string {
  return `${sourceAccount}\u0000${sourceId}`;
}
